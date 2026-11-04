#!/usr/bin/env python3
"""build_kids_audio.py — 使用 edge-tts 为萌宝环球乐园生成高品质自然语音

生成 24 个生态大区的儿童绘本级自然普通话语音 (zh-CN-XiaoxiaoNeural)。
分别输出到：
1. miniprogram/audio/kids/{id}.mp3  (供小程序离线零延迟播放)
2. globesound/static/audio/kids/{id}.mp3 (供 Web 端播放)
"""

import asyncio
import json
import shutil
from pathlib import Path
import edge_tts

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "miniprogram" / "data" / "kids_zones.json"
MP_AUDIO_DIR = ROOT / "miniprogram" / "audio" / "kids"
WEB_AUDIO_DIR = ROOT / "globesound" / "static" / "audio" / "kids"

VOICE = "zh-CN-XiaoxiaoNeural"
RATE = "+0%"
PITCH = "+2Hz"


async def generate_zone_audio(zone: dict, semaphore: asyncio.Semaphore):
    zid = zone["id"]
    talk_text = zone.get("talk", "")
    if not talk_text:
        return

    mp_out = MP_AUDIO_DIR / f"{zid}.mp3"
    web_out = WEB_AUDIO_DIR / f"{zid}.mp3"

    async with semaphore:
        print(f"🎙️ 正在生成语音: [{zone.get('emoji', '')} {zone.get('name', '')}] -> {zid}.mp3")
        communicate = edge_tts.Communicate(talk_text, voice=VOICE, rate=RATE, pitch=PITCH)
        await communicate.save(str(mp_out))

        # 拷贝到 web static
        web_out.write_bytes(mp_out.read_bytes())

        # 小程序包体积优化：压缩为 24k mono 格式，保证绘本语音清脆的同时减少 65% 包体积
        ffmpeg_bin = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
        if Path(ffmpeg_bin).exists():
            tmp = mp_out.with_suffix(".tmp.mp3")
            proc = await asyncio.create_subprocess_exec(
                ffmpeg_bin, "-y", "-i", str(mp_out), "-b:a", "24k", "-ac", "1", "-ar", "16000", str(tmp),
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
            )
            await proc.wait()
            if tmp.exists() and tmp.stat().st_size > 0:
                tmp.replace(mp_out)

        print(f"  ✓ 完成: {mp_out.name} ({mp_out.stat().st_size // 1024} KB)")


async def main():
    MP_AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    WEB_AUDIO_DIR.mkdir(parents=True, exist_ok=True)

    with open(DATA_FILE, "r", encoding="utf-8") as f:
        zones = json.load(f)

    print(f"🚀 开始为 {len(zones)} 个萌宝生态区生成 edge-tts 语音...")
    sem = asyncio.Semaphore(4)
    tasks = [generate_zone_audio(z, sem) for z in zones]
    await asyncio.gather(*tasks)
    print("\n🎉 全部 24 个生态大区自然语音生成完毕！")


if __name__ == "__main__":
    asyncio.run(main())
