import numpy as np

from globesound.witmotion import PacketParser, build_packet, looks_like_witmotion, parse_packet


def test_roundtrip():
    p = parse_packet(build_packet((0.0, 0.6, 0.8), (1.0, -2.0, 3.0), (10.0, -20.0, 30.0)))
    assert np.allclose(p.acc, [0, 0.6, 0.8], atol=1e-3)
    assert np.allclose(p.gyro, [1, -2, 3], atol=0.1)
    assert np.allclose(p.angle, [10, -20, 30], atol=0.01)


def test_parser_handles_garbage_and_split_chunks():
    stream = b"\x01\x55\x02" + b"".join(build_packet((0.0, 0.0, 1.0)) for _ in range(5))
    parser = PacketParser()
    got = []
    for i in range(0, len(stream), 7):  # 故意按 7 字节切开，包头也会被切断
        got += parser.feed(stream[i:i + 7])
    assert len(got) == 5
    assert all(np.allclose(p.acc, [0, 0, 1], atol=1e-3) for p in got)


def test_device_detection():
    assert looks_like_witmotion("WT901BLE68", [])
    assert looks_like_witmotion(None, ["0000ffe5-0000-1000-8000-00805f9a34fb"])
    assert not looks_like_witmotion("AirPods", [])


def test_battery_packet_parsing():
    import struct
    from globesound.witmotion import parse_battery_packet, PacketParser

    # 构造 0x55 0x71 包，寄存器 0x64，电量 88%
    pkt = b"\x55\x71" + struct.pack("<H", 0x64) + struct.pack("<h", 88) + b"\x00" * 14
    assert parse_battery_packet(pkt) == 88

    parser = PacketParser()
    parser.feed(pkt)
    assert parser.battery == 88
