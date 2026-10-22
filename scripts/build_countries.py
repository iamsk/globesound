"""生成网页行政地球仪用的国界：globesound/static/countries.json

数据来源：Natural Earth 10m 国界的"中国立场"版本（ne_10m_admin_0_countries_chn），
台湾并入中国，藏南、阿克赛钦按中国主张绘制。原始文件 13MB，这里用 Douglas-Peucker
简化、坐标保留两位小数、丢掉很小的岛，压到几百 KB。只用标准库：

    python scripts/build_countries.py [原始 geojson 路径]

不给路径就从 jsDelivr 下载。生成结果提交进仓库，平时不用重新跑。
"""
from __future__ import annotations

import json
import math
import sys
import urllib.request
from pathlib import Path

SRC_URL = ("https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/"
           "geojson/ne_10m_admin_0_countries_chn.geojson")
DST = Path(__file__).resolve().parent.parent / "globesound" / "static" / "countries.json"
TOLERANCE_DEG = 0.06    # 简化容差，约 6 km；网页上看不出来
MIN_RING_AREA = 0.02    # 平方度；比这小的岛丢掉（每个国家至少留最大的一块）
# 香港、澳门是单独的要素，按中国配色画
SAME_AS_CHINA = {"HKG", "MAC"}
SHORT_NAMES = {  # 地球仪上写简称
    "CHN": "中国", "PRK": "朝鲜", "KOR": "韩国", "COD": "刚果（金）", "COG": "刚果（布）",
    "ARE": "阿联酋", "CAF": "中非", "BIH": "波黑",
}


def rdp(points: list[list[float]], tol: float) -> list[list[float]]:
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        (x1, y1), (x2, y2) = points[a], points[b]
        dx, dy = x2 - x1, y2 - y1
        norm = math.hypot(dx, dy) or 1e-12
        best, idx = 0.0, -1
        for i in range(a + 1, b):
            x, y = points[i]
            d = abs(dy * (x - x1) - dx * (y - y1)) / norm if (dx or dy) else math.hypot(x - x1, y - y1)
            if d > best:
                best, idx = d, i
        if best > tol and idx > 0:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(points, keep) if k]


def ring_area(ring) -> float:
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]))) / 2


def simplify_polygon(poly):
    out = []
    for i, ring in enumerate(poly):
        r = [[round(x, 2), round(y, 2)] for x, y in rdp(ring, TOLERANCE_DEG)]
        r = [p for j, p in enumerate(r) if j == 0 or p != r[j - 1]]
        if len(r) < 4:
            if i == 0:
                return None  # 外环都没了，整块不要
            continue
        out.append(r)
    return out


def simplify(geom) -> list:
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    polys = sorted(polys, key=lambda p: -ring_area(p[0]))
    out = []
    for i, poly in enumerate(polys):
        if i > 0 and ring_area(poly[0]) < MIN_RING_AREA:
            continue
        s = simplify_polygon(poly)
        if s:
            out.append(s)
    if not out and polys:  # 小岛国：至少保留最大的那块，不简化
        out.append([[[round(x, 2), round(y, 2)] for x, y in ring] for ring in polys[0]])
    return out


def main() -> None:
    if len(sys.argv) > 1:
        src = json.loads(Path(sys.argv[1]).read_text())
    else:
        print("下载 Natural Earth 国界（中国立场，约 13MB）……", file=sys.stderr)
        with urllib.request.urlopen(SRC_URL, timeout=120) as resp:
            src = json.load(resp)
    china_color = next(f["properties"]["MAPCOLOR7"] for f in src["features"] if f["properties"]["ADM0_A3"] == "CHN")
    features = []
    for f in src["features"]:
        p = f["properties"]
        polys = simplify(f["geometry"])
        if not polys:
            continue
        iso = p["ADM0_A3"]
        features.append({
            "type": "Feature",
            "properties": {
                "iso": iso,
                "name": SHORT_NAMES.get(iso) or p.get("NAME_ZH") or p.get("NAME"),
                "color": china_color if iso in SAME_AS_CHINA else p.get("MAPCOLOR7", 1),
                "label": [round(p.get("LABEL_X") or 0, 2), round(p.get("LABEL_Y") or 0, 2)],
                "rank": p.get("MIN_LABEL", 10),
            },
            "geometry": {"type": "MultiPolygon", "coordinates": polys},
        })
    DST.write_text(json.dumps({"type": "FeatureCollection", "features": features},
                              ensure_ascii=False, separators=(",", ":")))
    print(f"{len(features)} 个国家和地区 → {DST}（{DST.stat().st_size // 1024} KB）", file=sys.stderr)


if __name__ == "__main__":
    main()
