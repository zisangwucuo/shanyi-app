import asyncio
import hashlib
import hmac
import os
import secrets
import time
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, urlencode

import aiosqlite
from fastapi import HTTPException
from fastapi.responses import JSONResponse, Response

from . import sms

session_phone = ContextVar("session_phone", default=None)
PUBLIC = {"/health", "/api/catalog", "/api/auth/config", "/api/auth/send-code", "/api/auth/verify"}


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def mode():
    configured = os.getenv("SHANYI_AUTH_MODE", "unavailable")
    if configured == "development":
        return configured
    return "production" if configured == "production" and sms.settings() else "unavailable"


def code_mac(phone, reservation, code):
    return hmac.new(os.environ["SHANYI_OTP_SECRET"].encode(), f"production:{phone}:{reservation}:{code}".encode(), hashlib.sha256).hexdigest()


async def init_tables(db):
    await db.execute("CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, phone TEXT NOT NULL, expires_at REAL NOT NULL)")
    await db.execute("CREATE TABLE IF NOT EXISTS auth_codes (phone TEXT PRIMARY KEY, sent_at REAL NOT NULL, expires_at REAL NOT NULL, failures INTEGER NOT NULL DEFAULT 0, consumed INTEGER NOT NULL DEFAULT 0)")
    for table, additions in {
        "sessions": {"mode": "TEXT NOT NULL DEFAULT 'development'"},
        "auth_codes": {"mode": "TEXT NOT NULL DEFAULT 'development'", "reservation": "TEXT NOT NULL DEFAULT ''", "code_mac": "TEXT NOT NULL DEFAULT ''", "status": "TEXT NOT NULL DEFAULT 'sent'"},
    }.items():
        cursor = await db.execute(f"PRAGMA table_info({table})")
        columns = {row[1] for row in await cursor.fetchall()}
        for name, definition in additions.items():
            if name not in columns:
                await db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")
    await db.execute("CREATE TABLE IF NOT EXISTS sms_limits (kind TEXT NOT NULL, subject TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(kind, subject, bucket))")


async def reserve_limit(db, kind, subject, bucket, maximum):
    cursor = await db.execute("SELECT count FROM sms_limits WHERE kind=? AND subject=? AND bucket=?", (kind, subject, bucket))
    row = await cursor.fetchone()
    if row and row[0] >= maximum:
        raise HTTPException(429, "验证码请求过于频繁，请稍后再试", headers={"Retry-After": "3600"})
    await db.execute("INSERT INTO sms_limits VALUES (?, ?, ?, 1) ON CONFLICT(kind, subject, bucket) DO UPDATE SET count=count+1", (kind, subject, bucket))


