import base64
import json
import os
import tempfile
from io import BytesIO
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from PIL import Image

from app import main as api
from app import stylist

def png_image(size=(2, 2)):
    image = BytesIO()
    Image.new("RGB", size).save(image, format="PNG")
    return image.getvalue()


PNG = png_image()


class FakeResponse:
    def __init__(self, result):
        self.result = result

    def raise_for_status(self):
        return None

    def json(self):
        return self.result


class FakeClient:
    response_result = None
    error = None
    request = None
    init_options = None

    def __init__(self, **kwargs):
        type(self).init_options = kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return None

    async def post(self, url, headers, json):
        type(self).request = {"url": url, "headers": headers, "json": json}
        if type(self).error:
            raise type(self).error
        return FakeResponse(type(self).response_result)


class StylistTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="shanyi-stylist-"))
        self.previous_db = api.DB_PATH
        api.DB_PATH = self.root / "test.db"
        self.addCleanup(setattr, api, "DB_PATH", self.previous_db)
        self.previous_env = {key: os.environ.get(key) for key in (
            "SHANYI_VISION_BASE_URL", "SHANYI_VISION_API_KEY", "SHANYI_VISION_MODEL",
            "SHANYI_STYLIST_BASE_URL", "SHANYI_STYLIST_API_KEY", "SHANYI_STYLIST_MODEL",
            "SHANYI_AUTH_MODE", "SHANYI_OTP_SECRET", "TENCENT_SMS_SECRET_ID", "TENCENT_SMS_SECRET_KEY",
            "TENCENT_SMS_SDK_APP_ID", "TENCENT_SMS_SIGN_NAME", "TENCENT_SMS_TEMPLATE_ID",
            "TENCENT_SMS_REGION", "TENCENT_SMS_TEMPLATE_PARAMS",
        )}
        self.addCleanup(self.restore_env)
        for key in self.previous_env:
            os.environ.pop(key, None)
        os.environ["SHANYI_AUTH_MODE"] = "development"
        await api.init_db()
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=api.app, raise_app_exceptions=False),
            base_url="http://test",
        )
        self.addAsyncCleanup(self.client.aclose)
        FakeClient.response_result = None
        FakeClient.error = None
        FakeClient.request = None
        FakeClient.init_options = None

    def restore_env(self):
        for key, value in self.previous_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    async def login(self, phone):
        response = await self.client.post("/api/auth/send-code", json={"phone": phone})
        self.assertEqual(response.status_code, 200, response.text)
        response = await self.client.post("/api/auth/verify", json={"phone": phone, "code": "123456"})
        self.assertEqual(response.status_code, 200, response.text)
        return {"Authorization": "Bearer " + response.json()["token"]}

    def configure_vision(self):
        os.environ["SHANYI_VISION_BASE_URL"] = "https://vision.example/v1"
        os.environ["SHANYI_VISION_API_KEY"] = "server-secret"
        os.environ["SHANYI_VISION_MODEL"] = "vision-test"

    async def test_config_unconfigured_and_analyze_requires_configuration(self):
        self.assertEqual((await self.client.get("/api/stylist/config")).json(), {"vision_available": False, "stylist_available": False})
        headers = await self.login("13800000001")
        no_consent = await self.client.post("/api/stylist/analyze", headers=headers, files={"file": ("selfie.png", PNG, "image/png")})
        self.assertEqual(no_consent.status_code, 400)
        self.assertIn("同意", no_consent.json()["detail"])
        response = await self.client.post(
            "/api/stylist/analyze", headers=headers, data={"consent": "true"},
            files={"file": ("selfie.png", PNG, "image/png")},
        )
        self.assertEqual(response.status_code, 503)
        self.assertIn("视觉识别服务未配置", response.json()["detail"])

    async def test_bad_files_are_rejected_without_vision_request(self):
        self.configure_vision()
        headers = await self.login("13800000001")
        cases = (
            (b"not-image", "image/png"),
            (PNG, "image/jpeg"),
            (PNG[:40], "image/png"),
            (png_image((8193, 1)), "image/png"),
            (png_image((6000, 5400)), "image/png"),
            (PNG + b"x" * (5 * 1024 * 1024), "image/png"),
        )
        with patch("app.stylist.httpx.AsyncClient", FakeClient):
            for data, mime in cases:
                with self.subTest(mime=mime, size=len(data)):
                    response = await self.client.post(
                        "/api/stylist/analyze", headers=headers, data={"consent": "true"},
                        files={"file": ("selfie.png", data, mime)},
                    )
                    self.assertEqual(response.status_code, 400, response.text)
                    self.assertNotIn("同意", response.json()["detail"])
        self.assertIsNone(FakeClient.init_options)
        self.assertIsNone(FakeClient.request)

    async def test_vision_success_uses_fake_service_and_returns_canonical_items(self):
        self.configure_vision()
        FakeClient.response_result = {"choices": [{"message": {"content": json.dumps({"items": [
            {"category": "T恤", "name": "白色T恤", "color": "白色"},
            {"category": "裤装", "name": "蓝牛仔裤", "color": "蓝色"},
        ]}, ensure_ascii=False)}}]}
        headers = await self.login("13800000001")
        with patch("app.stylist.httpx.AsyncClient", FakeClient):
            response = await self.client.post(
                "/api/stylist/analyze", headers=headers, data={"consent": "true"},
                files={"file": ("selfie.png", PNG, "image/png")},
            )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"items": [
            {"category": "上装", "name": "白色T恤", "color": "白色"},
            {"category": "下装", "name": "蓝牛仔裤", "color": "蓝色"},
        ], "source": "ai"})
        self.assertEqual(FakeClient.init_options, {"timeout": 20.0, "follow_redirects": False, "trust_env": False})
        self.assertEqual(FakeClient.request["url"], "https://vision.example/v1/chat/completions")
        self.assertEqual(FakeClient.request["headers"]["Authorization"], "Bearer server-secret")
        image_url = FakeClient.request["json"]["messages"][1]["content"][1]["image_url"]["url"]
        self.assertEqual(image_url, "data:image/png;base64," + base64.b64encode(PNG).decode("ascii"))
        self.assertIn("不分析或描述人脸", FakeClient.request["json"]["messages"][0]["content"])
        self.assertNotIn("人脸", FakeClient.request["json"]["messages"][1]["content"][0]["text"])

    async def test_bad_model_output_and_provider_exception_are_sanitized(self):
        self.configure_vision()
        headers = await self.login("13800000001")
        for content in (
            "not-json",
            json.dumps({"items": [{"category": "人体", "name": "不支持", "color": ""}]}),
            json.dumps({"items": [{"category": "上装", "name": "", "color": ""}]}),
        ):
            FakeClient.response_result = {"choices": [{"message": {"content": content}}]}
            FakeClient.error = None
            with patch("app.stylist.httpx.AsyncClient", FakeClient):
                response = await self.client.post(
                    "/api/stylist/analyze", headers=headers, data={"consent": "true"},
                    files={"file": ("selfie.png", PNG, "image/png")},
                )
            self.assertEqual(response.status_code, 502)
            self.assertNotIn("server-secret", response.text)
            self.assertNotIn(content, response.text)
        FakeClient.error = RuntimeError("server-secret raw-provider-body")
        with patch("app.stylist.httpx.AsyncClient", FakeClient):
            response = await self.client.post(
                "/api/stylist/analyze", headers=headers, data={"consent": "true"},
                files={"file": ("selfie.png", PNG, "image/png")},
            )
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("server-secret", response.text)
        self.assertNotIn("raw-provider-body", response.text)

    async def test_complete_does_not_repeat_confirmed_top_or_bottom(self):
        headers = await self.login("13800000001")
        response = await self.client.post("/api/stylist/complete", headers=headers, json={
            "weather": "晴朗", "temperature": 25, "occasion": "周末", "missing_categories": ["鞋履"],
            "items": [
                {"category": "上装", "name": "白衬衫", "color": "白"},
                {"category": "裤装", "name": "直筒牛仔裤", "color": "蓝"},
            ],
        })
        self.assertEqual(response.status_code, 200, response.text)
        categories = [item["category"] for item in response.json()["suggestions"]]
        self.assertNotIn("上装", categories)
        self.assertNotIn("下装", categories)
        self.assertIn("鞋履", categories)

    async def test_complete_passes_full_wardrobe_and_preference_filtered_catalog(self):
        for index in range(45):
            await api.create_wardrobe_item("13800000001", api.WardrobeInput(name=f"账户鞋履{index}", category="鞋履"))
        headers = await self.login("13800000001")
        profile = await self.client.put("/api/user/profile", headers=headers, json={"gender": "male"})
        self.assertEqual(profile.status_code, 200, profile.text)
        captured = {}

        async def capture(payload, wardrobe, catalog):
            captured["wardrobe"] = wardrobe
            captured["catalog"] = catalog
            return {"suggestions": [], "source": "captured"}

        with patch("app.stylist.ai_suggestions", capture):
            response = await self.client.post("/api/stylist/complete", headers=headers, json={
                "weather": "晴朗", "temperature": 25, "occasion": "周末", "items": [
                    {"category": "上装", "name": "白衬衫"},
                    {"category": "下装", "name": "蓝牛仔裤"},
                ],
            })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["source"], "captured")
        self.assertEqual(len(captured["wardrobe"]), 45)
        self.assertTrue(all(item["name"].startswith("账户鞋履") for item in captured["wardrobe"]))
        self.assertTrue(captured["catalog"]["outfits"])
        self.assertTrue(all(outfit["audience"] in {"male", "unisex"} for outfit in captured["catalog"]["outfits"]))

    async def test_ai_candidate_pool_keeps_more_than_forty_wardrobe_items(self):
        headers = await self.login("13800000001")
        response = await self.client.put("/api/user/profile", headers=headers, json={"gender": "male"})
        self.assertEqual(response.status_code, 200, response.text)
        user = await api.get_or_create_user("13800000001")
        wardrobe = [{"id": f"shoe-{index}", "name": f"衣橱鞋履{index}", "category": "鞋履"} for index in range(45)]
        catalog = {**api.CATALOG, "outfits": api.filter_outfits_for_user(user)}
        captured = {}

        class CandidateClient(FakeClient):
            async def post(self, url, headers, json):
                type(self).request = {"url": url, "headers": headers, "json": json}
                context = __import__("json").loads(json["messages"][1]["content"])
                candidates = context["candidates"]
                captured["candidates"] = candidates
                selected_by_category = {}
                for item in candidates:
                    selected_by_category.setdefault(item["category"], item)
                return FakeResponse({"choices": [{"message": {"content": __import__("json").dumps({
                    "selections": [{"id": item["id"], "reason": "与已穿搭配协调"} for item in selected_by_category.values()],
                }, ensure_ascii=False)}}]})

        payload = stylist.CompleteRequest.model_validate({
            "weather": "晴朗", "temperature": 25, "occasion": "周末", "missing_categories": ["鞋履"], "items": [
                {"category": "上装", "name": "白衬衫"},
                {"category": "下装", "name": "蓝牛仔裤"},
            ],
        })
        with patch("app.stylist.stylist_settings", return_value=("https://stylist.example/v1/chat/completions", "test-key", "test-model")), patch("app.stylist.httpx.AsyncClient", CandidateClient):
            result = await stylist.ai_suggestions(payload, wardrobe, catalog)
        closet_candidates = [item for item in captured["candidates"] if item["owned"]]
        self.assertEqual(len(closet_candidates), 45)
        self.assertEqual(result["suggestions"][0]["wardrobe_item"]["name"], "衣橱鞋履0")
        self.assertNotIn("白色透气运动鞋", [item["name"] for item in captured["candidates"]])

    def plan_payload(self, items=None):
        return stylist.CompleteRequest.model_validate({
            "weather": "晴朗", "temperature": 22, "occasion": "周末",
            "items": items or [{"category": "上装", "name": "白衬衫"}],
        })

    def plan_outfit(self, outfit_id, item_ids, occasion="周末"):
        return {
            "id": outfit_id, "title": outfit_id, "cover": "cover-" + outfit_id,
            "occasion": occasion, "audience": "unisex",
            "items": [{"id": item_id, "name": name, "category": category, "img": "img-" + item_id}
                      for item_id, name, category in item_ids],
        }

    async def test_fill_plans_are_distinct_and_only_confirmed_categories(self):
        payload = self.plan_payload()
        payload.missing_categories = ["鞋履"]
        result = stylist.build_suggestions(payload, [], api.CATALOG)
        plans = result["plans"]
        self.assertEqual(len(plans), 3)
        self.assertEqual(len({plan["title"] for plan in plans}), 3)
        for plan in plans:
            self.assertNotIn("cover", plan)
            self.assertEqual({item["category"] for item in plan["items"]}, {"鞋履"})
            self.assertIn("保留", plan["reason"])

    async def test_unknown_categories_are_not_automatically_missing(self):
        result = stylist.build_suggestions(self.plan_payload(), [], api.CATALOG)
        self.assertEqual(result["plans"], [])
        self.assertEqual(result["suggestions"], [])

    async def test_visible_category_cannot_be_replaced(self):
        payload = self.plan_payload()
        payload.missing_categories = ["上装"]
        from fastapi import HTTPException
        with self.assertRaises(HTTPException) as caught:
            stylist.build_suggestions(payload, [], api.CATALOG)
        self.assertEqual(caught.exception.status_code, 422)

    async def test_preview_authorization_upload_failure_and_replay(self):
        from unittest.mock import AsyncMock
        from fastapi import HTTPException
        from io import BytesIO
        from PIL import Image
        image = BytesIO()
        Image.new("RGB", (2, 2)).save(image, format="PNG")
        photo = image.getvalue()
        headers = await self.login("13800000001")
        other = await self.login("13900000002")
        user = await api.get_or_create_user("13800000001")
        plan = {"plan_id": "0", "items": [{"category": "鞋履", "name": "白鞋"}]}
        token = stylist.store_fill_plans(user["id"], [plan])[0]
        async def send(auth=headers, consent="true", data=photo, selected=token):
            return await self.client.post("/api/stylist/preview", headers=auth,
                data={"token": selected, "consent": consent}, files={"file": ("selfie.png", data, "image/png")})
        mock = AsyncMock(return_value={"image_url": "https://example.com/result.png", "notice": "test"})
        with patch("app.tryon.settings", return_value=("https://example.com/images/edits", "test", "model")), patch("app.tryon.generate_fill", mock):
            self.assertEqual((await send(auth={})).status_code, 401)
            self.assertEqual((await send(auth=other)).status_code, 404)
            self.assertEqual((await send(consent="false")).status_code, 400)
            self.assertEqual((await send(data=b"invalid")).status_code, 400)
            self.assertEqual((await send()).status_code, 200)
            self.assertEqual(mock.call_args.args[1], photo)
            self.assertEqual((await send()).status_code, 200)
            self.assertEqual(mock.await_count, 1)
            failed = stylist.store_fill_plans(user["id"], [plan])[0]
            mock.side_effect = HTTPException(502, "mock failure")
            self.assertEqual((await send(selected=failed)).status_code, 502)
            self.assertEqual((await send(selected=failed)).status_code, 409)
            self.assertEqual(mock.await_count, 2)

    async def test_complete_uses_only_session_accounts_wardrobe(self):
        await api.create_wardrobe_item("13800000001", api.WardrobeInput(name="甲用户白运动鞋", category="鞋履", color="白"))
        await api.create_wardrobe_item("13900000002", api.WardrobeInput(name="乙用户棕色短靴", category="鞋履", color="棕"))
        headers = await self.login("13800000001")
        response = await self.client.post(
            "/api/stylist/complete?phone=13900000002", headers=headers,
            json={"weather": "晴朗", "temperature": 25, "occasion": "周末", "missing_categories": ["鞋履"], "items": [
                {"category": "上装", "name": "白衬衫", "color": "白"},
                {"category": "下装", "name": "蓝牛仔裤", "color": "蓝"},
            ]},
        )
        self.assertEqual(response.status_code, 200, response.text)
        shoe = next(item for item in response.json()["suggestions"] if item["category"] == "鞋履")
        self.assertEqual(shoe["wardrobe_item"]["name"], "甲用户白运动鞋")
        self.assertIsNone(shoe["catalog_item"])


if __name__ == "__main__":
    unittest.main()
