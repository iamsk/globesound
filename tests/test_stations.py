from globesound.stations import FIELDS, MIXED, classify, compact


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
