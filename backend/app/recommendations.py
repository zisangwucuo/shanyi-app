"""Deterministic wardrobe matching; no image recognition or generated try-on."""
import re
from datetime import date


# Specific garment words precede broader ones (裙 before 针织, 西装裤 before 西装).
KINDS = (
    ("连衣裙", "连衣裙", ("连衣裙",)),
    ("半裙", "下装", ("半裙", "半身裙")),
    ("大衣", "外套", ("大衣",)),
    ("风衣", "外套", ("风衣",)),
    ("西装裤", "下装", ("西装裤", "西裤")),
    ("运动裤", "下装", ("运动裤",)),
    ("阔腿裤", "下装", ("阔腿裤",)),
    ("短裤", "下装", ("短裤",)),
    ("直筒裤", "下装", ("直筒裤",)),
    ("西装外套", "外套", ("西装外套", "西服外套", "西装",)),
    ("夹克", "外套", ("夹克",)),
    ("开衫", "外套", ("开衫",)),
    ("牛仔裤", "下装", ("牛仔裤",)),
    ("运动鞋", "鞋履", ("运动鞋", "球鞋")),
    ("凉鞋", "鞋履", ("凉鞋",)),
    ("拖鞋", "鞋履", ("拖鞋",)),
    ("高跟鞋", "鞋履", ("高跟鞋",)),
    ("乐福鞋", "鞋履", ("乐福鞋",)),
    ("皮鞋", "鞋履", ("皮鞋", "正装鞋", "dress shoes")),
    ("短靴", "鞋履", ("短靴", "切尔西靴")),
    ("靴子", "鞋履", ("靴子",)),
    ("围巾", "配饰", ("围巾",)),
    ("包袋", "配饰", ("包袋", "背包", "手提包", "托特包", "手拿包", "手包", "clutch", "bag", "包")),
    ("衬衫", "上装", ("衬衫",)),
    ("T恤", "上装", ("t恤", "t-shirt", "短袖")),
    ("卫衣", "上装", ("卫衣",)),
    ("针织衫", "上装", ("毛衣", "针织衫")),
    ("帽子", "配饰", ("帽子", "帽")),
)
CATEGORY_GROUPS = {
    "衬衫": "上装", "T恤": "上装", "针织衫": "上装", "卫衣": "上装",
    "裤装": "下装", "运动裤": "下装", "短裤": "下装", "阔腿裤": "下装", "半身裙": "下装", "半裙": "下装",
    "靴子": "鞋履", "凉鞋": "鞋履", "运动鞋": "鞋履", "拖鞋": "鞋履", "高跟鞋": "鞋履",
    "包袋": "配饰", "帽子": "配饰", "围巾": "配饰",
}

COLORS = (
    ("酒红", ("酒红色", "酒红")), ("藏蓝", ("藏蓝色", "藏蓝")),
    ("燕麦", ("燕麦色", "燕麦")), ("香槟", ("香槟色", "香槟")),
    ("米", ("米色", "米白色", "米白")),
    ("抹茶绿", ("抹茶绿",)), ("白", ("白色", "白")),
    ("灰", ("灰色", "灰")), ("棕", ("棕色", "棕")),
    ("驼", ("驼色", "驼")),
    ("黑", ("黑色", "黑")), ("蓝", ("蓝色", "蓝")),
    ("绿", ("绿色", "绿")), ("红", ("红色", "红")),
)


def normalize(value):
    return re.sub(r"\s+", "", value or "").lower()


def garment(name):
    name = normalize(name)
    return next(((kind, category) for kind, category, words in KINDS if any(word in name for word in words)), (None, None))


def color_of(value):
    value = normalize(value)
    # Only exact color labels are canonicalized; multicolor/unknown labels stay unknown.
    return next((color for color, aliases in COLORS if value in aliases), None)


def named_color(name):
    name = normalize(name)
    return next((color for color, aliases in COLORS if any(alias in name for alias in aliases)), None)


