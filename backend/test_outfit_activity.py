import asyncio
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from app import main as api
from app.recommendations import recommend


class ActivityTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.previous_db = api.DB_PATH
        self.previous_catalog = api.CATALOG
        api.DB_PATH = Path(tempfile.mkdtemp(prefix="shanyi-v2-")) / "test.db"
        self.addCleanup(setattr, api, "DB_PATH", self.previous_db)
        self.addCleanup(setattr, api, "CATALOG", self.previous_catalog)
        self.outfit = {"id": "test", "title": "测试搭配", "occasion": "通勤", "items": [
            {"id": "top", "name": "白衬衫"}, {"id": "pants", "name": "蓝牛仔裤"},
            {"id": "missing", "name": "棕乐福鞋"}]}
        api.CATALOG = {**api.CATALOG, "outfits": [self.outfit]}
        await api.init_db()
        self.item = await api.create_wardrobe_item("user-a", api.WardrobeInput(name="白衬衫", category="上装", color="白"))
        self.pants = await api.create_wardrobe_item("user-a", api.WardrobeInput(name="蓝牛仔裤", category="下装", color="蓝"))
        self.foreign = await api.create_wardrobe_item("user-b", api.WardrobeInput(name="棕乐福鞋", category="鞋履", color="棕"))

    async def test_concurrent_idempotency_and_snapshots(self):
        results = await asyncio.gather(*(api.wear_outfit("test", "user-a") for _ in range(12)))
        self.assertEqual(sum(result["created"] for result in results), 1)
        self.assertEqual(len({result["id"] for result in results}), 1)
        self.assertFalse((await api.wear_outfit("test", "user-a"))["created"])
        self.assertEqual([item["wear_count"] for item in (await api.get_wardrobe("user-a"))["items"]], [1, 1])
        self.assertEqual((await api.get_wardrobe("user-b"))["items"][0]["wear_count"], 0)
        await api.update_wardrobe_item(self.item["id"], "user-a", api.WardrobeInput(name="改名衣物", category="上装"))
        await api.delete_wardrobe_item(self.pants["id"], "user-a")
        activity = await api.get_outfit_activity("user-a")
        self.assertEqual(len(activity["records"]), 1)
        self.assertEqual({item["name"] for item in activity["records"][0]["items"]}, {"白衬衫", "蓝牛仔裤"})
        self.assertEqual(activity["records"][0]["missing"], ["棕乐福鞋"])
        self.assertEqual((await api.get_outfit_activity("user-b"))["records"], [])
        await api.wear_outfit("test", "user-b")
        self.assertEqual((await api.get_wardrobe("user-b"))["items"][0]["wear_count"], 1)

    async def test_failure_rolls_back_counts_and_record(self):
        with sqlite3.connect(api.DB_PATH) as db:
            db.execute("CREATE TRIGGER fail_record BEFORE INSERT ON wear_records BEGIN SELECT RAISE(ABORT, 'forced failure'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            await api.wear_outfit("test", "user-a")
        self.assertTrue(all(item["wear_count"] == 0 for item in (await api.get_wardrobe("user-a"))["items"]))
        self.assertEqual((await api.get_outfit_activity("user-a"))["records"], [])

    async def test_new_date_counts_once_and_overflow_rolls_back(self):
        original_today = api.today
        self.addCleanup(setattr, api, "today", original_today)
        api.today = lambda: "2026-10-16"
        await api.wear_outfit("test", "user-a")
        api.today = lambda: "2026-10-17"
        await api.wear_outfit("test", "user-a")
        self.assertEqual(len((await api.get_outfit_activity("user-a"))["records"]), 2)
        self.assertTrue(all(item["wear_count"] == 2 for item in (await api.get_wardrobe("user-a"))["items"]))
        with sqlite3.connect(api.DB_PATH) as db:
            db.execute("UPDATE wardrobe_items SET wear_count=2147483647 WHERE id=?", (self.pants["id"],))
        api.today = lambda: "2026-10-18"
        with self.assertRaises(api.HTTPException):
            await api.wear_outfit("test", "user-a")
        counts = {item["id"]: item["wear_count"] for item in (await api.get_wardrobe("user-a"))["items"]}
        self.assertEqual(counts[self.item["id"]], 2)
        self.assertEqual(len((await api.get_outfit_activity("user-a"))["records"]), 2)

    async def test_feedback_persistence_cancel_and_isolation(self):
        await api.set_outfit_feedback("test", "user-a", api.FeedbackInput(preference="dislike"))
        await api.init_db()
        self.assertEqual((await api.get_outfit_activity("user-a"))["feedback"], {"test": "dislike"})
        self.assertEqual((await api.get_outfit_activity("user-b"))["feedback"], {})
        self.assertIn("不喜欢", (await api.get_recommendations("user-a"))["items"][0]["reason"])
        await api.set_outfit_feedback("test", "user-a", api.FeedbackInput())
        self.assertEqual((await api.get_outfit_activity("user-a"))["feedback"], {})
        self.assertNotIn("不喜欢", (await api.get_recommendations("user-a"))["items"][0]["reason"])

    async def test_empty_wardrobe_and_unknown_catalog(self):
        await api.wear_outfit("test", "user-c")
        record = (await api.get_outfit_activity("user-c"))["records"][0]
        self.assertEqual(record["items"], [])
        self.assertEqual(len(record["missing"]), 3)
        with self.assertRaises(api.HTTPException):
            await api.wear_outfit("unknown", "user-a")

    async def test_legacy_migration_and_state(self):
        api.DB_PATH = api.DB_PATH.with_name("legacy.db")
        with sqlite3.connect(api.DB_PATH) as db:
            db.execute("CREATE TABLE users (id TEXT PRIMARY KEY, phone TEXT UNIQUE NOT NULL, name TEXT NOT NULL, city TEXT NOT NULL, height INTEGER NOT NULL, weight INTEGER NOT NULL, body_shape TEXT NOT NULL)")
            db.execute("INSERT INTO users VALUES ('legacy', 'old', '旧用户', '杭州', 162, 52, '梨形')")
            db.execute("CREATE TABLE wardrobe_items (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL, image_url TEXT)")
            db.execute("INSERT INTO wardrobe_items VALUES ('old-item', 'legacy', '旧衣', '上装', NULL)")
            db.execute("CREATE TABLE user_state (user_id TEXT PRIMARY KEY, state_json TEXT NOT NULL)")
            db.execute("INSERT INTO user_state VALUES (?, ?)", ("legacy", json.dumps({"adopted": ["test"], "likes": ["post:old"], "settings": {"weather": False}})))
        await api.init_db()
        await api.init_db()
        self.assertEqual((await api.get_wardrobe("old"))["items"][0]["name"], "旧衣")
        state = await api.adopt_outfit("test", "old")
        self.assertEqual(state["adopted"], ["test"])
        self.assertEqual(state["likes"], ["post:old"])
        self.assertFalse(state["settings"]["weather"])
        self.assertTrue(state["settings"]["notify"])
        self.assertEqual((await api.get_profile("old"))["name"], "旧用户")


class RankingTests(unittest.TestCase):
    def test_catalog_audience_and_required_male_outfit_coverage(self):
        raw = json.loads(Path(api.__file__).with_name("catalog.json").read_text(encoding="utf-8"))
        outfits = raw["outfits"]
        ids = [outfit["id"] for outfit in outfits]
        self.assertEqual(len(ids), len(set(ids)))
        legacy = {outfit["id"]: outfit for outfit in outfits if outfit["id"] in {f"o{index}" for index in range(1, 19)}}
        self.assertEqual(set(legacy), {f"o{index}" for index in range(1, 19)})
        self.assertTrue(all(outfit["audience"] == "female" for outfit in legacy.values()))

        male = [outfit for outfit in outfits if outfit["audience"] == "male"]
        unisex = [outfit for outfit in outfits if outfit["audience"] == "unisex"]
        self.assertGreaterEqual(len(male), 8)
        self.assertGreaterEqual(len(unisex), 4)
        for occasion in ("通勤", "运动", "周末", "正式场合", "旅行", "雨天", "聚会", "居家"):
            self.assertTrue(any(outfit["occasion"] == occasion for outfit in male), occasion)
        for outfit in male + unisex:
            self.assertTrue(outfit["cover"].startswith("L:"), outfit["id"])
            self.assertTrue(all(item["img"].startswith("G:") for item in outfit["items"]), outfit["id"])
            self.assertIn("asian", outfit["cover"].lower())
        item_ids = {item["id"] for outfit in outfits for item in outfit["items"]}
        self.assertTrue({"m201", "m202", "m203", "m301", "m302", "m401", "m501", "m601", "u201", "u202", "u301", "u401"} <= item_ids)
        samples = api.CATALOG["wardrobeSamples"]
        self.assertGreaterEqual(sum(sample["audience"] == "male" for sample in samples), 8)
        self.assertGreaterEqual(sum(sample["audience"] == "unisex" for sample in samples), 4)
        self.assertTrue(all(sample["image_url"].startswith("https://") for sample in samples))
        self.assertTrue(all(sample["audience"] in {"male", "female", "unisex"} for sample in samples))
        self.assertTrue(all(sample["id"][7:] in item_ids for sample in samples if sample["id"].startswith("sample-i")))
        self.assertTrue(all(sample["image_url"].startswith("G:") for sample in raw["wardrobeExtraSamples"]))

    def test_old_order_preferences_recency_and_coverage(self):
        item = {"id": "w", "name": "白衬衫", "category": "上装", "color": "白"}
        outfits = [{"id": key, "occasion": "通勤", "items": [{"name": "白衬衫"}]} for key in ["b", "a", "c"]]
        ids = lambda result: [plan["outfit"]["id"] for plan in result["items"]]
        baseline = recommend(outfits, [item])
        self.assertEqual(ids(baseline), ["a", "b", "c"])
        self.assertEqual(ids(recommend(outfits, [item], feedback={})), ids(baseline))
        self.assertEqual(ids(recommend(outfits, [item], feedback={"c": "like", "a": "dislike"})), ["c", "b", "a"])
        records = [{"outfit_id": "a", "date": "2026-10-17"}, {"outfit_id": "b", "date": "2026-10-15"}]
        self.assertEqual(ids(recommend(outfits, [item], records=records, today="2026-10-17")), ["c", "b", "a"])
        self.assertEqual(ids(recommend(outfits, [item], records=records, today="2026-10-24")), ids(baseline))
        outfits.append({"id": "d", "occasion": "通勤", "items": [{"name": "白衬衫"}, {"name": "蓝牛仔裤"}]})
        self.assertEqual(ids(recommend(outfits, [item], feedback={"d": "like", "a": "dislike"}, records=records, today="2026-10-17"))[-1], "d")
        duplicated = {**outfits[0], "items": [{"name": "白衬衫"}, {"name": "白衬衫"}]}
        self.assertEqual(recommend([duplicated], [item])["items"][0]["owned_count"], 1)


if __name__ == "__main__":
    unittest.main()
