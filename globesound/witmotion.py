"""维特智能（WitMotion）BLE 5.0 传感器的数据解析，适用于 BWT901BLECL。

协议（已在 BWT901BLECL / WT901BLECL 上核实）：
- 服务      0000ffe5-0000-1000-8000-00805f9a34fb
- 通知通道  0000ffe4-...：默认数据包 20 字节，以 0x55 0x61 开头，
            后面是 9 个小端 int16：加速度 xyz、角速度 xyz、角度 xyz
- 换算      原始值 / 32768 × 量程（加速度 16g，角速度 2000°/s，角度 180°）
- 写入通道  0000ffe9-...：配置指令以 FF AA 开头。本项目默认不发送任何配置指令。
默认输出频率 10Hz。
"""
from __future__ import annotations

import struct
from dataclasses import dataclass

import numpy as np

SERVICE_UUID = "0000ffe5-0000-1000-8000-00805f9a34fb"
NOTIFY_UUID = "0000ffe4-0000-1000-8000-00805f9a34fb"
WRITE_UUID = "0000ffe9-0000-1000-8000-00805f9a34fb"

HEADER = b"\x55\x61"
PACKET_LEN = 20

ACC_RANGE_G = 16.0
GYRO_RANGE_DPS = 2000.0
ANGLE_RANGE_DEG = 180.0


@dataclass(frozen=True)
class Packet:
    acc: np.ndarray    # 加速度，单位 g（静止时指向"正上方"，模长约 1）
    gyro: np.ndarray   # 角速度，单位 °/s
    angle: np.ndarray  # 模块自带的欧拉角 roll/pitch/yaw，单位 °（本项目不使用）


def parse_packet(pkt: bytes) -> Packet:
    """解析一个 20 字节的 0x55 0x61 数据包。"""
    if len(pkt) != PACKET_LEN or pkt[:2] != HEADER:
        raise ValueError("不是 0x55 0x61 数据包")
    raw = np.array(struct.unpack("<9h", pkt[2:PACKET_LEN]), dtype=float) / 32768.0
    return Packet(
        acc=raw[0:3] * ACC_RANGE_G,
        gyro=raw[3:6] * GYRO_RANGE_DPS,
        angle=raw[6:9] * ANGLE_RANGE_DEG,
    )


def build_packet(acc, gyro=(0.0, 0.0, 0.0), angle=(0.0, 0.0, 0.0)) -> bytes:
    """parse_packet 的逆操作，用于测试和模拟。"""
    vals = (
        [round(a / ACC_RANGE_G * 32768) for a in acc]
        + [round(w / GYRO_RANGE_DPS * 32768) for w in gyro]
        + [round(x / ANGLE_RANGE_DEG * 32768) for x in angle]
    )
    vals = [max(-32768, min(32767, v)) for v in vals]
    return HEADER + struct.pack("<9h", *vals)


class PacketParser:
    """把 BLE 通知里任意切分的字节流还原成完整数据包。"""

    def __init__(self) -> None:
        self._buf = bytearray()

    def feed(self, data: bytes) -> list[Packet]:
        self._buf += data
        packets: list[Packet] = []
        while True:
            i = self._buf.find(HEADER)
            if i < 0:
                del self._buf[:-1]  # 留最后一个字节，它可能是半个包头
                break
            del self._buf[:i]
            if len(self._buf) < PACKET_LEN:
                break
            packets.append(parse_packet(bytes(self._buf[:PACKET_LEN])))
            del self._buf[:PACKET_LEN]
        return packets


def looks_like_witmotion(name: str | None, service_uuids) -> bool:
    """按蓝牙名称或广播的服务 UUID 判断是不是维特的传感器。"""
    if (name or "").upper().startswith("WT"):
        return True
    return any("ffe5" in (s or "").lower() for s in (service_uuids or []))
