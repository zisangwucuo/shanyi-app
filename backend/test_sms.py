import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from app import main as api

ENV_KEYS = (
    "SHANYI_AUTH_MODE", "SHANYI_OTP_SECRET", "TENCENT_SMS_SECRET_ID", "TENCENT_SMS_SECRET_KEY",
    "TENCENT_SMS_SDK_APP_ID", "TENCENT_SMS_SIGN_NAME", "TENCENT_SMS_TEMPLATE_ID",
    "TENCENT_SMS_REGION", "TENCENT_SMS_TEMPLATE_PARAMS",
)


class ProductionSmsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="shanyi-sms-"))
        for name in ("DB_PATH", "UPLOAD_DIR"):
            self.addCleanup(setattr, api, name, getattr(api, name))
        api.DB_PATH = self.root / "test.db"
        api.UPLOAD_DIR = self.root / "uploads"
        api.UPLOAD_DIR.mkdir()
        self.previous = {key: os.environ.get(key) for key in ENV_KEYS}
        self.addCleanup(self.restore_env)
        os.environ.update({
            "SHANYI_AUTH_MODE": "production",
            "SHANYI_OTP_SECRET": "otp-secret-for-tests-0123456789abcdef",
            "TENCENT_SMS_SECRET_ID": "AKIDexampleexampleexample",
            "TENCENT_SMS_SECRET_KEY": "k" * 32,
            "TENCENT_SMS_SDK_APP_ID": "1400000000",
            "TENCENT_SMS_SIGN_NAME": "善衣",
            "TENCENT_SMS_TEMPLATE_ID": "1234567",
            "TENCENT_SMS_REGION": "ap-guangzhou",
            "TENCENT_SMS_TEMPLATE_PARAMS": "code,minutes",
        })
        await api.init_db()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=api.app, raise_app_exceptions=False), base_url="http://test")
        self.addAsyncCleanup(self.client.aclose)

    def restore_env(self):
        for key, value in self.previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    async def test_production_mode_sends_real_sms_and_never_stores_plaintext(self):
        self.assertEqual((await self.client.get("/api/auth/config")).json()["mode"], "production")
        sent = []

        def fake_send(phone, code, config):
            sent.append((phone, code, dict(config)))
            return True

        with patch("app.sms.send_code", fake_send):
            response = await self.client.post("/api/auth/send-code", json={"phone": "13800000001"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn("development_code", response.json())
        self.assertEqual(len(sent), 1)
        phone, code, config = sent[0]
        self.assertEqual(phone, "13800000001")
        self.assertRegex(code, r"^\d{6}$")
        self.assertEqual(config["TEMPLATE_ID"], "1234567")
        self.assertEqual(config["TEMPLATE_PARAMS"], "code,minutes")

        with sqlite3.connect(api.DB_PATH) as db:
            mac, status = db.execute("SELECT code_mac, status FROM auth_codes WHERE phone=?", (phone,)).fetchone()
        self.assertEqual(status, "sent")
        self.assertEqual(len(mac), 64)
        self.assertNotEqual(mac, code)
        self.assertNotIn(code, mac)

        wrong = "000000" if code != "000000" else "111111"
        self.assertEqual((await self.client.post("/api/auth/verify", json={"phone": phone, "code": wrong})).status_code, 400)
        response = await self.client.post("/api/auth/verify", json={"phone": phone, "code": code})
        self.assertEqual(response.status_code, 200, response.text)
        headers = {"Authorization": "Bearer " + response.json()["token"]}
        self.assertEqual((await self.client.get("/api/user/profile", headers=headers)).status_code, 200)
        self.assertEqual((await self.client.post("/api/auth/verify", json={"phone": phone, "code": code})).status_code, 400)

    async def test_provider_failure_rejects_code_and_returns_503(self):
        sent = []

        def failing_send(phone, code, config):
            sent.append(code)
            return False

        with patch("app.sms.send_code", failing_send):
            response = await self.client.post("/api/auth/send-code", json={"phone": "13800000002"})
        self.assertEqual(response.status_code, 503, response.text)
        with sqlite3.connect(api.DB_PATH) as db:
            status, mac = db.execute("SELECT status, code_mac FROM auth_codes WHERE phone=?", ("13800000002",)).fetchone()
        self.assertEqual((status, mac), ("failed", ""))
        self.assertEqual((await self.client.post("/api/auth/verify", json={"phone": "13800000002", "code": sent[0]})).status_code, 400)

    async def test_provider_exception_is_reported_without_leaking_details(self):
        with patch("app.sms.send_code", side_effect=RuntimeError("secret detail")):
            response = await self.client.post("/api/auth/send-code", json={"phone": "13800000003"})
        self.assertEqual(response.status_code, 503, response.text)
        self.assertNotIn("secret detail", response.text)

    async def test_missing_otp_secret_disables_login_instead_of_falling_back(self):
        os.environ.pop("SHANYI_OTP_SECRET", None)
        self.assertEqual((await self.client.get("/api/auth/config")).json()["mode"], "unavailable")
        self.assertEqual((await self.client.post("/api/auth/send-code", json={"phone": "13800000004"})).status_code, 503)
        self.assertEqual((await self.client.post("/api/auth/verify", json={"phone": "13800000004", "code": "123456"})).status_code, 503)

    async def test_invalid_sms_template_params_disable_login(self):
        os.environ["TENCENT_SMS_TEMPLATE_PARAMS"] = "code,phone"
        self.assertEqual((await self.client.get("/api/auth/config")).json()["mode"], "unavailable")


if __name__ == "__main__":
    unittest.main()
