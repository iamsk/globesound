"""电台目录：从 Radio Browser 拉取带坐标的电台，精简后缓存在本地。

Radio Browser（https://www.radio-browser.info）是社区维护的免费目录，RoamDial 用的也是它。
只取带经纬度、没被标记为失效的电台（约 1.4 万个），每个电台按标签归到一个曲风。
缓存默认放在 stations_cache.json，7 天内不重新拉取；拉取失败时退回旧缓存。
"""
from __future__ import annotations

import json
import time
import urllib.request
from pathlib import Path

MIRRORS = ["de1.api.radio-browser.info", "de2.api.radio-browser.info", "fi1.api.radio-browser.info"]
QUERY = "/json/stations/search?has_geo_info=true&hidebroken=true&limit=100000"
USER_AGENT = "globesound/0.1"
MAX_AGE_S = 7 * 24 * 3600
FIELDS = ["name", "url", "lat", "lon", "country", "cc", "genre", "lang", "bitrate", "codec", "clicks"]

# 按顺序匹配标签里的关键词，命中第一个就定下曲风；都不中就是"综合"
GENRES: list[tuple[str, tuple[str, ...]]] = [
    ("宗教", ("christian", "gospel", "religi", "catholic", "worship", "islam", "quran", "church", "bible")),
    ("新闻·谈话", ("news", "talk", "noticias", "información", "informacion", "sport", "deportes", "nachrichten")),
    ("古典", ("classical", "clásica", "clasica", "klassik", "baroque", "opera", "symphon")),
    ("爵士·蓝调", ("jazz", "blues", "soul", "swing")),
    ("电子", ("electronic", "dance", "house", "techno", "trance", "edm", "lounge", "chill", "ambient")),
    ("嘻哈", ("hip hop", "hip-hop", "hiphop", "rap", "r&b", "rnb")),
    ("摇滚", ("rock", "metal", "punk", "alternative", "indie")),
    ("乡村·民谣", ("country", "folk", "bluegrass")),
    ("流行", ("pop", "hits", "top 40", "top40", "80s", "90s", "oldies", "charts")),
]
MIXED = "综合"


def classify(tags: str) -> str:
    t = (tags or "").lower()
    for genre, keys in GENRES:
        if any(k in t for k in keys):
            return genre
    return MIXED


def compact(raw: list[dict]) -> list[list]:
    """只留网页要用的字段；同一个流地址重复登记的，保留点击最多的那条。"""
    best: dict[str, dict] = {}
    for s in raw:
        url = (s.get("url_resolved") or s.get("url") or "").strip()
        if not url or s.get("geo_lat") is None or s.get("geo_long") is None:
            continue
        if url not in best or (s.get("clickcount") or 0) > (best[url].get("clickcount") or 0):
            best[url] = s | {"_url": url}
    rows = []
    for s in best.values():
        rows.append([
            " ".join((s.get("name") or "").split()) or "(未命名电台)",
            s["_url"],
            round(float(s["geo_lat"]), 4),
            round(float(s["geo_long"]), 4),
            s.get("country") or "",
            s.get("countrycode") or "",
            classify(s.get("tags") or ""),
            (s.get("language") or "").split(",")[0].strip(),
            int(s.get("bitrate") or 0),
            s.get("codec") or "",
            int(s.get("clickcount") or 0),
        ])
    rows.sort(key=lambda r: -r[-1])
    return rows


def fetch(timeout: float = 60.0) -> list[dict]:
    last_err: Exception | None = None
    for host in MIRRORS:
        try:
            req = urllib.request.Request(f"https://{host}{QUERY}", headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.load(resp)
        except Exception as e:  # 换下一个镜像
            last_err = e
    raise RuntimeError(f"Radio Browser 的镜像都连不上：{last_err}")


def load_or_fetch(path: Path, log=print) -> Path | None:
    """确保缓存文件可用，返回它的路径；拉不到也没有旧缓存时返回 None。"""
    path = Path(path)
    if path.exists() and time.time() - path.stat().st_mtime < MAX_AGE_S:
        return path
    try:
        log("从 Radio Browser 拉取电台目录……")
        rows = compact(fetch())
        path.write_text(json.dumps({"fetched": int(time.time()), "fields": FIELDS, "rows": rows},
                                   ensure_ascii=False, separators=(",", ":")))
        log(f"电台目录已缓存：{len(rows)} 个电台 → {path}")
        return path
    except Exception as e:
        if path.exists():
            log(f"电台目录更新失败，先用旧缓存：{e}")
            return path
        log(f"电台目录拉取失败，网页上不会有电台：{e}")
        return None
