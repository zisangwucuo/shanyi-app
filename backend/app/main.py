import json
import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal
from urllib.parse import quote, urlsplit
from uuid import uuid4

from .recommendations import recommend

import aiosqlite
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from dotenv import load_dotenv
from . import auth, backup, stylist, outfit_sets, weather, tryon

if os.getenv("PYTHON_DOTENV_DISABLED") != "1":
    load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)
from .images import validate_image_bytes, MAX_IMAGE_BYTES
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "shanyi.db"
UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def expand_catalog_images(value):
    if isinstance(value, dict):
        return {key: expand_catalog_images(item) for key, item in value.items()}
    if isinstance(value, list):
        return [expand_catalog_images(item) for item in value]
    if isinstance(value, str) and value[:2] in {"G:", "L:", "A:", "I:"}:
        kind, prompt = value[0], value[2:]
        if kind == "G":
            prompt = "flat lay photography of " + prompt + ", on warm beige linen background, soft morning window light, editorial fashion still life, minimal styling, muted warm tones"
        elif kind == "L":
            prompt += ", candid film photography, warm natural light, muted beige tones, editorial lookbook style, shallow depth of field"
        elif kind == "A":
            prompt = "portrait photo of " + prompt + ", soft natural light, warm beige background, gentle smile, minimal"
        size = "portrait_4_3" if kind == "I" else "square_hd"
        return "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=" + quote(prompt, safe="~()*!.'-") + "&image_size=" + size
    return value


CATALOG = expand_catalog_images(json.loads(Path(__file__).with_name("catalog.json").read_text(encoding="utf-8")))
for _outfit in CATALOG["outfits"]:
    _outfit.setdefault("audience", "female")
_SAMPLE_DETAILS = [
    ("i102", "上装", "白", "四季", "通勤", "female"),
    ("i801", "外套", "驼色", "秋", "简约", "female"),
    ("i601", "下装", "蓝", "四季", "休闲", "female"),
    ("i103", "下装", "灰", "四季", "通勤", "female"),
    ("i301", "外套", "燕麦", "春", "简约", "female"),
    ("i401", "连衣裙", "酒红", "秋", "优雅", "female"),
    ("i303", "鞋履", "白", "四季", "休闲", "female"),
    ("i302", "上装", "米色", "冬", "简约", "female"),
    ("i104", "鞋履", "棕", "四季", "通勤", "female"),
    ("i201", "外套", "藏蓝", "春", "通勤", "female"),
    ("i501", "下装", "香槟", "夏", "优雅", "female"),
    ("i204", "配饰", "米色", "冬", "简约", "female"),
    ("m201", "上装", "白", "四季", "通勤", "male"),
    ("m202", "下装", "藏蓝", "四季", "通勤", "male"),
    ("m203", "外套", "灰", "冬", "正式", "male"),
    ("m301", "上装", "黑", "四季", "运动", "male"),
    ("m302", "下装", "黑", "四季", "运动", "male"),
    ("m401", "上装", "白", "夏", "休闲", "male"),
    ("m501", "外套", "卡其", "秋", "旅行", "male"),
    ("m601", "鞋履", "黑", "四季", "正式", "male"),
    ("u201", "上装", "米白", "四季", "简约", "unisex"),
    ("u202", "下装", "蓝", "四季", "休闲", "unisex"),
    ("u301", "外套", "卡其", "四季", "户外", "unisex"),
    ("u401", "鞋履", "白", "四季", "休闲", "unisex"),
]
_catalog_items = {item["id"]: item for outfit in CATALOG["outfits"] for item in outfit["items"]}
CATALOG["wardrobeSamples"] = [
    {"id": "sample-" + item_id, "name": _catalog_items[item_id]["name"],
     "category": category, "color": color, "season": season, "style": style,
     "image_url": _catalog_items[item_id]["img"], "wear_count": 0, "audience": audience}
    for item_id, category, color, season, style, audience in _SAMPLE_DETAILS
]
CATALOG["wardrobeSamples"].extend(
    {**sample, "wear_count": 0, "audience": sample.get("audience", "female")}
    for sample in CATALOG.pop("wardrobeExtraSamples", [])
)


