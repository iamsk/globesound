"""用模拟的万向地球仪验证几何与标定。不需要硬件：python -m pytest -q

机构模型（ring、spin 的定义）见 globesound/sim.py。
"""
import math

import numpy as np

from globesound.geo import (
    CALIBRATION_POINTS,
    RMS_WARN_DEG,
    StillDetector,
    angle_deg,
    calibrate,
    latlon_to_vec,
    vec_to_latlon,
)
from globesound.sim import UP, gimbal, pose_for, random_rotation


def measure(mount, ring, spin, rng, noise_deg=0.0, flip=False):
    """模拟传感器在某个姿态下测到的"上"向量。mount：地理坐标系 → 传感器坐标系。"""
    up_geo = gimbal(ring, spin).T @ UP
    u = mount @ up_geo + rng.normal(scale=math.radians(noise_deg), size=3)
    u /= np.linalg.norm(u)
    return -u if flip else u


def test_default_tilt_only_reads_arctic_circle():
    # 子午圈停在默认 23.5° 时，只转球，球顶永远在北纬 66.5° 那一圈上
    for spin in range(0, 360, 30):
        lat, _ = vec_to_latlon(gimbal(23.5, spin).T @ UP)
        assert abs(lat - 66.5) < 1e-9


def test_gimbal_reaches_any_point():
    rng = np.random.default_rng(0)
    for _ in range(200):
        lat, lon = rng.uniform(-90, 90), rng.uniform(-180, 180)
        up_geo = gimbal(*pose_for(lat, lon)).T @ UP
        assert angle_deg(up_geo, latlon_to_vec(lat, lon)) < 1e-6


def run_calibrated(rng, noise_deg, flip):
    mount = random_rotation(rng)
    ups = [measure(mount, *pose_for(lat, lon), rng, noise_deg, flip) for _n, lat, lon in CALIBRATION_POINTS]
    cal = calibrate(ups, [(lat, lon) for _n, lat, lon in CALIBRATION_POINTS])
    worst = 0.0
    for _ in range(50):
        lat, lon = rng.uniform(-85, 85), rng.uniform(-180, 180)
        got = cal.to_latlon(measure(mount, *pose_for(lat, lon), rng, noise_deg, flip))
        worst = max(worst, angle_deg(latlon_to_vec(*got), latlon_to_vec(lat, lon)))
    return cal, worst


def test_calibration_exact_without_noise():
    rng = np.random.default_rng(1)
    for flip in (False, True):
        cal, worst = run_calibrated(rng, 0.0, flip)
        assert cal.rms_deg < 1e-6
        assert worst < 1e-6


def test_calibration_with_sensor_noise():
    # 噪声 0.2°（与 BWT901BLECL 标称倾角精度相当），任意安装方向、两种符号约定
    rng = np.random.default_rng(2)
    for trial in range(40):
        cal, worst = run_calibrated(rng, 0.2, flip=trial % 2 == 1)
        assert cal.rms_deg < RMS_WARN_DEG
        assert worst < 1.5


def test_misplaced_calibration_point_is_flagged():
    rng = np.random.default_rng(3)
    mount = random_rotation(rng)
    pts = [(lat, lon) for _n, lat, lon in CALIBRATION_POINTS]
    ups = [measure(mount, *pose_for(lat, lon), rng) for lat, lon in pts]
    ups[2] = measure(mount, *pose_for(pts[2][0] + 10, pts[2][1] + 10), rng)  # 新加坡放偏了约 14°
    assert calibrate(ups, pts).rms_deg > RMS_WARN_DEG


def test_still_detector():
    det = StillDetector(window=5)
    assert det.update([0, 0.6, 0.8], [50, 0, 0]) is None        # 在转
    for _ in range(4):
        assert det.update([0, 0.6, 0.8], [0.5, 0, 0]) is None   # 静止但样本还不够
    up = det.update([0, 0.6, 0.8], [0.5, 0, 0])
    assert up is not None and np.allclose(up, [0, 0.6, 0.8])
    assert det.update([0, 0.6, 0.8], [10, 0, 0]) is None        # 又动了
