import asyncio
import math
import time
from collections import OrderedDict

import httpx

GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
CACHE_TTL = 300
CACHE_LIMIT = 128
_cache = OrderedDict()
_inflight = {}


def failure(status, message):
    return {"status": status, "message": message}


def normalize(city):
    return city.strip().removesuffix("市").casefold()


def describe(code):
    if code == 0:
        return "晴朗", "晴朗"
    if code in (1, 2):
        return "多云", "多云"
    if code == 3:
        return "阴天", "多云"
    if code in (45, 48):
        return "雾", "多云"
    if code in (51, 53, 55, 56, 57):
        return "毛毛雨", "雨天"
    if code in (61, 63, 65, 66, 67, 80, 81, 82):
        return "雨天", "雨天"
    if code in (71, 73, 75, 77, 85, 86):
        return "雪天", "雪天"
    if code in (95, 96, 99):
        return "雷雨", "雨天"
    raise ValueError("Unknown weather code")


async def fetch_weather(city):
    async with httpx.AsyncClient(timeout=httpx.Timeout(6.0), follow_redirects=False) as client:
        response = await client.get(GEOCODING_URL, params={"name": city.removesuffix("市"), "count": 20, "language": "zh", "format": "json"})
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict) or payload.get("error"):
            raise ValueError("Invalid geocoding response")
        results = payload.get("results", [])
        if not isinstance(results, list) or any(not isinstance(item, dict) for item in results):
            raise ValueError("Invalid geocoding results")
        if not results:
            return failure("not_found", "未找到资料城市，请在个人资料中填写准确城市名称后重试。")
        exact = [item for item in results if normalize(item.get("name", "")) == normalize(city)]
        candidates = exact or results
        if any("\u4e00" <= char <= "\u9fff" for char in city):
            chinese = [item for item in candidates if item.get("country_code") == "CN"]
            candidates = chinese or candidates
        city_seats = [item for item in candidates if item.get("feature_code") in ("PPLC", "PPLA", "PPLA2")]
        candidates = city_seats or candidates
        unique = {(item.get("latitude"), item.get("longitude")): item for item in candidates}
        if len(unique) != 1:
            return failure("ambiguous", "资料城市匹配到多个地点，请在个人资料中补充省份或国家（如 Paris, France）后重试。")
        location = next(iter(unique.values()))
        latitude, longitude = location["latitude"], location["longitude"]
        if not all(type(value) in (int, float) and math.isfinite(value) for value in (latitude, longitude)) or not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            raise ValueError("Invalid coordinates")
        response = await client.get(FORECAST_URL, params={"latitude": latitude, "longitude": longitude, "current": "temperature_2m,weather_code", "temperature_unit": "celsius", "timezone": "auto"})
        response.raise_for_status()
        payload = response.json()
        current = payload["current"]
        temperature = current["temperature_2m"]
        code = current["weather_code"]
        if type(temperature) not in (int, float) or not math.isfinite(temperature) or type(code) is not int:
            raise ValueError("Invalid current weather")
        if not isinstance(current["time"], str) or not current["time"] or not isinstance(payload["timezone"], str):
            raise ValueError("Invalid weather time")
        label, stylist_weather = describe(code)
        return {"status": "ok", "temperature": temperature, "weather": label, "stylist_weather": stylist_weather, "weather_code": code, "observed_at": current["time"], "timezone": payload["timezone"], "location": " · ".join(dict.fromkeys(value for value in (location["name"], location.get("admin1"), location.get("country")) if value)), "source": "Open-Meteo"}


async def load_weather(city):
    try:
        result = await asyncio.wait_for(fetch_weather(city), timeout=15)
    except (httpx.TimeoutException, asyncio.TimeoutError):
        return failure("timeout", "天气服务请求超时，请重试。")
    except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
        return failure("unavailable", "天气服务暂不可用或返回数据不完整，请稍后重试。")
    if result["status"] == "ok":
        _cache[city] = (time.monotonic() + CACHE_TTL, result)
        _cache.move_to_end(city)
        while len(_cache) > CACHE_LIMIT:
            _cache.popitem(last=False)
    return result


async def current_weather(city):
    city = (city or "").strip()
    if not city:
        return {**failure("missing_city", "请先在个人资料中设置城市，再重试获取天气。"), "city": city}
    cached = _cache.get(city)
    if cached and cached[0] > time.monotonic():
        _cache.move_to_end(city)
        return {**cached[1], "city": city}
    _cache.pop(city, None)
    # Concurrent requests for one city share the same bounded upstream operation.
    if city not in _inflight:
        task = asyncio.create_task(load_weather(city))
        _inflight[city] = task
        task.add_done_callback(lambda completed: _inflight.pop(city, None) if _inflight.get(city) is completed else None)
    result = await asyncio.shield(_inflight[city])
    return {**result, "city": city}


def register(api):
    @api.app.get("/api/weather")
    async def weather(phone: str):
        profile = await api.get_or_create_user(phone)
        result = await current_weather(profile.get("city"))
        return {**result, "location_basis": "profile_city"}