def effective_outfit_preference(user):
    preference = user.get("outfit_preference", "auto")
    if preference != "auto":
        return preference
    gender = user.get("gender", "unspecified")
    return gender if gender in {"male", "female"} else "all"


def filter_outfits_for_user(user, outfits=None):
    preference = effective_outfit_preference(user)
    selected = CATALOG["outfits"] if outfits is None else outfits
    if preference == "all":
        return list(selected)
    allowed = {"male", "unisex"} if preference == "male" else {"female", "unisex"} if preference == "female" else {"unisex"}
    return [outfit for outfit in selected if outfit.get("audience", "female") in allowed]


def filter_samples_for_user(user):
    preference = effective_outfit_preference(user)
    if preference == "all":
        return CATALOG["wardrobeSamples"]
    allowed = {"male", "unisex"} if preference == "male" else {"female", "unisex"} if preference == "female" else {"unisex"}
    return [sample for sample in CATALOG["wardrobeSamples"] if sample.get("audience", "female") in allowed]


class CodeRequest(BaseModel):
    phone: str = Field(pattern=r"^1[3-9]\d{9}$")


class VerifyRequest(CodeRequest):
    code: str = Field(pattern=r"^\d{6}$")


class ProfileUpdate(BaseModel):
    name: str | None = None
    city: str | None = None
    height: int | None = Field(default=None, ge=80, le=240)
    weight: int | None = Field(default=None, ge=25, le=250)
    body_shape: str | None = None
    email: str | None = Field(default=None, max_length=254)
    tags: list[str] | None = None
    waist: int | None = Field(default=None, ge=30, le=200)
    gender: Literal["male", "female", "unspecified"] | None = None
    outfit_preference: Literal["auto", "male", "female", "unisex", "all"] | None = None


class CommentRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class VoteRequest(BaseModel):
    option: Literal["A", "B"]


class SettingsUpdate(BaseModel):
    weather: bool | None = None
    notify: bool | None = None
    recommendation: str | None = Field(default=None, min_length=1, max_length=100)


class MembershipRequest(BaseModel):
    plan_id: str


class WardrobeInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    category: str = Field(min_length=1, max_length=30)
    color: str = Field(default="", max_length=30)
    season: str = Field(default="", max_length=30)
    style: str = Field(default="", max_length=30)
    image_url: str | None = Field(default=None, max_length=2048)

    @field_validator("image_url")
    @classmethod
    def validate_image(cls, value):
        if not value:
            return None
        parts = urlsplit(value)
        if value.startswith("/uploads/") and not parts.query and not parts.fragment and Path(value).name == value[len("/uploads/"):] and Path(value).name not in {".", ".."} and "\\" not in value:
            return value
        if parts.scheme in {"http", "https"} and parts.netloc and not parts.username and not parts.password:
            return value
        raise ValueError("图片须为上传路径或 HTTP(S) 地址")


