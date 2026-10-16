import json
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal
from urllib.parse import quote
from uuid import uuid4

import aiosqlite
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

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


class CodeRequest(BaseModel):
    phone: str = Field(min_length=6, max_length=20)


class VerifyRequest(CodeRequest):
    code: str = Field(min_length=4, max_length=8)


class ProfileUpdate(BaseModel):
    name: str | None = None
    city: str | None = None
    height: int | None = Field(default=None, ge=80, le=240)
    weight: int | None = Field(default=None, ge=25, le=250)
    body_shape: str | None = None
    email: str | None = Field(default=None, max_length=254)
    tags: list[str] | None = None
    waist: int | None = Field(default=None, ge=30, le=200)


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
            "users": {"email": "TEXT NOT NULL DEFAULT ''", "tags": "TEXT NOT NULL DEFAULT '[]'", "waist": "INTEGER"},
            "wardrobe_items": {"image_url": "TEXT", "color": "TEXT NOT NULL DEFAULT ''", "wear_count": "INTEGER NOT NULL DEFAULT 0"},
        }.items():
            columns = await db.execute(f"PRAGMA table_info({table})")
            column_names = {row[1] for row in await columns.fetchall()}
            for name, definition in additions.items():
                if name not in column_names:
                    await db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")
        await db.execute("CREATE TABLE IF NOT EXISTS user_state (user_id TEXT PRIMARY KEY, state_json TEXT NOT NULL)")
        await db.commit()


def profile_from_row(row) -> dict[str, object]:
    user = dict(row)
    user["tags"] = json.loads(user["tags"])
    return user


async def get_or_create_user(phone: str) -> dict[str, object]:
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
        }
        await db.execute(
            "INSERT INTO users (id, phone, name, city, height, weight, body_shape, email, tags, waist) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (user["id"], phone, user["name"], user["city"], user["height"], user["weight"], user["body_shape"], user["email"], "[]", user["waist"]),
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
        state = json.loads(row[0]) if row else default_state()
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
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
verification_codes: dict[str, str] = {}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "healthy", "service": "shanyi-api"}


@app.post("/api/auth/send-code")
def send_code(payload: CodeRequest) -> dict[str, str]:
    verification_codes[payload.phone] = "123456"
    return {"message": "验证码已生成（开发环境固定为 123456）", "expires_in": "300"}


@app.post("/api/auth/verify")
async def verify_code(payload: VerifyRequest) -> dict[str, object]:
    if verification_codes.get(payload.phone) != payload.code:
        raise HTTPException(status_code=400, detail="验证码错误或已过期")
    return {
        "token": f"dev_{uuid4().hex}",
        "user": await get_or_create_user(payload.phone),
        "expires_at": datetime.now(timezone.utc).isoformat(),
    }


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


@app.post("/api/wardrobe")
async def create_wardrobe_item(phone: str, name: str, category: str, image_url: str | None = None, color: str = "") -> dict[str, object]:
    user = await get_or_create_user(phone)
    item = {"id": uuid4().hex, "user_id": user["id"], "name": name.strip(), "category": category.strip(), "image_url": image_url, "color": color.strip(), "wear_count": 0}
    if not item["name"] or not item["category"]:
        raise HTTPException(status_code=400, detail="单品名称和分类不能为空")
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("INSERT INTO wardrobe_items (id, user_id, name, category, image_url, color, wear_count) VALUES (?, ?, ?, ?, ?, ?, ?)", tuple(item.values()))
        await db.commit()
    return item


@app.put("/api/wardrobe/{item_id}/wear")
async def wear_wardrobe_item(item_id: str, phone: str) -> dict[str, object]:
    user = await get_or_create_user(phone)
    async with aiosqlite.connect(DB_PATH, timeout=30) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("BEGIN IMMEDIATE")
        cursor = await db.execute("UPDATE wardrobe_items SET wear_count=wear_count+1 WHERE id=? AND user_id=?", (item_id, user["id"]))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="单品不存在")
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
    allowed_types = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
    suffix = allowed_types.get(file.content_type or "")
    if not suffix:
        raise HTTPException(status_code=400, detail="仅支持 JPG、PNG 或 WEBP 图片")
    file_name = f"{uuid4().hex}{suffix}"
    destination = UPLOAD_DIR / file_name
    destination.write_bytes(await file.read())
    return {"image_url": f"/uploads/{file_name}"}
