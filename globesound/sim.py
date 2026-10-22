"""万向地球仪的模拟器：没有硬件时，用它产生和 BWT901BLECL 一样的数据包。

世界坐标系：z 朝上，y 是子午圈在支架里转动的轴（指向观察者）。
万向地球仪 = 子午圈转角 ring（北极离开正上方的角度，默认约 23.5°）+ 球绕极轴自转 spin。
测试和 `python -m globesound --simulate` 共用这一份机构模型。
"""
from __future__ import annotations

import asyncio
import math
from collections.abc import Callable, Iterator

import numpy as np

from . import witmotion
from .geo import CALIBRATION_POINTS, Calibration, calibrate

UP = np.array([0.0, 0.0, 1.0])

# 模拟巡游：依次把这些地方转到球顶，每处停一会儿，让静止判断有机会触发
TOUR: list[tuple[str, float, float]] = [
    ("深圳", 22.54, 114.06),
    ("新加坡", 1.35, 103.82),
    ("悉尼", -33.87, 151.21),
    ("开普敦", -33.92, 18.42),
    ("伦敦", 51.51, -0.13),
    ("雷克雅未克", 64.15, -21.94),
    ("纽约", 40.71, -74.01),
    ("里约热内卢", -22.91, -43.17),
    ("檀香山", 21.31, -157.86),
]


def rot(axis, deg) -> np.ndarray:
    axis = np.asarray(axis, dtype=float) / np.linalg.norm(axis)
    a = math.radians(deg)
    k = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    return np.eye(3) + math.sin(a) * k + (1 - math.cos(a)) * (k @ k)


def gimbal(ring_deg: float, spin_deg: float) -> np.ndarray:
    """地理坐标系 → 世界坐标系的旋转。"""
    return rot([0, 1, 0], ring_deg) @ rot([0, 0, 1], spin_deg)


def pose_for(lat: float, lon: float) -> tuple[float, float]:
    """把 (lat, lon) 转到球顶需要的子午圈转角和自转角。"""
    return 90.0 - lat, 180.0 - lon


def random_rotation(rng) -> np.ndarray:
    q = rng.normal(size=4)
    q /= np.linalg.norm(q)
    w, x, y, z = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])


def rotation_angle_deg(r: np.ndarray) -> float:
    return math.degrees(math.acos(max(-1.0, min(1.0, (float(np.trace(r)) - 1.0) / 2.0))))


class SimulatedGlobe:
    """一台装好传感器的虚拟地球仪。mount：地理坐标系 → 传感器坐标系（安装姿态，随机）。"""

    def __init__(self, seed: int | None = None, rate_hz: float = 10.0,
                 acc_noise_g: float = 0.002, gyro_noise_dps: float = 0.3):
        self.rng = np.random.default_rng(seed)
        self.mount = random_rotation(self.rng)
        self.rate_hz = rate_hz
        self.acc_noise_g = acc_noise_g
        self.gyro_noise_dps = gyro_noise_dps

    def up_sensor(self, ring: float, spin: float) -> np.ndarray:
        """球在这个姿态静止时，加速度计测到的方向（维特的约定：静止读数指向上方）。"""
        return self.mount @ gimbal(ring, spin).T @ UP

    def calibration(self) -> Calibration:
        """相当于用户把 4 个标定点都放得很准时得到的标定。"""
        ups = [self.up_sensor(*pose_for(lat, lon)) for _n, lat, lon in CALIBRATION_POINTS]
        return calibrate(ups, [(lat, lon) for _n, lat, lon in CALIBRATION_POINTS])

    def poses(self, tour=TOUR, move_s: float = 2.0, hold_s: float = 2.5) -> Iterator[tuple[float, float]]:
        """沿巡游路线逐个采样时刻的 (ring, spin)，循环往复。"""
        n_move, n_hold = max(1, round(move_s * self.rate_hz)), round(hold_s * self.rate_hz)
        ring, spin = 23.5, 0.0  # 出厂姿态
        while True:
            for _name, lat, lon in tour:
                r1, s1 = pose_for(lat, lon)
                ds = (s1 - spin + 180.0) % 360.0 - 180.0  # 走近的那一边
                for i in range(1, n_move + 1):
                    t = 0.5 - 0.5 * math.cos(math.pi * i / n_move)  # 起止都慢
                    yield ring + (r1 - ring) * t, spin + ds * t
                ring, spin = r1, spin + ds
                for _ in range(n_hold):
                    yield ring, spin

    def packets(self, poses: Iterator[tuple[float, float]]) -> Iterator[bytes]:
        dt = 1.0 / self.rate_hz
        prev = None
        for ring, spin in poses:
            att = self.mount @ gimbal(ring, spin).T  # 世界坐标系 → 传感器坐标系
            rate = 0.0 if prev is None else rotation_angle_deg(att @ prev.T) / dt
            prev = att
            acc = self.up_sensor(ring, spin) + self.rng.normal(scale=self.acc_noise_g, size=3)
            # 只有角速度的大小影响静止判断，方向随便给一个
            gyro = np.array([rate, 0.0, 0.0]) + self.rng.normal(scale=self.gyro_noise_dps, size=3)
            yield witmotion.build_packet(acc, gyro)

    async def run(self, on_notify: Callable[[object, bytearray], None], **tour_kw) -> None:
        """按真实频率把数据包交给 on_notify，接口和 BleakClient.start_notify 的回调一致。"""
        for pkt in self.packets(self.poses(**tour_kw)):
            on_notify(None, bytearray(pkt))
            await asyncio.sleep(1.0 / self.rate_hz)