async def init_db() -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                phone TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                city TEXT NOT NULL,
                height INTEGER NOT NULL,
                weight INTEGER NOT NULL,
                body_shape TEXT NOT NULL
            )"""
        )
        await db.execute(
            """CREATE TABLE IF NOT EXISTS wardrobe_items (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                image_url TEXT
            )"""
        )
        for table, additions in {
            "users": {"email": "TEXT NOT NULL DEFAULT ''", "tags": "TEXT NOT NULL DEFAULT '[]'", "waist": "INTEGER", "gender": "TEXT NOT NULL DEFAULT 'unspecified'", "outfit_preference": "TEXT NOT NULL DEFAULT 'auto'"},
            "wardrobe_items": {"image_url": "TEXT", "color": "TEXT NOT NULL DEFAULT ''", "wear_count": "INTEGER NOT NULL DEFAULT 0", "season": "TEXT NOT NULL DEFAULT ''", "style": "TEXT NOT NULL DEFAULT ''"},
        }.items():
            columns = await db.execute(f"PRAGMA table_info({table})")
            column_names = {row[1] for row in await columns.fetchall()}
            for name, definition in additions.items():
                if name not in column_names:
                    await db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")
        await auth.init_tables(db)
        await outfit_sets.init_tables(db)
        await db.execute("CREATE TABLE IF NOT EXISTS wardrobe_sample_imports (user_id TEXT NOT NULL, sample_id TEXT NOT NULL, PRIMARY KEY (user_id, sample_id))")
        await db.execute("CREATE TABLE IF NOT EXISTS user_state (user_id TEXT PRIMARY KEY, state_json TEXT NOT NULL)")
        await db.execute("""CREATE TABLE IF NOT EXISTS wear_records (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, worn_date TEXT NOT NULL,
            outfit_id TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL,
            UNIQUE(user_id, worn_date, outfit_id))""")
        await db.execute("""CREATE TABLE IF NOT EXISTS outfit_feedback (
            user_id TEXT NOT NULL, outfit_id TEXT NOT NULL, preference TEXT NOT NULL,
            PRIMARY KEY(user_id, outfit_id))""")
        await db.commit()


def profile_from_row(row) -> dict[str, object]:
    user = dict(row)
    user["tags"] = json.loads(user["tags"])
    user.setdefault("gender", "unspecified")
    user.setdefault("outfit_preference", "auto")
    return user


async def get_or_create_user(phone: str) -> dict[str, object]:
    phone = auth.session_phone.get() or phone
    async with aiosqlite.connect(DB_PATH, timeout=30) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("BEGIN IMMEDIATE")
        cursor = await db.execute("SELECT * FROM users WHERE phone = ?", (phone,))
        row = await cursor.fetchone()
        if row:
            return profile_from_row(row)
        user = {
            "id": uuid4().hex,
            "phone": phone,
            "name": "苏晓",
            "city": "杭州",
            "height": 162,
            "weight": 52,
            "body_shape": "梨形",
            "email": "",
            "tags": [],
            "waist": None,
            "gender": "unspecified",
            "outfit_preference": "auto",
        }
        await db.execute(
            "INSERT INTO users (id, phone, name, city, height, weight, body_shape, email, tags, waist, gender, outfit_preference) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (user["id"], phone, user["name"], user["city"], user["height"], user["weight"], user["body_shape"], user["email"], "[]", user["waist"], user["gender"], user["outfit_preference"]),
        )
        await db.commit()
        return user


def default_state() -> dict[str, object]:
    return {
        "likes": [], "adopted": [], "comments": {}, "vote": None,
        "settings": {"weather": True, "notify": True, "recommendation": "均衡推荐"},
        "member_until": None, "orders": [],
    }


async def change_state(phone: str, mutate=None) -> dict[str, object]:
    user = await get_or_create_user(phone)
    async with aiosqlite.connect(DB_PATH, timeout=30) as db:
        await db.execute("BEGIN IMMEDIATE")
        cursor = await db.execute("SELECT state_json FROM user_state WHERE user_id = ?", (user["id"],))
        row = await cursor.fetchone()
        saved = json.loads(row[0]) if row else {}
        state = {**default_state(), **saved}
        state["settings"] = {**default_state()["settings"], **saved.get("settings", {})}
        if mutate:
            mutate(state, user)
        await db.execute(
            "INSERT INTO user_state (user_id, state_json) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET state_json=excluded.state_json",
            (user["id"], json.dumps(state, ensure_ascii=False)),
        )
        await db.commit()
    return state


def require_catalog_id(collection: str, target_id: str) -> None:
    if not any(item["id"] == target_id for item in CATALOG[collection]):
        raise HTTPException(status_code=404, detail="目录内容不存在")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()
    yield


app = FastAPI(title="善衣 SHANYI API", version="0.3.0", lifespan=lifespan)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")



@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "healthy", "service": "shanyi-api"}




@app.get("/api/catalog")
def get_catalog() -> dict[str, object]:
    return CATALOG


@app.get("/api/state")
async def get_state(phone: str) -> dict[str, object]:
    return await change_state(phone)


@app.post("/api/likes/{target_id}")
async def toggle_like(target_id: str, phone: str) -> dict[str, object]:
    kind, _, item_id = target_id.partition(":")
    collection = {"outfit": "outfits", "post": "posts"}.get(kind)
    if not collection:
        raise HTTPException(status_code=400, detail="点赞目标须为 outfit:ID 或 post:ID")
    require_catalog_id(collection, item_id)

    def mutate(state, user):
        if target_id in state["likes"]:
            state["likes"].remove(target_id)
        else:
            state["likes"].append(target_id)

    return await change_state(phone, mutate)


@app.post("/api/adopt/{outfit_id}")
async def adopt_outfit(outfit_id: str, phone: str) -> dict[str, object]:
    require_catalog_id("outfits", outfit_id)

    def mutate(state, user):
        if outfit_id not in state["adopted"]:
            state["adopted"].append(outfit_id)

    return await change_state(phone, mutate)


@app.post("/api/comments/{post_id}")
async def add_comment(post_id: str, phone: str, payload: CommentRequest) -> dict[str, object]:
    require_catalog_id("posts", post_id)
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="评论不能为空")

    def mutate(state, user):
        state["comments"].setdefault(post_id, []).append({"user": user["name"], "text": text})

    return await change_state(phone, mutate)


@app.post("/api/vote")
async def vote(phone: str, payload: VoteRequest) -> dict[str, object]:
    def mutate(state, user):
        state["vote"] = payload.option

    return await change_state(phone, mutate)


@app.put("/api/settings")
async def update_settings(phone: str, payload: SettingsUpdate) -> dict[str, object]:
    def mutate(state, user):
        state["settings"].update(payload.model_dump(exclude_none=True))

    return await change_state(phone, mutate)


@app.post("/api/membership")
async def purchase_membership(phone: str, payload: MembershipRequest) -> dict[str, object]:
    plan = next((item for item in CATALOG["membershipPlans"] if item["id"] == payload.plan_id), None)
    if not plan:
        raise HTTPException(status_code=400, detail="请选择有效的会员套餐")

    def mutate(state, user):
        now = datetime.now(timezone.utc)
        previous = datetime.fromisoformat(state["member_until"]) if state["member_until"] else now
        renewal = previous > now
        expires = max(previous, now) + timedelta(days=plan["days"])
        state["member_until"] = expires.isoformat()
        state["orders"].append({
            "id": "SY" + uuid4().hex, "plan_id": plan["id"], "plan_name": plan["name"],
            "price": plan["price"], "days": plan["days"], "renewal": renewal,
            "created_at": now.isoformat(), "expires_at": expires.isoformat(),
            "payment_mode": "mock", "status": "mock_paid", "message": "模拟支付成功，未发生真实扣款",
        })

    return await change_state(phone, mutate)


@app.get("/api/user/profile")
async def get_profile(phone: str) -> dict[str, object]:
    return await get_or_create_user(phone)


@app.put("/api/user/profile")
async def update_profile(phone: str, payload: ProfileUpdate) -> dict[str, object]:
    user = await get_or_create_user(phone)
    updates = payload.model_dump(exclude_none=True)
    if updates:
        values = [json.dumps(value, ensure_ascii=False) if key == "tags" else value for key, value in updates.items()]
        async with aiosqlite.connect(DB_PATH, timeout=30) as db:
            await db.execute(
                "UPDATE users SET " + ", ".join(f"{key}=?" for key in updates) + " WHERE id=?",
                (*values, user["id"]),
            )
            await db.commit()
    return await get_or_create_user(phone)


@app.get("/api/wardrobe")
async def get_wardrobe(phone: str) -> dict[str, object]:
    user = await get_or_create_user(phone)
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM wardrobe_items WHERE user_id = ? ORDER BY rowid DESC", (user["id"],))
        items = [dict(row) for row in await cursor.fetchall()]
    return {"items": items, "total": len(items)}


def today() -> str:
    return datetime.now(timezone(timedelta(hours=8))).date().isoformat()


class FeedbackInput(BaseModel):
    preference: Literal["like", "dislike"] | None = None


@app.get("/api/outfit-activity")
async def get_outfit_activity(phone: str) -> dict[str, object]:
    user = await get_or_create_user(phone)
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM wear_records WHERE user_id=? ORDER BY worn_date DESC, created_at DESC", (user["id"],))
        records = [{"id": row["id"], "date": row["worn_date"], "outfit_id": row["outfit_id"], **json.loads(row["snapshot_json"])} for row in await cursor.fetchall()]
        cursor = await db.execute("SELECT outfit_id, preference FROM outfit_feedback WHERE user_id=?", (user["id"],))
        feedback = {row["outfit_id"]: row["preference"] for row in await cursor.fetchall()}
    return {"today": today(), "records": records, "feedback": feedback}


@app.put("/api/outfit-feedback/{outfit_id}")
async def set_outfit_feedback(outfit_id: str, phone: str, payload: FeedbackInput):
    require_catalog_id("outfits", outfit_id)
    user = await get_or_create_user(phone)
    async with aiosqlite.connect(DB_PATH, timeout=30) as db:
        if payload.preference is None:
            await db.execute("DELETE FROM outfit_feedback WHERE user_id=? AND outfit_id=?", (user["id"], outfit_id))
        else:
            await db.execute("INSERT INTO outfit_feedback VALUES (?, ?, ?) ON CONFLICT(user_id, outfit_id) DO UPDATE SET preference=excluded.preference", (user["id"], outfit_id, payload.preference))
        await db.commit()
    return {"preference": payload.preference}


@app.post("/api/outfit-wear/{outfit_id}")
async def wear_outfit(outfit_id: str, phone: str):
    require_catalog_id("outfits", outfit_id)
    user = await get_or_create_user(phone)
    worn_date = today()
    async with aiosqlite.connect(DB_PATH, timeout=30) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("BEGIN IMMEDIATE")
        cursor = await db.execute("SELECT id FROM wear_records WHERE user_id=? AND worn_date=? AND outfit_id=?", (user["id"], worn_date, outfit_id))
        existing = await cursor.fetchone()
        if existing:
            return {"id": existing["id"], "created": False}
        cursor = await db.execute("SELECT * FROM wardrobe_items WHERE user_id=?", (user["id"],))
        wardrobe = [dict(row) for row in await cursor.fetchall()]
        outfit = next(item for item in CATALOG["outfits"] if item["id"] == outfit_id)
        plan = recommend([outfit], wardrobe)["items"][0]
        actual = {match["wardrobe_item"]["id"]: match["wardrobe_item"] for match in plan["matched"]}
        for item in actual.values():
            if item["wear_count"] >= 2147483647:
                raise HTTPException(status_code=409, detail="穿着次数已达上限，本次未记录")
            await db.execute("UPDATE wardrobe_items SET wear_count=wear_count+1 WHERE id=? AND user_id=?", (item["id"], user["id"]))
        record_id = uuid4().hex
        snapshot = {"outfit": outfit, "items": list(actual.values()), "missing": [match["item"]["name"] for match in plan["missing"]]}
        await db.execute("INSERT INTO wear_records VALUES (?, ?, ?, ?, ?, ?)", (record_id, user["id"], worn_date, outfit_id, json.dumps(snapshot, ensure_ascii=False), datetime.now(timezone.utc).isoformat()))
        await db.commit()
    return {"id": record_id, "created": True}


@app.get("/api/recommendations")
async def get_recommendations(phone: str, occasion: str | None = None) -> dict[str, object]:
    user = await get_or_create_user(phone)
    wardrobe = await get_wardrobe(phone)
    activity = await get_outfit_activity(phone)
    outfits = filter_outfits_for_user(user)
    return recommend(outfits, wardrobe["items"], occasion, activity["feedback"], activity["records"], activity["today"])


@app.get("/api/outfits/{outfit_id}")
async def get_outfit_detail(outfit_id: str, phone: str) -> dict[str, object]:
    outfit = next((item for item in CATALOG["outfits"] if item["id"] == outfit_id), None)
    if outfit is None:
        raise HTTPException(status_code=404, detail="目录内容不存在")
    wardrobe = await get_wardrobe(phone)
    return recommend([outfit], wardrobe["items"])["items"][0]


@app.post("/api/wardrobe/import-samples")
async def import_wardrobe_samples(phone: str) -> dict[str, object]:
    user = await get_or_create_user(phone)
    added = 0
    async with aiosqlite.connect(DB_PATH, timeout=30) as db:
        await db.execute("BEGIN IMMEDIATE")
        for sample in filter_samples_for_user(user):
            cursor = await db.execute(
                "INSERT OR IGNORE INTO wardrobe_sample_imports (user_id, sample_id) VALUES (?, ?)",
                (user["id"], sample["id"]),
            )
            if not cursor.rowcount:
                continue
            await db.execute(
                "INSERT INTO wardrobe_items (id, user_id, name, category, color, season, style, image_url, wear_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)",
                (uuid4().hex, user["id"], sample["name"], sample["category"], sample["color"], sample["season"], sample["style"], sample["image_url"]),
            )
            added += 1
        await db.commit()
    return {"added": added, "message": "样例已导入" if added else "样例已导入过，无重复添加"}


@app.post("/api/wardrobe")
async def create_wardrobe_item(phone: str, payload: WardrobeInput | None = None, name: str | None = None, category: str | None = None, image_url: str | None = None, color: str = "", season: str = "", style: str = "") -> dict[str, object]:
    if payload is None:
        try:
            payload = WardrobeInput(name=name, category=category, image_url=image_url, color=color, season=season, style=style)
        except ValidationError:
            raise HTTPException(status_code=422, detail="请检查名称（1–80字）、分类（1–30字）及其他字段（最多30字）和图片地址")
    user = await get_or_create_user(phone)
    item = {"id": uuid4().hex, "user_id": user["id"], **payload.model_dump(), "wear_count": 0}
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("INSERT INTO wardrobe_items (id, user_id, name, category, color, season, style, image_url, wear_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", tuple(item.values()))
        await db.commit()
    return item


@app.put("/api/wardrobe/{item_id}")
async def update_wardrobe_item(item_id: str, phone: str, payload: WardrobeInput) -> dict[str, object]:
    user = await get_or_create_user(phone)
    updates = payload.model_dump()
    async with aiosqlite.connect(DB_PATH, timeout=30) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("BEGIN IMMEDIATE")
        cursor = await db.execute(
            "UPDATE wardrobe_items SET " + ", ".join(f"{key}=?" for key in updates) + " WHERE id=? AND user_id=?",
            (*updates.values(), item_id, user["id"]),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="单品不存在")
        cursor = await db.execute("SELECT * FROM wardrobe_items WHERE id=? AND user_id=?", (item_id, user["id"]))
        item = dict(await cursor.fetchone())
        await db.commit()
    return item


@app.put("/api/wardrobe/{item_id}/wear")
async def wear_wardrobe_item(item_id: str, phone: str) -> dict[str, object]:
    user = await get_or_create_user(phone)
    async with aiosqlite.connect(DB_PATH, timeout=30) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("BEGIN IMMEDIATE")
        cursor = await db.execute("SELECT wear_count FROM wardrobe_items WHERE id=? AND user_id=?", (item_id, user["id"]))
        row = await cursor.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="单品不存在")
        if row["wear_count"] >= 2147483647:
            raise HTTPException(status_code=409, detail="穿着次数已达上限")
        await db.execute("UPDATE wardrobe_items SET wear_count=wear_count+1 WHERE id=? AND user_id=?", (item_id, user["id"]))
        cursor = await db.execute("SELECT * FROM wardrobe_items WHERE id=? AND user_id=?", (item_id, user["id"]))
        item = dict(await cursor.fetchone())
        await db.commit()
    return item


@app.delete("/api/wardrobe/{item_id}")
async def delete_wardrobe_item(item_id: str, phone: str) -> dict[str, str]:
    user = await get_or_create_user(phone)
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("DELETE FROM wardrobe_items WHERE id = ? AND user_id = ?", (item_id, user["id"]))
        await db.commit()
    if cursor.rowcount == 0:
        raise HTTPException(status_code=404, detail="单品不存在")
    return {"message": "单品已删除"}


@app.post("/api/uploads")
async def upload_image(file: UploadFile = File(...)) -> dict[str, str]:
    data = await file.read(MAX_IMAGE_BYTES + 1)
    suffix = validate_image_bytes(data, file.content_type or "application/octet-stream")
    file_name = f"{uuid4().hex}{suffix}"
    destination = UPLOAD_DIR / file_name
    with destination.open("xb") as output:
        output.write(data)
    return {"image_url": f"/uploads/{file_name}"}


outfit_sets.register(sys.modules[__name__])
stylist.register(sys.modules[__name__])
tryon.register(sys.modules[__name__])
weather.register(sys.modules[__name__])
auth.register(sys.modules[__name__])
backup.register(sys.modules[__name__])
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv("SHANYI_CORS_ORIGINS", "").split(",") if origin.strip().startswith("https://") and urlsplit(origin.strip()).path in {"", "/"}],
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$" if os.getenv("SHANYI_AUTH_MODE") == "development" else None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Retry-After"],
)
