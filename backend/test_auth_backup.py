import asyncio
import base64
import copy
import os
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import httpx

from app import main as api
from app.auth import token_hash

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=")


class AuthBackupTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="shanyi-phase4-"))
        for name in ("DB_PATH", "UPLOAD_DIR"):
            self.addCleanup(setattr, api, name, getattr(api, name))
        api.DB_PATH = self.root / "test.db"
        api.UPLOAD_DIR = self.root / "uploads"
        api.UPLOAD_DIR.mkdir()
        self.previous_mode = os.environ.get("SHANYI_AUTH_MODE")
        os.environ["SHANYI_AUTH_MODE"] = "development"
        self.addCleanup(self.reset_mode)
        await api.init_db()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=api.app, raise_app_exceptions=False), base_url="http://test")
        self.addAsyncCleanup(self.client.aclose)

    def reset_mode(self):
        if self.previous_mode is None:
            os.environ.pop("SHANYI_AUTH_MODE", None)
        else:
            os.environ["SHANYI_AUTH_MODE"] = self.previous_mode

    async def login(self, phone="13800000001"):
        response = await self.client.post("/api/auth/send-code", json={"phone": phone})
        self.assertEqual(response.status_code, 200, response.text)
        response = await self.client.post("/api/auth/verify", json={"phone": phone, "code": "123456"})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json(), {"Authorization": "Bearer " + response.json()["token"]}

    async def test_session_identity_expiry_logout(self):
        for path in ("/api/user/profile", "/api/state", "/api/wardrobe", "/api/user/backup", "/api/uploads"):
            self.assertEqual((await self.client.get(path)).status_code, 401)
        self.assertEqual((await self.client.get("/api/user/profile", headers={"Authorization": "Bearer fake"})).status_code, 401)
        login, headers = await self.login()
        self.assertGreater((datetime.fromisoformat(login["expires_at"]) - datetime.now(timezone.utc)).days, 28)
        with sqlite3.connect(api.DB_PATH) as db:
            saved = db.execute("SELECT token_hash FROM sessions").fetchone()[0]
        self.assertEqual(saved, token_hash(login["token"]))
        await api.init_db()
        result = await self.client.put("/api/user/profile?phone=13900000002", headers=headers, json={"name": "会话用户"})
        self.assertEqual(result.json()["phone"], "13800000001")
        other, other_headers = await self.login("13900000002")
        self.assertNotEqual(other["user"]["name"], "会话用户")
        self.assertEqual((await self.client.post("/api/auth/logout", headers=headers)).status_code, 204)
        self.assertEqual((await self.client.get("/api/state", headers=headers)).status_code, 401)
        with sqlite3.connect(api.DB_PATH) as db:
            db.execute("UPDATE sessions SET expires_at=0")
        self.assertEqual((await self.client.get("/api/state", headers=other_headers)).status_code, 401)

    async def test_code_limits_consumption_concurrency_and_modes(self):
        self.assertEqual((await self.client.get("/api/auth/config")).json(), {"mode": "development", "resend_seconds": 60, "expires_in": 300})
        for phone in ("123", "12800000000", "1380000000x"):
            self.assertEqual((await self.client.post("/api/auth/send-code", json={"phone": phone})).status_code, 422)
        payload = {"phone": "13800000001"}
        self.assertEqual((await self.client.post("/api/auth/send-code", json=payload)).json()["development_code"], "123456")
        self.assertEqual((await self.client.post("/api/auth/send-code", json=payload)).status_code, 429)
        for _ in range(5):
            self.assertEqual((await self.client.post("/api/auth/verify", json={**payload, "code": "000000"})).status_code, 400)
        self.assertEqual((await self.client.post("/api/auth/verify", json={**payload, "code": "123456"})).status_code, 400)
        with sqlite3.connect(api.DB_PATH) as db:
            db.execute("UPDATE auth_codes SET sent_at=sent_at-61")
        self.assertEqual((await self.client.post("/api/auth/send-code", json=payload)).status_code, 200)
        responses = await asyncio.gather(*(self.client.post("/api/auth/verify", json={**payload, "code": "123456"}) for _ in range(6)))
        self.assertEqual(sum(response.status_code == 200 for response in responses), 1)
        payload["phone"] = "13800000002"
        await self.client.post("/api/auth/send-code", json=payload)
        with sqlite3.connect(api.DB_PATH) as db:
            db.execute("UPDATE auth_codes SET expires_at=0")
        self.assertEqual((await self.client.post("/api/auth/verify", json={**payload, "code": "123456"})).status_code, 400)
        os.environ["SHANYI_AUTH_MODE"] = "production"
        self.assertEqual((await self.client.get("/api/auth/config")).json()["mode"], "unavailable")
        self.assertEqual((await self.client.post("/api/auth/send-code", json=payload)).status_code, 503)

    async def source_backup(self):
        _, headers = await self.login()
        image = await self.client.post("/api/uploads", headers=headers, files={"file": ("image.png", PNG, "image/png")})
        self.assertEqual(image.status_code, 200, image.text)
        item = await self.client.post("/api/wardrobe", headers=headers, json={"name": "白衬衫", "category": "上装", "image_url": image.json()["image_url"]})
        self.assertEqual(item.status_code, 200, item.text)
        self.assertEqual((await self.client.post("/api/outfit-wear/o1", headers=headers)).status_code, 200)
        await self.client.put("/api/outfit-feedback/o1", headers=headers, json={"preference": "like"})
        await self.client.post("/api/wardrobe/import-samples", headers=headers)
        await self.client.put("/api/settings", headers=headers, json={"notify": False})
        await self.client.post("/api/membership", headers=headers, json={"plan_id": "annual"})
        response = await self.client.get("/api/user/backup", headers=headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json(), headers

    async def test_gender_preference_filters_recommendations_without_hiding_or_deleting_data(self):
        _, headers = await self.login()
        profile = (await self.client.get("/api/user/profile", headers=headers)).json()
        self.assertEqual(profile["gender"], "unspecified")
        self.assertEqual(profile["outfit_preference"], "auto")

        catalog = (await self.client.get("/api/catalog", headers=headers)).json()
        outfits = catalog["outfits"]
        catalog_ids = {outfit["id"] for outfit in outfits}
        self.assertEqual(len(catalog_ids), len(outfits))
        self.assertEqual((await self.client.get("/api/recommendations", headers=headers)).status_code, 200)

        response = await self.client.put("/api/user/profile", headers=headers, json={"gender": "male", "outfit_preference": "auto"})
        self.assertEqual(response.status_code, 200, response.text)
        recommendations = (await self.client.get("/api/recommendations", headers=headers)).json()["items"]
        self.assertTrue(recommendations)
        self.assertTrue(all(plan["outfit"]["audience"] in {"male", "unisex"} for plan in recommendations))
        self.assertEqual({outfit["id"] for outfit in (await self.client.get("/api/catalog", headers=headers)).json()["outfits"]}, catalog_ids)
        self.assertTrue(any(outfit["audience"] == "female" for outfit in (await self.client.get("/api/catalog", headers=headers)).json()["outfits"]))

        samples = catalog["wardrobeSamples"]
        expected_sample_ids = {sample["id"] for sample in samples if sample["audience"] in {"male", "unisex"}}
        imported = await self.client.post("/api/wardrobe/import-samples", headers=headers)
        self.assertEqual(imported.status_code, 200, imported.text)
        self.assertEqual(imported.json()["added"], len(expected_sample_ids))
        wardrobe = (await self.client.get("/api/wardrobe", headers=headers)).json()["items"]
        self.assertEqual(len(wardrobe), len(expected_sample_ids))
        self.assertTrue(all("audience" not in item for item in wardrobe))
        set_response = await self.client.post("/api/outfit-sets", headers=headers, json={
            "name": "偏好切换后保留", "item_ids": [item["id"] for item in wardrobe[:2]],
        })
        self.assertEqual(set_response.status_code, 200, set_response.text)

        self.assertEqual((await self.client.post("/api/likes/outfit:o1", headers=headers)).status_code, 200)
        self.assertEqual((await self.client.put("/api/outfit-feedback/o1", headers=headers, json={"preference": "like"})).status_code, 200)
        self.assertEqual((await self.client.post("/api/outfit-wear/o1", headers=headers)).status_code, 200)
        self.assertNotIn("o1", {plan["outfit"]["id"] for plan in (await self.client.get("/api/recommendations", headers=headers)).json()["items"]})
        detail = await self.client.get("/api/outfits/o1", headers=headers)
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()["outfit"]["id"], "o1")

        response = await self.client.put("/api/user/profile", headers=headers, json={"outfit_preference": "female"})
        self.assertEqual(response.status_code, 200, response.text)
        female_recommendations = (await self.client.get("/api/recommendations", headers=headers)).json()["items"]
        self.assertTrue(female_recommendations)
        self.assertTrue(all(plan["outfit"]["audience"] in {"female", "unisex"} for plan in female_recommendations))
        self.assertIn("o1", {plan["outfit"]["id"] for plan in female_recommendations})

        response = await self.client.put("/api/user/profile", headers=headers, json={"outfit_preference": "unisex"})
        self.assertEqual(response.status_code, 200, response.text)
        unisex_recommendations = (await self.client.get("/api/recommendations", headers=headers)).json()["items"]
        self.assertTrue(unisex_recommendations)
        self.assertTrue(all(plan["outfit"]["audience"] == "unisex" for plan in unisex_recommendations))

        response = await self.client.put("/api/user/profile", headers=headers, json={"outfit_preference": "all"})
        self.assertEqual(response.status_code, 200, response.text)
        all_recommendations = (await self.client.get("/api/recommendations", headers=headers)).json()["items"]
        self.assertEqual({plan["outfit"]["id"] for plan in all_recommendations}, catalog_ids)
        self.assertEqual((await self.client.put("/api/user/profile", headers=headers, json={"gender": "unknown"})).status_code, 422)

        self.assertEqual({item["id"] for item in (await self.client.get("/api/wardrobe", headers=headers)).json()["items"]}, {item["id"] for item in wardrobe})
        activity = (await self.client.get("/api/outfit-activity", headers=headers)).json()
        self.assertEqual([record["outfit_id"] for record in activity["records"]], ["o1"])
        self.assertEqual(activity["feedback"]["o1"], "like")
        self.assertIn("outfit:o1", (await self.client.get("/api/state", headers=headers)).json()["likes"])
        self.assertEqual(len((await self.client.get("/api/outfit-sets", headers=headers)).json()["items"]), 1)

    async def test_backup_defaults_for_legacy_profile_and_outfit_and_strict_wardrobe_item(self):
        data, _ = await self.source_backup()
        legacy = copy.deepcopy(data)
        legacy["profile"].pop("gender")
        legacy["profile"].pop("outfit_preference")
        legacy["records"][0]["outfit"].pop("audience")
        normalized, _ = api.backup.validate(legacy, api)
        self.assertEqual(normalized["profile"]["gender"], "unspecified")
        self.assertEqual(normalized["profile"]["outfit_preference"], "auto")
        self.assertEqual(normalized["records"][0]["outfit"]["audience"], "female")

        invalid = copy.deepcopy(data)
        invalid["wardrobe"][0]["audience"] = "male"
        with self.assertRaises(api.HTTPException):
            api.backup.validate(invalid, api)

    async def test_backup_roundtrip_and_nonempty_and_entitlements(self):
        data, source_headers = await self.source_backup()
        self.assertEqual(len(data["images"]), 1)
        self.assertNotIn("phone", data["profile"])
        self.assertNotIn("id", data["profile"])
        self.assertNotIn("orders", data["state"])
        self.assertNotIn("member_until", data["state"])
        self.assertEqual(data["records"][0]["items"][0]["wear_count"], 0)
        self.assertNotIn("user_id", data["records"][0]["items"][0])
        target, headers = await self.login("13800000002")
        await self.client.post("/api/membership", headers=headers, json={"plan_id": "monthly"})
        original_state = (await self.client.get("/api/state", headers=headers)).json()
        result = await self.client.post("/api/user/restore/preview", headers=headers, json=data)
        self.assertTrue(result.json()["can_restore"], result.text)
        response = await self.client.post("/api/user/restore", headers=headers, json=data)
        self.assertEqual(response.status_code, 200, response.text)
        restored = (await self.client.get("/api/user/backup", headers=headers)).json()
        self.assertEqual(restored["sample_imports"], data["sample_imports"])
        self.assertEqual(restored["feedback"], data["feedback"])
        self.assertEqual(restored["state"], data["state"])
        self.assertNotEqual(restored["wardrobe"][0]["id"], data["wardrobe"][0]["id"])
        self.assertNotEqual(set(restored["images"]), set(data["images"]))
        self.assertEqual(list(restored["images"].values()), list(data["images"].values()))
        self.assertEqual(restored["records"][0]["items"][0]["image_url"], restored["wardrobe"][0]["image_url"])
        self.assertEqual(restored["records"][0]["items"][0]["id"], restored["wardrobe"][0]["id"])
        state = (await self.client.get("/api/state", headers=headers)).json()
        self.assertEqual(state["orders"], original_state["orders"])
        self.assertEqual(state["member_until"], original_state["member_until"])
        profile = (await self.client.get("/api/user/profile", headers=headers)).json()
        self.assertEqual(profile["id"], target["user"]["id"])
        self.assertEqual(profile["phone"], "13800000002")
        self.assertFalse((await self.client.post("/api/user/restore/preview", headers=source_headers, json=data)).json()["can_restore"])
        self.assertEqual((await self.client.post("/api/user/restore", headers=headers, json=data)).status_code, 409)

    async def test_history_only_images_and_state_content_rejection(self):
        data, source_headers = await self.source_backup()
        original_item = data["wardrobe"][0]
        await self.client.delete("/api/wardrobe/" + original_item["id"], headers=source_headers)
        exported = await self.client.get("/api/user/backup", headers=source_headers)
        self.assertEqual(exported.status_code, 200, exported.text)
        data = exported.json()
        self.assertEqual(len(data["images"]), 1)
        self.assertFalse(any(item["image_url"] == original_item["image_url"] for item in data["wardrobe"]))
        _, headers = await self.login("13800000002")
        await self.client.put("/api/settings", headers=headers, json={"notify": False})
        preview = await self.client.post("/api/user/restore/preview", headers=headers, json=data)
        self.assertFalse(preview.json()["can_restore"])
        self.assertEqual((await self.client.post("/api/user/restore", headers=headers, json=data)).status_code, 409)
        _, empty_headers = await self.login("13800000003")
        response = await self.client.post("/api/user/restore", headers=empty_headers, json=data)
        self.assertEqual(response.status_code, 200, response.text)
        restored = (await self.client.get("/api/user/backup", headers=empty_headers)).json()
        self.assertEqual(len(restored["images"]), 1)
        image = restored["records"][0]["items"][0]["image_url"]
        self.assertNotEqual(image, original_item["image_url"])
        self.assertTrue((api.UPLOAD_DIR / image.removeprefix("/uploads/")).is_file())

    async def test_saved_sets_validation_isolation_publish_and_backup(self):
        _, owner = await self.login()
        _, other = await self.login("13800000002")
        self.assertEqual((await self.client.get("/api/outfit-sets")).status_code, 401)
        image = (await self.client.post("/api/uploads", headers=owner, files={"file": ("set.png", PNG, "image/png")})).json()["image_url"]
        ids = []
        for name in ("套装上衣", "套装下装"):
            response = await self.client.post("/api/wardrobe", headers=owner, json={"name": name, "category": "上装", "image_url": image})
            ids.append(response.json()["id"])
        for payload in ({"name": " ", "item_ids": ids}, {"name": "测试", "item_ids": ids[:1]}, {"name": "测试", "item_ids": [ids[0], ids[0]]}):
            self.assertEqual((await self.client.post("/api/outfit-sets", headers=owner, json=payload)).status_code, 422)
        payload = {"name": "我的通勤", "item_ids": ids}
        self.assertEqual((await self.client.post("/api/outfit-sets", headers=other, json=payload)).status_code, 422)
        response = await self.client.post("/api/outfit-sets?phone=13800000002", headers=owner, json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        set_id = response.json()["id"]
        self.assertEqual((await self.client.get("/api/outfit-sets", headers=other)).json()["items"], [])
        self.assertEqual((await self.client.get("/api/community-sets", headers=other)).json()["items"], [])
        for method, path, args in (("put", f"/api/outfit-sets/{set_id}", {"json": payload}), ("delete", f"/api/outfit-sets/{set_id}", {}), ("post", f"/api/outfit-sets/{set_id}/publish", {})):
            self.assertEqual((await getattr(self.client, method)(path, headers=other, **args)).status_code, 404)
        published = await asyncio.gather(*(self.client.post(f"/api/outfit-sets/{set_id}/publish", headers=owner) for _ in range(4)))
        self.assertTrue(all(result.status_code == 200 for result in published))
        self.assertEqual(len({result.json()["id"] for result in published}), 1)
        public = (await self.client.get("/api/community-sets", headers=other)).json()["items"]
        self.assertEqual(len(public), 1)
        self.assertEqual(public[0]["name"], payload["name"])
        self.assertNotIn("user_id", public[0]["items"][0])
        self.assertEqual((await self.client.put(f"/api/outfit-sets/{set_id}", headers=owner, json={**payload, "name": "修改后的私人套装"})).status_code, 200)
        self.assertEqual((await self.client.get("/api/community-sets", headers=owner)).json()["items"][0]["name"], payload["name"])
        for item_id in ids:
            await self.client.delete(f"/api/wardrobe/{item_id}", headers=owner)
        response = await self.client.get("/api/user/backup", headers=owner)
        self.assertEqual(response.status_code, 200, response.text)
        data = response.json()
        self.assertEqual(len(data["outfit_sets"]), 1)
        self.assertEqual(len(data["shared_sets"]), 1)
        self.assertEqual(len(data["images"]), 1)
        preview = (await self.client.post("/api/user/restore/preview", headers=other, json=data)).json()
        self.assertEqual(preview["outfit_set_count"], 1)
        self.assertEqual(preview["shared_set_count"], 1)
        response = await self.client.post("/api/user/restore", headers=other, json=data)
        self.assertEqual(response.status_code, 200, response.text)
        restored = (await self.client.get("/api/outfit-sets", headers=other)).json()["items"]
        self.assertEqual({row["name"] for row in restored}, {payload["name"], "修改后的私人套装"})
        self.assertTrue(all(row["post_id"] is None for row in restored))
        self.assertTrue(all(row["id"] != set_id for row in restored))
        self.assertNotIn(restored[0]["items"][0]["id"], ids)
        self.assertNotEqual(restored[0]["items"][0]["image_url"], image)
        self.assertEqual(len((await self.client.get("/api/community-sets", headers=other)).json()["items"]), 1)
        exported = await self.client.get("/api/user/backup", headers=other)
        self.assertEqual(exported.status_code, 200, exported.text)
        self.assertEqual(exported.json()["shared_sets"], [])
        self.assertEqual((await self.client.post("/api/user/restore", headers=other, json=data)).status_code, 409)
        await self.client.delete(f"/api/outfit-sets/{set_id}", headers=owner)
        self.assertEqual(len((await self.client.get("/api/community-sets", headers=owner)).json()["items"]), 1)

    async def test_set_backup_same_snapshot_and_legacy_compatibility(self):
        _, owner = await self.login()
        await self.client.post("/api/wardrobe/import-samples", headers=owner)
        items = (await self.client.get("/api/wardrobe", headers=owner)).json()["items"][:2]
        set_id = (await self.client.post("/api/outfit-sets", headers=owner, json={"name": "周末", "item_ids": [item["id"] for item in items]})).json()["id"]
        await self.client.post(f"/api/outfit-sets/{set_id}/publish", headers=owner)
        data = (await self.client.get("/api/user/backup", headers=owner)).json()
        _, other = await self.login("13800000002")
        self.assertEqual((await self.client.post("/api/user/restore", headers=other, json=data)).status_code, 200)
        sets = (await self.client.get("/api/outfit-sets", headers=other)).json()["items"]
        self.assertEqual(len(sets), 1)
        self.assertIsNone(sets[0]["post_id"])
        restored_ids = {item["id"] for item in (await self.client.get("/api/wardrobe", headers=other)).json()["items"]}
        self.assertTrue({item["id"] for item in sets[0]["items"]} <= restored_ids)
        for key in ("outfit_sets", "shared_sets"):
            data.pop(key)
        _, legacy = await self.login("13800000003")
        self.assertEqual((await self.client.post("/api/user/restore", headers=legacy, json=data)).status_code, 200)
        self.assertEqual((await self.client.get("/api/outfit-sets", headers=legacy)).json()["items"], [])

    async def test_upload_bad_files_and_limits(self):
        _, headers = await self.login()
        for data, mime in ((b"fake", "image/png"), (PNG, "image/jpeg"), (PNG, "text/plain"), (PNG + b"x" * (5 * 1024 * 1024), "image/png")):
            response = await self.client.post("/api/uploads", headers=headers, files={"file": ("x.png", data, mime)})
            self.assertEqual(response.status_code, 400)
        self.assertEqual(list(api.UPLOAD_DIR.iterdir()), [])

    async def test_bad_backup_and_rollback(self):
        data, _ = await self.source_backup()
        target, headers = await self.login("13800000002")
        variants = []
        for key, value in (("format", "unknown"), ("version", 2), ("images", {"../evil.png": base64.b64encode(PNG).decode()}), ("images", {next(iter(data["images"])): "!!!!"}), ("state", {**data["state"], "orders": [{"price": 0}]}), ("state", {**data["state"], "settings": {"weather": "false"}}), ("profile", {**data["profile"], "phone": "13800000001"})):
            variants.append({**data, key: value})
        duplicate = copy.deepcopy(data)
        duplicate["wardrobe"].append(duplicate["wardrobe"][0])
        variants.extend([duplicate, [], {"format": "shanyi-backup"}])
        before = set(api.UPLOAD_DIR.iterdir())
        for variant in variants:
            for path in ("/api/user/restore/preview", "/api/user/restore"):
                response = await self.client.post(path, headers=headers, json=variant)
                self.assertIn(response.status_code, (400, 422), response.text)
        self.assertEqual(set(api.UPLOAD_DIR.iterdir()), before)
        with sqlite3.connect(api.DB_PATH) as db:
            db.execute("CREATE TRIGGER fail_restore BEFORE INSERT ON wear_records BEGIN SELECT RAISE(ABORT, 'forced'); END")
        response = await self.client.post("/api/user/restore", headers=headers, json=data)
        self.assertEqual(response.status_code, 500)
        with sqlite3.connect(api.DB_PATH) as db:
            for table in ("wardrobe_items", "wear_records", "wardrobe_sample_imports", "outfit_feedback", "user_state"):
                self.assertEqual(db.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id=?", (target["user"]["id"],)).fetchone()[0], 0)
        self.assertTrue((await self.client.post("/api/user/restore/preview", headers=headers, json=data)).json()["can_restore"])
        self.assertGreater(len(set(api.UPLOAD_DIR.iterdir())), len(before))


if __name__ == "__main__":
    unittest.main()
