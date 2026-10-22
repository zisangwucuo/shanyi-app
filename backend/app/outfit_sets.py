import json
from datetime import datetime, timezone
from uuid import uuid4

import aiosqlite
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field


class SetInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=80)
    item_ids: list[str] = Field(min_length=2, max_length=30)


async def init_tables(db):
    await db.execute("CREATE TABLE IF NOT EXISTS outfit_sets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, items_json TEXT NOT NULL, created_at TEXT NOT NULL)")
    await db.execute("CREATE TABLE IF NOT EXISTS community_sets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, set_id TEXT NOT NULL, name TEXT NOT NULL, items_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(user_id, set_id))")


def unpack(row):
    return {"id": row["id"], "name": row["name"], "items": json.loads(row["items_json"]), "created_at": row["created_at"]}


def register(api):
    @api.app.get("/api/outfit-sets")
    async def listing(phone: str):
        user = await api.get_or_create_user(phone)
        async with aiosqlite.connect(api.DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT s.*, p.id AS post_id FROM outfit_sets s LEFT JOIN community_sets p ON p.user_id=s.user_id AND p.set_id=s.id WHERE s.user_id=? ORDER BY s.rowid DESC", (user["id"],))
            return {"items": [{**unpack(row), "post_id": row["post_id"]} for row in await cursor.fetchall()]}

    async def save(phone, payload, set_id=None):
        user = await api.get_or_create_user(phone)
        if len(set(payload.item_ids)) != len(payload.item_ids):
            raise HTTPException(422, "请至少选择两件不同单品")
        async with aiosqlite.connect(api.DB_PATH, timeout=30) as db:
            db.row_factory = aiosqlite.Row
            await db.execute("BEGIN IMMEDIATE")
            if set_id:
                cursor = await db.execute("SELECT id FROM outfit_sets WHERE id=? AND user_id=?", (set_id, user["id"]))
                if not await cursor.fetchone():
                    raise HTTPException(404, "套装不存在")
            items = []
            for item_id in payload.item_ids:
                cursor = await db.execute("SELECT * FROM wardrobe_items WHERE id=? AND user_id=?", (item_id, user["id"]))
                row = await cursor.fetchone()
                if not row:
                    raise HTTPException(422, "所选单品已删除或不属于你的衣橱，请重新选择")
                items.append({key: value for key, value in dict(row).items() if key != "user_id"})
            encoded = json.dumps(items, ensure_ascii=False)
            if set_id:
                await db.execute("UPDATE outfit_sets SET name=?,items_json=? WHERE id=? AND user_id=?", (payload.name, encoded, set_id, user["id"]))
            else:
                set_id = uuid4().hex
                await db.execute("INSERT INTO outfit_sets VALUES (?,?,?,?,?)", (set_id, user["id"], payload.name, encoded, datetime.now(timezone.utc).isoformat()))
            await db.commit()
        return {"id": set_id}

    @api.app.post("/api/outfit-sets")
    async def create(phone: str, payload: SetInput):
        return await save(phone, payload)

    @api.app.put("/api/outfit-sets/{set_id}")
    async def update(set_id: str, phone: str, payload: SetInput):
        return await save(phone, payload, set_id)

    @api.app.delete("/api/outfit-sets/{set_id}")
    async def delete(set_id: str, phone: str):
        user = await api.get_or_create_user(phone)
        async with aiosqlite.connect(api.DB_PATH) as db:
            cursor = await db.execute("DELETE FROM outfit_sets WHERE id=? AND user_id=?", (set_id, user["id"]))
            if not cursor.rowcount:
                raise HTTPException(404, "套装不存在")
            await db.commit()
        return {"deleted": True}

    @api.app.post("/api/outfit-sets/{set_id}/publish")
    async def publish(set_id: str, phone: str):
        user = await api.get_or_create_user(phone)
        async with aiosqlite.connect(api.DB_PATH, timeout=30) as db:
            db.row_factory = aiosqlite.Row
            await db.execute("BEGIN IMMEDIATE")
            cursor = await db.execute("SELECT * FROM outfit_sets WHERE id=? AND user_id=?", (set_id, user["id"]))
            row = await cursor.fetchone()
            if not row:
                raise HTTPException(404, "套装不存在")
            await db.execute("INSERT OR IGNORE INTO community_sets VALUES (?,?,?,?,?,?)", (uuid4().hex, user["id"], set_id, row["name"], row["items_json"], datetime.now(timezone.utc).isoformat()))
            cursor = await db.execute("SELECT id FROM community_sets WHERE user_id=? AND set_id=?", (user["id"], set_id))
            post_id = (await cursor.fetchone())["id"]
            await db.commit()
        return {"id": post_id}

    @api.app.get("/api/community-sets")
    async def posts(phone: str):
        async with aiosqlite.connect(api.DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute("SELECT p.*,u.name AS author FROM community_sets p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC")
            return {"items": [{**unpack(row), "author": row["author"]} for row in await cursor.fetchall()]}
