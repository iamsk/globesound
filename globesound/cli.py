"""命令行入口：python -m globesound

把地球仪上任意地点转到"子午圈最高点"正下方，松手约 1 秒后，
标准输出打印一行 JSON：{"lat": 22.5, "lon": 114.1}。提示信息都打到标准错误，
所以可以直接用管道把坐标交给别的程序：python -m globesound | your_app
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

import numpy as np
from bleak import BleakClient, BleakScanner

from . import witmotion
from .geo import CALIBRATION_POINTS, RMS_WARN_DEG, Calibration, StillDetector, calibrate
from .sim import TOUR, SimulatedGlobe
from .web import WebServer


def log(*args) -> None:
    print(*args, file=sys.stderr, flush=True)


def emit(lat: float, lon: float) -> None:
    """扩展点：拿到新坐标后做什么。默认打印一行 JSON。"""
    print(json.dumps({"lat": lat, "lon": lon}), flush=True)


class Session:
    LIVE_SMOOTH = 0.3  # 转动中给网页看的方向做一阶低通，滤掉手抖

    def __init__(self) -> None:
        self.parser = witmotion.PacketParser()
        self.detector = StillDetector()
        self.up = None    # 最近一次静止时的"上"向量；转动中为 None
        self.live = None  # 低通后的加速度方向，转动中也有，只给网页做跟随用，精度不如 up

    def on_notify(self, _sender, data: bytearray) -> None:
        for pkt in self.parser.feed(bytes(data)):
            self.up = self.detector.update(pkt.acc, pkt.gyro)
            n = float(np.linalg.norm(pkt.acc))
            if 0.7 < n < 1.3:  # 甩得太猛时加速度不代表重力，这一帧不要
                v = pkt.acc / n
                self.live = v if self.live is None else self.live + self.LIVE_SMOOTH * (v - self.live)

    def reset(self) -> None:
        self.detector.reset()
        self.up = None

    async def wait_still(self):
        while self.up is None:
            await asyncio.sleep(0.05)
        return self.up.copy()


async def find_sensor(timeout: float = 8.0):
    log("扫描蓝牙设备……")
    found = await BleakScanner.discover(timeout=timeout, return_adv=True)
    cands = [d for d, ad in found.values() if witmotion.looks_like_witmotion(d.name, ad.service_uuids)]
    if len(cands) == 1:
        log(f"找到传感器：{cands[0].name}  {cands[0].address}")
        return cands[0]
    log("没能自动认出传感器。附近的蓝牙设备：")
    for d, ad in sorted(found.values(), key=lambda x: -x[1].rssi):
        log(f"  {d.address}  {d.name or '(无名称)'}  信号 {ad.rssi}")
    log("找到传感器那一行，用 --address <地址> 重新运行")
    return None


async def run_calibration(session: Session) -> Calibration:
    log("开始标定：每一步把指定地点转到子午圈最高点的正下方，松手静止后按回车。")
    ups = []
    for i, (name, _lat, _lon) in enumerate(CALIBRATION_POINTS, 1):
        log(f"[{i}/{len(CALIBRATION_POINTS)}] {name}")
        await asyncio.to_thread(sys.stdin.readline)
        session.reset()
        log("  等待静止……")
        ups.append(await session.wait_still())
    cal = calibrate(ups, [(lat, lon) for _n, lat, lon in CALIBRATION_POINTS])
    log(f"标定完成，残差 {cal.rms_deg:.2f}°")
    if cal.rms_deg > RMS_WARN_DEG:
        log(f"  残差超过 {RMS_WARN_DEG}°，可能有标定点没放准，建议加 --recalibrate 重来")
    return cal


async def readout(session: Session, cal: Calibration, args, alive, source: str) -> None:
    web = None
    if args.web:
        web = WebServer(args.web_host, args.web)
        await web.start()
        log(f"网页地球仪：{web.url}")
    log("开始读数：把地点转到子午圈最高点正下方，松手约 1 秒后输出坐标。Ctrl+C 退出。")
    last = None
    while alive():
        if session.up is not None:
            lat, lon = cal.to_latlon(session.up)
            cur = (round(lat, args.decimals), round(lon, args.decimals))
            if cur != last:
                emit(*cur)
                last = cur
        if web is not None:
            v = session.up if session.up is not None else session.live
            if v is not None:
                lat, lon = cal.to_latlon(v)
                web.publish({"lat": round(lat, 3), "lon": round(lon, 3),
                             "still": session.up is not None, "source": source})
        await asyncio.sleep(0.1)


async def main_async(args) -> int:
    if args.simulate:
        sim = SimulatedGlobe(seed=args.seed)
        session = Session()
        log(f"模拟模式：虚拟地球仪按固定路线巡游（{'、'.join(n for n, _a, _b in TOUR)}），不读写标定文件")
        task = asyncio.create_task(sim.run(session.on_notify))
        await readout(session, sim.calibration(), args, lambda: not task.done(), "sim")
        return 0
    target = args.address or await find_sensor()
    if target is None:
        return 1
    session = Session()
    async with BleakClient(target) as client:
        await client.start_notify(witmotion.NOTIFY_UUID, session.on_notify)
        calib_path = Path(args.calib_file)
        if calib_path.exists() and not args.recalibrate:
            cal = Calibration.load(calib_path)
            log(f"已加载标定 {calib_path}（残差 {cal.rms_deg:.2f}°）；传感器动过就加 --recalibrate")
        else:
            cal = await run_calibration(session)
            cal.save(calib_path)
        await readout(session, cal, args, lambda: client.is_connected, "ble")
        log("蓝牙已断开（检查电量和距离）")
    return 0


def main() -> None:
    p = argparse.ArgumentParser(prog="globesound", description="地球仪坐标读取（BWT901BLECL）")
    p.add_argument("--address", help="传感器蓝牙地址；不填就自动扫描")
    p.add_argument("--calib-file", default="globe_calib.json", help="标定文件路径")
    p.add_argument("--recalibrate", action="store_true", help="忽略已有标定，重新标定")
    p.add_argument("--decimals", type=int, default=1, help="经纬度保留几位小数")
    p.add_argument("--web", type=int, nargs="?", const=8765, metavar="PORT",
                   help="同时开网页地球仪（默认端口 8765），浏览器打开提示的地址")
    p.add_argument("--web-host", default="127.0.0.1", help="网页服务监听地址；手机要访问就用 0.0.0.0")
    p.add_argument("--simulate", action="store_true", help="不连传感器，用虚拟地球仪产生数据")
    p.add_argument("--seed", type=int, help="模拟模式的随机种子（决定虚拟传感器的安装姿态）")
    args = p.parse_args()
    try:
        sys.exit(asyncio.run(main_async(args)))
    except KeyboardInterrupt:
        pass
