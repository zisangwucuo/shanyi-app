import asyncio
import os
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from app import main as api, weather
from app.auth import token_hash

CITY = {"name": "杭州", "latitude": 30.27, "longitude": 120.15, "country_code": "CN", "country": "中国", "admin1": "浙江省"}
CURRENT = {"current": {"temperature_2m": 18.4, "weather_code": 3, "time": "2026-10-19T12:00"}, "timezone": "Asia/Shanghai"}


class WeatherTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.env = patch.dict(os.environ, {"SHANYI_AUTH_MODE": "development"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.addCleanup(setattr, api, "DB_PATH", api.DB_PATH)
        api.DB_PATH = Path(tempfile.mkdtemp(prefix="shanyi-weather-")) / "test.db"
        await api.init_db()
        weather._cache.clear()
        weather._inflight.clear()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=api.app), base_url="http://test")
        self.addAsyncCleanup(self.client.aclose)
        await api.get_or_create_user("13800000001")
        await api.get_or_create_user("13800000002")
        with sqlite3.connect(api.DB_PATH) as db:
            db.execute("UPDATE users SET city='杭州' WHERE phone='13800000001'")
            db.execute("UPDATE users SET city='北京' WHERE phone='13800000002'")
            db.execute("INSERT INTO sessions (token_hash, phone, expires_at, mode) VALUES (?, ?, ?, ?)", (token_hash("weather-test"), "13800000001", time.time() + 60, "development"))
        db.close()
        self.headers = {"Authorization": "Bearer weather-test"}
        self.calls = []

    def mock(self, geocoding=None, current=None, error=None):
        def handle(request):
            self.calls.append(request)
            if error:
                raise error
            data = geocoding if request.url.host.startswith("geocoding") else current
            return httpx.Response(200, json=data)
        factory = httpx.AsyncClient
        return patch.object(weather.httpx, "AsyncClient", side_effect=lambda **kwargs: factory(transport=httpx.MockTransport(handle), **kwargs))

    async def get(self, path="/api/weather"):
        result = await self.client.get(path, headers=self.headers)
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    async def test_auth_profile_identity_and_city_change(self):
        self.assertEqual((await self.client.get("/api/weather")).status_code, 401)
        with self.mock({"results": [CITY]}, CURRENT):
            result = await self.get("/api/weather?phone=13800000002&city=北京")
            self.assertEqual(result["city"], "杭州")
            self.assertEqual(result["location_basis"], "profile_city")
            self.assertEqual(result["temperature"], 18.4)
            self.assertEqual(result["weather"], "阴天")
            self.assertEqual(result["stylist_weather"], "多云")
            self.assertEqual(self.calls[0].url.params["language"], "zh")
            self.assertEqual(self.calls[1].url.params["current"], "temperature_2m,weather_code")
            await self.client.put("/api/user/profile", headers=self.headers, json={"city": ""})
            self.assertEqual((await self.get())["status"], "missing_city")
            self.assertEqual(len(self.calls), 2)

    async def test_missing_not_found_ambiguous_and_chinese_preference(self):
        self.assertEqual((await weather.current_weather("  "))["status"], "missing_city")
        with self.mock({}):
            self.assertEqual((await self.get())["status"], "not_found")
        with self.mock({"results": [CITY, {**CITY, "longitude": 121}]}):
            self.assertEqual((await self.get())["status"], "ambiguous")
        with self.mock({"results": [CITY, {**CITY, "country_code": "US", "longitude": -100}]}, CURRENT):
            self.assertEqual((await self.get())["status"], "ok")

    async def test_city_seat_preferred_over_same_name_village(self):
        with self.mock({"results": [{**CITY, "feature_code": "PPLA"}, {**CITY, "longitude": 102, "feature_code": "PPL"}]}, CURRENT):
            self.assertEqual((await self.get())["status"], "ok")
            self.assertEqual(self.calls[1].url.params["longitude"], "120.15")

    async def test_timeout_failure_and_retry_not_cached(self):
        for error, status in ((httpx.ReadTimeout("timeout"), "timeout"), (httpx.ConnectError("offline"), "unavailable")):
            with self.mock(error=error):
                self.assertEqual((await self.get())["status"], status)
        with self.mock({"results": [CITY]}, CURRENT):
            self.assertEqual((await self.get())["status"], "ok")
        self.assertEqual(len(self.calls), 4)

    async def test_malformed_payload_never_succeeds(self):
        for current in ({}, {**CURRENT, "current": {**CURRENT["current"], "temperature_2m": None}}, {**CURRENT, "current": {**CURRENT["current"], "weather_code": 999}}):
            with self.mock({"results": [CITY]}, current):
                self.assertEqual((await self.get())["status"], "unavailable")
        with self.mock({"error": True, "reason": "bad query"}):
            self.assertEqual((await self.get())["status"], "unavailable")
        self.assertFalse(weather._cache)

    async def test_cache_expiry_bounded_and_concurrent(self):
        with self.mock({"results": [CITY]}, CURRENT):
            values = await asyncio.gather(*(weather.current_weather("杭州") for _ in range(8)))
            self.assertTrue(all(value["status"] == "ok" for value in values))
            self.assertEqual(len(self.calls), 2)
            await weather.current_weather("杭州")
            self.assertEqual(len(self.calls), 2)
            weather._cache["杭州"] = (0, values[0])
            await weather.current_weather("杭州")
            self.assertEqual(len(self.calls), 4)
            with patch.object(weather, "CACHE_LIMIT", 2):
                await weather.current_weather("上海")
                await weather.current_weather("北京")
                self.assertEqual(len(weather._cache), 2)
                self.assertNotIn("杭州", weather._cache)

    async def test_http_failure_and_weather_mapping(self):
        original = httpx.AsyncClient
        with patch.object(weather.httpx, "AsyncClient", side_effect=lambda **kwargs: original(transport=httpx.MockTransport(lambda request: httpx.Response(503)), **kwargs)):
            self.assertEqual((await self.get())["status"], "unavailable")
        for code, expected in ((0, "晴朗"), (2, "多云"), (45, "多云"), (61, "雨天"), (71, "雪天"), (95, "雨天")):
            self.assertEqual(weather.describe(code)[1], expected)


if __name__ == "__main__":
    unittest.main()