def candidate(required, actual):
    kind, inferred_category = garment(required["name"])
    category = required.get("category") or inferred_category
    actual_kind, actual_inferred_category = garment(actual["name"])
    required_category = CATEGORY_GROUPS.get(category, category)
    actual_category = CATEGORY_GROUPS.get(actual["category"], actual["category"])
    actual_category = actual_category or actual_inferred_category
    if not required_category or required_category != actual_category:
        return None
    same_name = normalize(required["name"]) == normalize(actual["name"])
    if not same_name and (not kind or kind != actual_kind):
        return None
    required_color = color_of(required["color"]) if normalize(required.get("color")) else named_color(required["name"])
    actual_color = color_of(actual["color"]) if normalize(actual.get("color")) else named_color(actual["name"])
    if required_color and actual_color and required_color != actual_color:
        return None
    exact_color = bool(required_color and actual_color and required_color == actual_color)
    reason = "分类相同，" + ("名称一致" if same_name else f"同为{kind}")
    reason += "，标注颜色相同" if exact_color else "；颜色信息不足，需确认实物颜色"
    return (4 if same_name else 2) + int(exact_color), reason, exact_color


def recommend(outfits, wardrobe, occasion=None, feedback=None, records=None, today=None):
    feedback = feedback or {}
    recent = {}
    if today:
        for record in records or []:
            days = (date.fromisoformat(today) - date.fromisoformat(record["date"])).days
            if 0 <= days < 7:
                recent[record["outfit_id"]] = max(recent.get(record["outfit_id"], 0), 7 - days)
    # Each wardrobe ID may satisfy at most one requirement per outfit.
    unique = {item["id"]: item for item in wardrobe}
    clothes = sorted(unique.values(), key=lambda item: item["id"])
    results = []
    for outfit in outfits:
        if occasion and occasion != "全部" and outfit["occasion"] != occasion:
            continue
        requirements = outfit["items"]
        # DP over the small set of catalog requirements finds maximum coverage,
        # then best evidence, without greedy assignment stealing another slot.
        states = {0: (0, {})}
        for actual in clothes:
            updated = dict(states)
            for mask, (quality, assignments) in states.items():
                for index, required in enumerate(requirements):
                    if mask & (1 << index):
                        continue
                    evidence = candidate(required, actual)
                    if not evidence:
                        continue
                    next_mask = mask | (1 << index)
                    score, reason, exact_color = evidence
                    if next_mask not in updated or quality + score > updated[next_mask][0]:
                        updated[next_mask] = (quality + score, {**assignments, index: (actual, reason, exact_color)})
            states = updated
        mask, (quality, assignments) = max(states.items(), key=lambda entry: (entry[0].bit_count(), entry[1][0], -entry[0]))
        matched, missing = [], []
        for index, required in enumerate(requirements):
            if index in assignments:
                actual, reason, exact_color = assignments[index]
                matched.append({"item": required, "wardrobe_item": actual, "reason": reason, "exact_color": exact_color})
            else:
                missing.append({"item": required, "reason": "暂无同分类、同款式且颜色不冲突的可用衣物（每件衣物仅用一次）"})
        count, total = len(matched), len(requirements)
        coverage = count / total if total else 0
        uncertain = sum(not match["exact_color"] for match in matched)
        reason = "衣橱为空，请先添加衣物；以下仅为参考搭配" if not clothes else f"已有 {count}/{total} 件可参考，待补齐 {len(missing)} 件；请结合实物确认版型与颜色"
        if uncertain:
            reason += f"；其中 {uncertain} 件颜色信息不足，已计入可参考覆盖率，需确认实物颜色"
        preference = feedback.get(outfit["id"])
        recency = recent.get(outfit["id"], 0)
        if preference:
            reason += "；相同覆盖下，" + ("你喜欢的搭配优先" if preference == "like" else "你不喜欢的搭配后移，可在详情取消反馈")
        if recency:
            reason += "；最近七天穿过，相同覆盖与偏好下适当后移，越近影响越大"
        results.append({"outfit": outfit, "matched": matched, "missing": missing, "owned_count": count, "total_count": total, "coverage": coverage, "reason": reason, "quality": quality, "preference": {"like": 1, "dislike": -1}.get(preference, 0), "recency": recency})
    results.sort(key=lambda plan: (-plan["coverage"], -plan["owned_count"], -plan["preference"], plan["recency"], -plan["quality"], plan["outfit"]["id"]))
    return {"items": results, "wardrobe_total": len(clothes)}
