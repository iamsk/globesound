"""球面几何：球静止时测到的"正上方"向量 → 读数点（球顶）正下方的经纬度。

核心事实：传感器牢牢固定在球里，球静止时加速度计测到的就是"正上方"在传感器
坐标系里的方向。传感器坐标系和地理坐标系之间只差一个固定旋转，用几个已知地点
标定一次就能求出来。整个过程只用重力，不用磁力计和偏航角，所以不会漂；
子午圈默认的 23.5° 倾角、底座是否转动，都不影响计算。
"""
from __future__ import annotations

import json
import math
from collections import deque
from dataclasses import dataclass
from pathlib import Path

import numpy as np

# 标定点：依次把这些地方转到"子午圈最高点"正下方。四个点互不共面，
# 既能求出旋转，也能自动判断加速度计的符号约定，还能算残差检查放得准不准。
CALIBRATION_POINTS: list[tuple[str, float, float]] = [
    ("北极", 90.0, 0.0),
    ("几内亚湾：赤道和本初子午线的交点 (0°, 0°)", 0.0, 0.0),
    ("新加坡", 1.35, 103.82),
    ("悉尼", -33.87, 151.21),
]

RMS_WARN_DEG = 3.0  # 标定残差超过这个值，说明有标定点放偏了


def latlon_to_vec(lat: float, lon: float) -> np.ndarray:
    la, lo = math.radians(lat), math.radians(lon)
    return np.array([math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)])


def vec_to_latlon(v) -> tuple[float, float]:
    v = np.asarray(v, dtype=float)
    v = v / np.linalg.norm(v)
    lat = math.degrees(math.asin(max(-1.0, min(1.0, float(v[2])))))
    lon = math.degrees(math.atan2(float(v[1]), float(v[0])))
    return lat, lon


def angle_deg(a, b) -> float:
    a = np.asarray(a, dtype=float) / np.linalg.norm(a)
    b = np.asarray(b, dtype=float) / np.linalg.norm(b)
    return math.degrees(math.acos(max(-1.0, min(1.0, float(np.dot(a, b))))))


def solve_rotation(src, dst) -> np.ndarray:
    """Wahba 问题：求正交旋转 R（det=+1），使 Σ|dst_i − R·src_i|² 最小。"""
    h = sum(np.outer(d, s) for s, d in zip(src, dst))
    u, _, vt = np.linalg.svd(h)
    d = np.diag([1.0, 1.0, float(np.sign(np.linalg.det(u @ vt)))])
    return u @ d @ vt


@dataclass
class Calibration:
    rotation: np.ndarray  # 传感器坐标系 → 地理坐标系
    sign: int             # 加速度计的符号约定：+1 表示静止读数指向上方
    rms_deg: float        # 标定残差

    def to_latlon(self, up_sensor) -> tuple[float, float]:
        return vec_to_latlon(self.rotation @ (self.sign * np.asarray(up_sensor, dtype=float)))

    def save(self, path: Path) -> None:
        Path(path).write_text(json.dumps(
            {"rotation": self.rotation.tolist(), "sign": self.sign, "rms_deg": self.rms_deg},
            ensure_ascii=False, indent=2,
        ))

    @classmethod
    def load(cls, path: Path) -> "Calibration":
        d = json.loads(Path(path).read_text())
        return cls(np.array(d["rotation"], dtype=float), int(d["sign"]), float(d["rms_deg"]))


def calibrate(ups_sensor, latlons) -> Calibration:
    """ups_sensor：每个标定点测到的"上"向量；latlons：对应的已知经纬度。至少 3 个不共面的点。"""
    if len(ups_sensor) < 3 or len(ups_sensor) != len(latlons):
        raise ValueError("至少需要 3 个标定点，且向量和经纬度一一对应")
    geo = [latlon_to_vec(lat, lon) for lat, lon in latlons]
    best: Calibration | None = None
    for sign in (1, -1):
        src = [sign * np.asarray(u, dtype=float) for u in ups_sensor]
        rot = solve_rotation(src, geo)
        errs = [angle_deg(g, rot @ s) for s, g in zip(src, geo)]
        rms = math.sqrt(sum(e * e for e in errs) / len(errs))
        if best is None or rms < best.rms_deg:
            best = Calibration(rot, sign, rms)
    return best


class StillDetector:
    """球静止一段时间后，输出平均后的"上"向量；转动中返回 None。"""

    def __init__(self, gyro_max_dps: float = 3.0, acc_tol_g: float = 0.05, window: int = 10):
        self.gyro_max_dps = gyro_max_dps
        self.acc_tol_g = acc_tol_g
        self.window = window  # 默认 10Hz 下约 1 秒
        self._samples: deque[np.ndarray] = deque(maxlen=window)

    def reset(self) -> None:
        self._samples.clear()

    def update(self, acc, gyro) -> np.ndarray | None:
        acc = np.asarray(acc, dtype=float)
        n = float(np.linalg.norm(acc))
        still = float(np.abs(np.asarray(gyro, dtype=float)).max()) < self.gyro_max_dps and abs(n - 1.0) < self.acc_tol_g
        if not still:
            self._samples.clear()
            return None
        self._samples.append(acc / n)
        if len(self._samples) < self.window:
            return None
        u = np.mean(self._samples, axis=0)
        return u / np.linalg.norm(u)
