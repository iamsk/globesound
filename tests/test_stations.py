import json
import time

from globesound.stations import FIELDS, MIXED, classify, compact, load_or_fetch


def test_classify():
    assert classify("Jazz,Smooth") == "爵士·蓝调"
    assert classify("christian rock") == "宗教"   # 宗教优先于摇滚
    assert classify("noticias,pop") == "新闻·谈话"
    assert classify("") == MIXED


def test_compact_dedupes_and_drops_missing_geo():
    raw = [
        {"name": " A \t", "url_resolved": "http://x", "geo_lat": 1, "geo_long": 2, "clickcount": 5, "tags": "rock"},
        {"name": "A2", "url_resolved": "http://x", "geo_lat": 1, "geo_long": 2, "clickcount": 9, "tags": ""},
        {"name": "B", "url_resolved": "http://y", "geo_lat": None, "geo_long": 2},
    ]
    rows = compact(raw)
    assert len(rows) == 1 and len(rows[0]) == len(FIELDS)
    row = dict(zip(FIELDS, rows[0]))
    assert row["name"] == "A2" and row["clicks"] == 9 and row["genre"] == MIXED


def test_extra_stations_merge_into_fresh_cache(tmp_path):
    cache, extra = tmp_path / "cache.json", tmp_path / "extra.json"
    row = ["Old", "http://dup", 1, 2, "", "", MIXED, "", 0, "", 0]
    cache.write_text(json.dumps({"fetched": int(time.time()), "fields": FIELDS, "rows": [row]}))
    assert load_or_fetch(cache, lambda *_: None, extra) == cache  # 没有补充表，缓存原样用
    time.sleep(0.01)
    extra.write_text(json.dumps([
        {"name": "深圳新闻广播", "url": "http://sz", "lat": 22.54, "lon": 114.06, "genre": "新闻·谈话"},
        {"name": "New", "url": "http://dup", "lat": 1, "lon": 2},
    ]))
    load_or_fetch(cache, lambda *_: None, extra)  # 补充表更新了：不联网，直接并进去
    rows = [dict(zip(FIELDS, r)) for r in json.loads(cache.read_text())["rows"]]
    assert [r["name"] for r in rows] == ["深圳新闻广播", "New"]  # 重复的流地址以补充表为准
    assert rows[1]["genre"] == MIXED
