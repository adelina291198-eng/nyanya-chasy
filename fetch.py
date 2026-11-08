"""Собирает погоду и подсказку «можно ли гулять» для Уфы и кладёт в data.json.

Источник — open-meteo.com: бесплатно, без ключей, без личных данных.
Если источник не ответил — старый data.json остаётся как был, приложение не ломается.
Запуск: python fetch.py  (лишние библиотеки не нужны)
"""
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

CITY = "Уфа"
LAT, LON = 54.74, 55.97
TZ = "Asia/Yekaterinburg"  # Уфа живёт по тому же времени (UTC+5)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.json")

WEATHER_URL = (
    "https://api.open-meteo.com/v1/forecast"
    f"?latitude={LAT}&longitude={LON}&timezone={TZ}&forecast_days=3"
    "&daily=weather_code,temperature_2m_max,temperature_2m_min,"
    "apparent_temperature_max,apparent_temperature_min,precipitation_sum,"
    "precipitation_probability_max,wind_speed_10m_max,sunrise,sunset"
    "&wind_speed_unit=ms"
)
AIR_URL = (
    "https://air-quality-api.open-meteo.com/v1/air-quality"
    f"?latitude={LAT}&longitude={LON}&timezone={TZ}&forecast_days=3"
    "&hourly=european_aqi"
)

# коды погоды open-meteo → понятные слова
CODES = {
    0: ("☀️", "ясно"), 1: ("🌤️", "почти ясно"), 2: ("⛅", "переменная облачность"), 3: ("☁️", "пасмурно"),
    45: ("🌫️", "туман"), 48: ("🌫️", "туман с изморозью"),
    51: ("🌦️", "морось"), 53: ("🌦️", "морось"), 55: ("🌧️", "сильная морось"),
    56: ("🌧️", "ледяная морось"), 57: ("🌧️", "ледяная морось"),
    61: ("🌧️", "небольшой дождь"), 63: ("🌧️", "дождь"), 65: ("🌧️", "ливень"),
    66: ("🧊", "ледяной дождь"), 67: ("🧊", "ледяной дождь"),
    71: ("🌨️", "небольшой снег"), 73: ("🌨️", "снег"), 75: ("❄️", "сильный снег"), 77: ("🌨️", "снежная крупа"),
    80: ("🌦️", "ливень"), 81: ("🌧️", "ливень"), 82: ("⛈️", "сильный ливень"),
    85: ("🌨️", "снегопад"), 86: ("❄️", "сильный снегопад"),
    95: ("⛈️", "гроза"), 96: ("⛈️", "гроза с градом"), 99: ("⛈️", "гроза с градом"),
}
AIR_WORDS = [(20, "отличный"), (40, "хороший"), (60, "средний"), (80, "плохой"), (100, "очень плохой")]


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "nyanya-chasy-weather"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def air_word(aqi):
    for limit, word in AIR_WORDS:
        if aqi <= limit:
            return word
    return "опасный"


def clothes(feels):
    if feels <= -25: return "очень холодно: лучше остаться дома"
    if feels <= -15: return "зимний комбинезон, двое варежек, шарф на лицо"
    if feels <= -5:  return "зимний комбинезон, шапка, варежки"
    if feels <= 5:   return "тёплая куртка, шапка, перчатки"
    if feels <= 12:  return "демисезонная куртка, лёгкая шапка"
    if feels <= 20:  return "кофта или ветровка"
    if feels <= 27:  return "футболка, панамка"
    return "жарко: лёгкая одежда, панамка, вода с собой"


def walk(day):
    """Решение «гулять / коротко / дома» и короткая причина."""
    reasons, level = [], "ok"  # ok → short → home
    feels = day["feels_min"]
    if feels <= -25 or day["feels_max"] >= 32:
        level = "home"; reasons.append("слишком холодно" if feels <= -25 else "слишком жарко")
    elif feels <= -15:
        level = "short"; reasons.append("мороз — гулять недолго")
    if day["code"] in (66, 67, 82, 95, 96, 99):
        level = "home"; reasons.append(day["text"])
    elif day["rain_chance"] >= 70 and day["rain_mm"] >= 3:
        level = max(level, "short", key=["ok", "short", "home"].index); reasons.append("дождь или снег — взять дождевик")
    if day["wind"] >= 12:
        level = max(level, "short", key=["ok", "short", "home"].index); reasons.append("сильный ветер")
    if day.get("air_index") is not None and day["air_index"] > 80:
        level = "home"; reasons.append("грязный воздух")
    elif day.get("air_index") is not None and day["air_index"] > 60:
        level = max(level, "short", key=["ok", "short", "home"].index); reasons.append("воздух так себе")
    title = {"ok": "Гулять можно", "short": "Гулять недолго", "home": "Лучше дома"}[level]
    return level, title, ", ".join(reasons) or "погода подходит для прогулки"


def build():
    w = get_json(WEATHER_URL)["daily"]
    air = {}
    try:
        a = get_json(AIR_URL)["hourly"]
        for t, v in zip(a["time"], a["european_aqi"]):
            if v is not None:
                d = t[:10]
                air[d] = max(air.get(d, 0), v)
    except Exception as e:  # качество воздуха — не главное, без него тоже работаем
        print("Качество воздуха не получено:", e, file=sys.stderr)

    days = []
    for i, date in enumerate(w["time"]):
        code = int(w["weather_code"][i])
        icon, text = CODES.get(code, ("🌡️", "без описания"))
        day = {
            "date": date,
            "icon": icon,
            "text": text,
            "code": code,
            "t_min": round(w["temperature_2m_min"][i]),
            "t_max": round(w["temperature_2m_max"][i]),
            "feels_min": round(w["apparent_temperature_min"][i]),
            "feels_max": round(w["apparent_temperature_max"][i]),
            "rain_mm": round(w["precipitation_sum"][i] or 0, 1),
            "rain_chance": int(w["precipitation_probability_max"][i] or 0),
            "wind": round(w["wind_speed_10m_max"][i]),
            "sunrise": w["sunrise"][i][11:16],
            "sunset": w["sunset"][i][11:16],
            "air_index": round(air[date]) if date in air else None,
        }
        day["air_text"] = air_word(day["air_index"]) if day["air_index"] is not None else None
        day["walk"], day["walk_title"], day["walk_why"] = walk(day)
        day["clothes"] = clothes(round((day["feels_min"] + day["feels_max"]) / 2))
        days.append(day)
    if len(days) < 1:
        raise ValueError("пустой прогноз")

    now = datetime.now(timezone(timedelta(hours=5)))
    return {
        "city": CITY,
        "updated": now.isoformat(timespec="seconds"),
        "updated_text": now.strftime("%d.%m.%Y %H:%M") + " (по Уфе)",
        "source": "open-meteo.com",
        "days": days,
    }


def main():
    try:
        data = build()
    except Exception as e:
        print("Источник не ответил, оставляю старый data.json:", e, file=sys.stderr)
        return 0  # не ломаем задание и приложение
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, OUT)
    print("data.json обновлён:", data["updated_text"], "—", data["days"][0]["walk_title"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
