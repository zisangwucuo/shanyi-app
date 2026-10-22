import base64
import binascii
import json
import re
from datetime import date, datetime, timezone
from typing import Literal
from uuid import uuid4

import aiosqlite
from fastapi import HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .images import MAX_IMAGE_BYTES, validate_image_bytes

MAX_BACKUP_BYTES = 50 * 1024 * 1024
FILE_NAME = re.compile(r"^[a-zA-Z0-9_-]{1,100}\.(?:png|jpg|jpeg|webp)$")


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class Settings(Strict):
    weather: bool = True
    notify: bool = True
    recommendation: str = Field(default="均衡推荐", min_length=1, max_length=100)


class Comment(Strict):
    user: str = Field(max_length=100)
    text: str = Field(min_length=1, max_length=2000)


class State(Strict):
    likes: list[str] = Field(default_factory=list, max_length=2000)
    adopted: list[str] = Field(default_factory=list, max_length=2000)
    comments: dict[str, list[Comment]] = Field(default_factory=dict, max_length=1000)
    vote: Literal["A", "B"] | None = None
    settings: Settings = Field(default_factory=Settings)


class Profile(Strict):
    name: str = Field(max_length=100)
    city: str = Field(max_length=100)
    height: int = Field(ge=80, le=240)
    weight: int = Field(ge=25, le=250)
    body_shape: str = Field(max_length=100)
    email: str = Field(default="", max_length=254)
    tags: list[str] = Field(default_factory=list, max_length=100)
    waist: int | None = Field(default=None, ge=30, le=200)
    gender: Literal["male", "female", "unspecified"] = "unspecified"
    outfit_preference: Literal["auto", "male", "female", "unisex", "all"] = "auto"


class Item(Strict):
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=80)
    category: str = Field(min_length=1, max_length=30)
    color: str = Field(default="", max_length=30)
    season: str = Field(default="", max_length=30)
    style: str = Field(default="", max_length=30)
    image_url: str | None = Field(default=None, max_length=2048)
    wear_count: int = Field(default=0, ge=0, le=2147483647)


class CatalogItem(Strict):
    id: str = Field(max_length=128)
    name: str = Field(max_length=100)
    price: int | float | None = None
    img: str | None = Field(default=None, max_length=2048)


class Outfit(Strict):
    id: str = Field(max_length=128)
    audience: Literal["male", "female", "unisex"] = "female"
    title: str = Field(max_length=200)
    occasion: str = Field(max_length=100)
    style: str | None = Field(default=None, max_length=100)
    season: str | None = Field(default=None, max_length=30)
    summary: str | None = Field(default=None, max_length=2000)
    styling: list[str] = Field(default_factory=list, max_length=100)
    occasionTip: str | None = Field(default=None, max_length=2000)
    match: int | None = None
    likes: int | None = None
    cover: str | None = Field(default=None, max_length=2048)
    tags: list[str] = Field(default_factory=list, max_length=100)
    items: list[CatalogItem] = Field(max_length=100)


class Record(Strict):
    id: str = Field(min_length=1, max_length=128)
    date: str
    outfit_id: str = Field(min_length=1, max_length=128)
    created_at: str
    outfit: Outfit
    items: list[Item] = Field(max_length=100)
    missing: list[str] = Field(max_length=100)


class SavedSet(Strict):
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=80)
    items: list[Item] = Field(min_length=2, max_length=30)
    created_at: str


class SharedSet(SavedSet):
    set_id: str = Field(min_length=1, max_length=128)


class Backup(Strict):
    format: Literal["shanyi-backup"]
    version: Literal[1]
    exported_at: str
    profile: Profile
    wardrobe: list[Item] = Field(max_length=5000)
    state: State
    sample_imports: list[str] = Field(max_length=1000)
    records: list[Record] = Field(max_length=10000)
    feedback: dict[str, Literal["like", "dislike"]] = Field(max_length=2000)
    images: dict[str, str] = Field(max_length=1000)
    outfit_sets: list[SavedSet] = Field(default_factory=list, max_length=5000)
    shared_sets: list[SharedSet] = Field(default_factory=list, max_length=5000)


def fail(message="备份数据无效"):
    raise HTTPException(400, message)


def local_name(value):
    if not isinstance(value, str) or not value.startswith("/uploads/"):
        return None
    name = value[len("/uploads/"):]
    if not FILE_NAME.fullmatch(name):
        fail("非法本地图片路径")
    return name