def register(api):
    @api.app.middleware("http")
    async def authenticate(request, call_next):
        if request.url.path in PUBLIC or request.method == "OPTIONS" or not request.url.path.startswith("/api"):
            return await call_next(request)
        scheme, _, token = request.headers.get("authorization", "").partition(" ")
        current_mode = mode()
        if current_mode == "unavailable" or scheme.lower() != "bearer" or not token:
            return JSONResponse({"detail": "请先登录"}, status_code=401)
        async with aiosqlite.connect(api.DB_PATH) as db:
            cursor = await db.execute("SELECT phone FROM sessions WHERE token_hash=? AND expires_at>? AND mode=?", (token_hash(token), time.time(), current_mode))
            row = await cursor.fetchone()
        if row is None:
            return JSONResponse({"detail": "登录已失效"}, status_code=401)
        request.state.phone = row[0]
        request.state.token_hash = token_hash(token)
        params = [(key, value) for key, value in parse_qsl(request.scope["query_string"].decode(), keep_blank_values=True) if key != "phone"]
        params.append(("phone", row[0]))
        request.scope["query_string"] = urlencode(params).encode()
        context = session_phone.set(row[0])
        try:
            return await call_next(request)
        finally:
            session_phone.reset(context)

    @api.app.get("/api/auth/config")
    async def config():
        return {"mode": mode(), "resend_seconds": 60, "expires_in": 300}

    @api.app.post("/api/auth/send-code")
    async def send(payload: api.CodeRequest, request: api.Request):
        current_mode = mode()
        if current_mode == "unavailable":
            raise HTTPException(503, "短信服务尚未配置")
        now = time.time()
        reservation = secrets.token_hex(16)
        code = "123456" if current_mode == "development" else f"{secrets.randbelow(1000000):06d}"
        digest = code_mac(payload.phone, reservation, code) if current_mode == "production" else ""
        async with aiosqlite.connect(api.DB_PATH, timeout=30) as db:
            await db.execute("BEGIN IMMEDIATE")
            cursor = await db.execute("SELECT sent_at FROM auth_codes WHERE phone=?", (payload.phone,))
            row = await cursor.fetchone()
            if row and now - row[0] < 60:
                raise HTTPException(429, "请在60秒后重试", headers={"Retry-After": str(max(1, int(60 - now + row[0])))})
            if current_mode == "production":
                # Only ASGI's peer address is used; Uvicorn trusts loopback proxies only.
                ip = request.client.host if request.client else "unknown"
                await reserve_limit(db, "phone_day", payload.phone, int((now + 28800) // 86400), 10)
                await reserve_limit(db, "ip_hour", ip, int(now // 3600), 20)
                await reserve_limit(db, "ip_day", ip, int((now + 28800) // 86400), 100)
            await db.execute("INSERT INTO auth_codes (phone, sent_at, expires_at, failures, consumed, mode, reservation, code_mac, status) VALUES (?, ?, ?, 0, 0, ?, ?, ?, 'pending') ON CONFLICT(phone) DO UPDATE SET sent_at=excluded.sent_at, expires_at=excluded.expires_at, failures=0, consumed=0, mode=excluded.mode, reservation=excluded.reservation, code_mac=excluded.code_mac, status='pending'", (payload.phone, now, now + 300, current_mode, reservation, digest))
            await db.commit()
        success = current_mode == "development"
        if current_mode == "production":
            try:
                success = await asyncio.wait_for(asyncio.to_thread(sms.send_code, payload.phone, code, sms.settings()), timeout=12)
            except Exception:
                success = False
        async with aiosqlite.connect(api.DB_PATH, timeout=30) as db:
            await db.execute("UPDATE auth_codes SET status=?, code_mac=CASE WHEN ? THEN code_mac ELSE '' END WHERE phone=? AND reservation=? AND status='pending'", ("sent" if success else "failed", success, payload.phone, reservation))
            await db.commit()
        if not success:
            raise HTTPException(503, "验证码发送未确认，请稍后重新获取", headers={"Retry-After": "60"})
        result = {"message": "验证码已发送", "resend_seconds": 60, "expires_in": 300}
        if current_mode == "development":
            result.update(message="开发验证码已生成", development_code=code)
        return result

    @api.app.post("/api/auth/verify")
    async def verify(payload: api.VerifyRequest):
        now = time.time()
        valid = False
        current_mode = mode()
        if current_mode == "unavailable":
            raise HTTPException(503, "短信服务尚未配置")
        token = secrets.token_urlsafe(32)
        expiry = datetime.now(timezone.utc) + timedelta(days=30)
        async with aiosqlite.connect(api.DB_PATH, timeout=30) as db:
            await db.execute("BEGIN IMMEDIATE")
            cursor = await db.execute("SELECT expires_at, failures, consumed, mode, reservation, code_mac, status FROM auth_codes WHERE phone=?", (payload.phone,))
            row = await cursor.fetchone()
            if row and row[0] > now and row[1] < 5 and not row[2] and row[3] == current_mode and row[6] == "sent":
                valid = secrets.compare_digest(payload.code, "123456") if current_mode == "development" else secrets.compare_digest(code_mac(payload.phone, row[4], payload.code), row[5])
                if valid:
                    await db.execute("UPDATE auth_codes SET consumed=1, code_mac='' WHERE phone=?", (payload.phone,))
                    await db.execute("INSERT INTO sessions (token_hash, phone, expires_at, mode) VALUES (?, ?, ?, ?)", (token_hash(token), payload.phone, expiry.timestamp(), current_mode))
                else:
                    await db.execute("UPDATE auth_codes SET failures=failures+1 WHERE phone=?", (payload.phone,))
            await db.commit()
        if not valid:
            raise HTTPException(400, "验证码错误、已消费或已过期")
        return {"token": token, "user": await api.get_or_create_user(payload.phone), "expires_at": expiry.isoformat()}

    @api.app.post("/api/auth/logout")
    async def logout(request: api.Request):
        async with aiosqlite.connect(api.DB_PATH) as db:
            await db.execute("DELETE FROM sessions WHERE token_hash=?", (request.state.token_hash,))
            await db.commit()
        return Response(status_code=204)
