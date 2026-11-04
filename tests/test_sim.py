"""模拟器端到端：虚拟数据包 → 解析 → 静止判断 → 标定 → 经纬度，和真机走同一条路。"""
import itertools

from globesound.cli import Session
from globesound.geo import angle_deg, latlon_to_vec
from globesound.sim import TOUR, SimulatedGlobe


def test_tour_reads_every_city():
    sim = SimulatedGlobe(seed=7)
    cal = sim.calibration()
    assert cal.rms_deg < 1e-6
    session = Session()
    n = len(TOUR) * (20 + 25)  # 一圈巡游：每站移动 2 秒 + 停留 2.5 秒，10Hz
    fixes = []
    for pkt in itertools.islice(sim.packets(sim.poses()), n):
        session.on_notify(None, bytearray(pkt))
        if session.up is not None:
            fixes.append(cal.to_latlon(session.up))
    for _name, lat, lon in TOUR:
        best = min(angle_deg(latlon_to_vec(*f), latlon_to_vec(lat, lon)) for f in fixes)
        assert best < 0.5
    # 移动途中不应该误判为静止：所有静止读数都落在某个城市附近
    for f in fixes:
        assert min(angle_deg(latlon_to_vec(*f), latlon_to_vec(lat, lon)) for _n, lat, lon in TOUR) < 0.5


def test_live_direction_follows_motion():
    sim = SimulatedGlobe(seed=8)
    cal = sim.calibration()
    session = Session()
    for pkt in itertools.islice(sim.packets(sim.poses()), 20 + 25):  # 到达第一站并停稳
        session.on_notify(None, bytearray(pkt))
    _n, lat, lon = TOUR[0]
    assert angle_deg(latlon_to_vec(*cal.to_latlon(session.live)), latlon_to_vec(lat, lon)) < 0.5


def test_session_battery():
    import struct
    session = Session()
    assert session.battery is None
    pkt = b"\x55\x71" + struct.pack("<H", 0x64) + struct.pack("<h", 75) + b"\x00" * 14
    session.on_notify(None, bytearray(pkt))
    assert session.battery == 75