def image_refs(value):
    refs = set()
    if isinstance(value, dict):
        for key, child in value.items():
            if key in {"image_url", "img", "cover"} and child:
                name = local_name(child)
                if name:
                    refs.add(name)
                elif not isinstance(child, str) or not re.match(r"^https?://[^/]+", child):
                    fail("非法图片地址")
            else:
                refs.update(image_refs(child))
    elif isinstance(value, list):
        for child in value:
            refs.update(image_refs(child))
    return refs


def rewrite(value, images, ids):
    if isinstance(value, list):
        return [rewrite(child, images, ids) for child in value]
    if isinstance(value, dict):
        result = {}
        for key, child in value.items():
            if key == "id" and isinstance(child, str):
                result[key] = ids.get(child, child)
            elif key in {"image_url", "img", "cover"} and isinstance(child, str) and child.startswith("/uploads/"):
                result[key] = "/uploads/" + images[child[len("/uploads/"):]]
            else:
                result[key] = rewrite(child, images, ids)
        return result
    return value


def timestamp(value):
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        fail("时间必须带时区")


def validate(raw, api):
    try:
        data = Backup.model_validate(raw).model_dump()
        timestamp(data["exported_at"])
        if type(data["version"]) is not int:
            fail()
        for item in data["wardrobe"]:
            api.WardrobeInput.model_validate({key: value for key, value in item.items() if key not in {"id", "wear_count"}})
        if len({item["id"] for item in data["wardrobe"]}) != len(data["wardrobe"]):
            fail("重复单品ID")
        if len({row["id"] for row in data["records"]}) != len(data["records"]):
            fail("重复记录ID")
        if len({(row["date"], row["outfit_id"]) for row in data["records"]}) != len(data["records"]):
            fail("重复穿着记录")
        for record in data["records"]:
            if date.fromisoformat(record["date"]).isoformat() != record["date"]:
                fail()
            timestamp(record["created_at"])
            if record["outfit_id"] != record["outfit"]["id"]:
                fail("快照搭配ID不一致")
        state = data["state"]
        strings = data["profile"]["tags"] + state["likes"] + state["adopted"] + data["sample_imports"] + list(state["comments"]) + list(data["feedback"])
        if any(not value or len(value) > 128 for value in strings):
            fail("字段长度无效")
        if any(len(rows) > 1000 for rows in state["comments"].values()):
            fail("评论数量过多")
        for record in data["records"]:
            if any(len(value) > 100 for value in record["missing"] + record["outfit"]["tags"]):
                fail()
        sample_ids = {item["id"] for item in api.CATALOG["wardrobeSamples"]}
        if len(set(data["sample_imports"])) != len(data["sample_imports"]) or not set(data["sample_imports"]) <= sample_ids:
            fail("样例标记无效")
        for key in ("outfit_sets", "shared_sets"):
            rows = data[key]
            if len({row["id"] for row in rows}) != len(rows):
                fail("重复套装或帖子ID")
            for row in rows:
                timestamp(row["created_at"])
                if len({item["id"] for item in row["items"]}) != len(row["items"]):
                    fail("套装包含重复单品")
                for item in row["items"]:
                    api.WardrobeInput.model_validate({k: v for k, v in item.items() if k not in {"id", "wear_count"}})
        if len({row["set_id"] for row in data["shared_sets"]}) != len(data["shared_sets"]):
            fail("同一套装不可重复发布")
        refs = image_refs([data["wardrobe"], data["records"], data["outfit_sets"], data["shared_sets"]])
        if set(data["images"]) != refs:
            fail("图片映射须与衣橱及历史引用完全一致")
        decoded = {}
        for name, encoded in data["images"].items():
            if not FILE_NAME.fullmatch(name) or len(encoded) > ((MAX_IMAGE_BYTES + 2) // 3) * 4:
                fail("图片路径或大小无效")
            content = base64.b64decode(encoded, validate=True)
            suffix = validate_image_bytes(content)
            if name.rsplit(".", 1)[1] not in {suffix[1:], "jpeg" if suffix == ".jpg" else suffix[1:]}:
                fail("图片后缀与内容不符")
            decoded[name] = (content, suffix)
        return data, decoded
    except (ValidationError, ValueError, TypeError, KeyError, binascii.Error, OverflowError):
        fail()


async def body(request):
    chunks = bytearray()
    async for chunk in request.stream():
        chunks.extend(chunk)
        if len(chunks) > MAX_BACKUP_BYTES:
            raise HTTPException(413, "备份最多50MB")
    try:
        return json.loads(chunks)
    except (ValueError, UnicodeError, RecursionError):
        fail("备份必须为JSON对象")


async def empty(db, user_id, api):
    for table in ("wardrobe_items", "wear_records", "outfit_feedback", "wardrobe_sample_imports", "outfit_sets", "community_sets"):
        cursor = await db.execute(f"SELECT 1 FROM {table} WHERE user_id=? LIMIT 1", (user_id,))
        if await cursor.fetchone():
            return False
    cursor = await db.execute("SELECT state_json FROM user_state WHERE user_id=?", (user_id,))
    row = await cursor.fetchone()
    if row:
        state = json.loads(row[0])
        defaults = api.default_state()
        for key, value in state.items():
            if key not in {"member_until", "orders"} and (key not in defaults or value != defaults[key]):
                return False
    return True


def register(api):
    @api.app.get("/api/user/backup")
    async def export(phone: str):
        user = await api.get_or_create_user(phone)
        async with aiosqlite.connect(api.DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            await db.execute("BEGIN")
            cursor = await db.execute("SELECT * FROM wardrobe_items WHERE user_id=? ORDER BY rowid", (user["id"],))
            wardrobe = [{key: value for key, value in dict(row).items() if key != "user_id"} for row in await cursor.fetchall()]
            cursor = await db.execute("SELECT * FROM wear_records WHERE user_id=? ORDER BY rowid", (user["id"],))
            records = []
            for row in await cursor.fetchall():
                snapshot = json.loads(row["snapshot_json"])
                snapshot["items"] = [{key: value for key, value in item.items() if key != "user_id"} for item in snapshot["items"]]
                records.append({"id": row["id"], "date": row["worn_date"], "outfit_id": row["outfit_id"], "created_at": row["created_at"], **snapshot})
            sets = {}
            for key, table in (("outfit_sets", "outfit_sets"), ("shared_sets", "community_sets")):
                cursor = await db.execute(f"SELECT * FROM {table} WHERE user_id=? ORDER BY rowid", (user["id"],))
                sets[key] = [{**api.outfit_sets.unpack(row), **({"set_id": row["set_id"]} if key == "shared_sets" else {})} for row in await cursor.fetchall()]
            cursor = await db.execute("SELECT sample_id FROM wardrobe_sample_imports WHERE user_id=?", (user["id"],))
            samples = [row[0] for row in await cursor.fetchall()]
            cursor = await db.execute("SELECT outfit_id, preference FROM outfit_feedback WHERE user_id=?", (user["id"],))
            feedback = dict(await cursor.fetchall())
            cursor = await db.execute("SELECT state_json FROM user_state WHERE user_id=?", (user["id"],))
            row = await cursor.fetchone()
            state = api.default_state()
            if row:
                saved = json.loads(row[0])
                state.update(saved)
                state["settings"] = {**api.default_state()["settings"], **saved.get("settings", {})}
        state = {key: value for key, value in state.items() if key not in {"member_until", "orders"}}
        images = {}
        total = 0
        for name in image_refs([wardrobe, records, sets]):
            path = api.UPLOAD_DIR / name
            if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_IMAGE_BYTES:
                fail("引用图片不存在或大小超限")
            content = path.read_bytes()
            validate_image_bytes(content)
            total += ((len(content) + 2) // 3) * 4
            if total > MAX_BACKUP_BYTES:
                raise HTTPException(413, "备份最多50MB")
            images[name] = base64.b64encode(content).decode("ascii")
        data = {"format": "shanyi-backup", "version": 1, "exported_at": datetime.now(timezone.utc).isoformat(), "profile": {key: value for key, value in user.items() if key not in {"id", "phone"}}, "wardrobe": wardrobe, "state": state, "sample_imports": samples, "records": records, "feedback": feedback, "images": images}
        data.update(sets)
        if len(json.dumps(data, ensure_ascii=False).encode()) > MAX_BACKUP_BYTES:
            raise HTTPException(413, "备份最多50MB")
        validate(data, api)
        return data

    @api.app.post("/api/user/restore/preview")
    async def preview(request: Request, phone: str):
        data, _ = validate(await body(request), api)
        user = await api.get_or_create_user(phone)
        async with aiosqlite.connect(api.DB_PATH) as db:
            can_restore = await empty(db, user["id"], api)
        result = {"wardrobe_count": len(data["wardrobe"]), "record_count": len(data["records"]), "feedback_count": len(data["feedback"]), "image_count": len(data["images"]), "exported_at": data["exported_at"], "can_restore": can_restore, "outfit_set_count": len(data["outfit_sets"]), "shared_set_count": len(data["shared_sets"])}
        if not can_restore:
            result["reason"] = "仅允许恢复至业务空账户"
        return result

    @api.app.post("/api/user/restore")
    async def restore(request: Request, phone: str):
        data, decoded = validate(await body(request), api)
        user = await api.get_or_create_user(phone)
        async with aiosqlite.connect(api.DB_PATH, timeout=30) as db:
            await db.execute("BEGIN IMMEDIATE")
            if not await empty(db, user["id"], api):
                raise HTTPException(409, "仅允许恢复至业务空账户")
            image_map = {name: uuid4().hex + suffix for name, (_, suffix) in decoded.items()}
            ids = {item["id"]: uuid4().hex for item in data["wardrobe"]}
            for record in data["records"]:
                for item in record["items"]:
                    ids.setdefault(item["id"], uuid4().hex)
            # All payload and image validation completes before any writes. A DB failure may leave unreferenced UUID images.
            for name, (content, _) in decoded.items():
                with (api.UPLOAD_DIR / image_map[name]).open("xb") as output:
                    output.write(content)
            for item in data["wardrobe"]:
                item = rewrite(item, image_map, ids)
                await db.execute("INSERT INTO wardrobe_items (id,user_id,name,category,color,season,style,image_url,wear_count) VALUES (?,?,?,?,?,?,?,?,?)", (item["id"], user["id"], item["name"], item["category"], item["color"], item["season"], item["style"], item["image_url"], item["wear_count"]))
            for record in data["records"]:
                snapshot = {"outfit": rewrite(record["outfit"], image_map, {}), "items": rewrite(record["items"], image_map, ids), "missing": record["missing"]}
                await db.execute("INSERT INTO wear_records VALUES (?,?,?,?,?,?)", (uuid4().hex, user["id"], record["date"], record["outfit_id"], json.dumps(snapshot, ensure_ascii=False), record["created_at"]))
            set_ids = {row["id"]: uuid4().hex for row in data["outfit_sets"]}
            for row in data["shared_sets"]:
                set_ids.setdefault(row["set_id"], uuid4().hex)
            for row in data["outfit_sets"] + data["shared_sets"]:
                for item in row["items"]:
                    ids.setdefault(item["id"], uuid4().hex)
            for row in data["outfit_sets"]:
                await db.execute("INSERT INTO outfit_sets VALUES (?,?,?,?,?)", (set_ids[row["id"]], user["id"], row["name"], json.dumps(rewrite(row["items"], image_map, ids), ensure_ascii=False), row["created_at"]))
            saved_by_id = {row["id"]: row for row in data["outfit_sets"]}
            for row in data["shared_sets"]:
                saved = saved_by_id.get(row["set_id"])
                if saved and saved["name"] == row["name"] and saved["items"] == row["items"]:
                    continue
                # Restore published snapshots privately; publishing requires a separate user action.
                await db.execute("INSERT INTO outfit_sets VALUES (?,?,?,?,?)", (uuid4().hex, user["id"], row["name"], json.dumps(rewrite(row["items"], image_map, ids), ensure_ascii=False), row["created_at"]))
            for sample in data["sample_imports"]:
                await db.execute("INSERT INTO wardrobe_sample_imports VALUES (?,?)", (user["id"], sample))
            for outfit_id, preference in data["feedback"].items():
                await db.execute("INSERT INTO outfit_feedback VALUES (?,?,?)", (user["id"], outfit_id, preference))
            cursor = await db.execute("SELECT state_json FROM user_state WHERE user_id=?", (user["id"],))
            row = await cursor.fetchone()
            old_state = json.loads(row[0]) if row else api.default_state()
            state = {**data["state"], "member_until": old_state.get("member_until"), "orders": old_state.get("orders", [])}
            await db.execute("INSERT INTO user_state VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET state_json=excluded.state_json", (user["id"], json.dumps(state, ensure_ascii=False)))
            profile = data["profile"]
            await db.execute("UPDATE users SET " + ",".join(f"{key}=?" for key in profile) + " WHERE id=?", (*[json.dumps(value, ensure_ascii=False) if key == "tags" else value for key, value in profile.items()], user["id"]))
            await db.commit()
        return {"restored": True, "wardrobe_count": len(data["wardrobe"]), "record_count": len(data["records"]), "feedback_count": len(data["feedback"]), "image_count": len(decoded)}
