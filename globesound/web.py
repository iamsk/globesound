"""把坐标推给浏览器：一个只用标准库的小 HTTP 服务。

GET /         网页地球仪（globesound/static/index.html）
GET /events   Server-Sent Events，每 0.1 秒推一条 JSON：{"lat", "lon", "still", "source"}
GET /stations.json  电台目录缓存（见 stations.py）；还没拉取完时返回 503，网页会重试
只需要单向推送，所以用 SSE 而不是 WebSocket，浏览器断线会自己重连。
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

STATIC = Path(__file__).parent / "static"


class WebServer:
    def __init__(self, host: str = "127.0.0.1", port: int = 8765) -> None:
        self.host, self.port = host, port
        self._queues: set[asyncio.Queue] = set()
        self._last: str | None = None
        self.stations_path: Path | None = None  # 电台目录拉取完成后由调用方填上

    @property
    def url(self) -> str:
        return f"http://{'localhost' if self.host in ('127.0.0.1', '0.0.0.0') else self.host}:{self.port}/"

    async def start(self) -> None:
        await asyncio.start_server(self._handle, self.host, self.port)

    def publish(self, state: dict) -> None:
        self._last = json.dumps(state, ensure_ascii=False)
        for q in self._queues:
            if q.full():  # 浏览器跟不上就只保留最新的一条
                q.get_nowait()
            q.put_nowait(self._last)

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            parts = (await reader.readline()).decode("latin-1").split()
            while (await reader.readline()) not in (b"\r\n", b"\n", b""):
                pass  # 请求头用不上
            path = parts[1].split("?")[0] if len(parts) > 1 else "/"
            if path == "/events":
                await self._stream(writer)
            elif path == "/stations.json":
                if self.stations_path is None or not self.stations_path.exists():
                    writer.write(b"HTTP/1.1 503 Service Unavailable\r\nRetry-After: 3\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                else:
                    body = self.stations_path.read_bytes()
                    writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\n"
                                 b"Cache-Control: no-store\r\nContent-Length: %d\r\nConnection: close\r\n\r\n" % len(body) + body)
            elif path in ("/", "/index.html"):
                body = (STATIC / "index.html").read_bytes()
                writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n"
                             b"Cache-Control: no-store\r\nContent-Length: %d\r\nConnection: close\r\n\r\n" % len(body) + body)
            else:
                writer.write(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            await writer.drain()
        except (ConnectionError, asyncio.IncompleteReadError):
            pass
        finally:
            writer.close()

    async def _stream(self, writer: asyncio.StreamWriter) -> None:
        writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n"
                     b"Cache-Control: no-store\r\nConnection: keep-alive\r\n\r\nretry: 1000\n\n")
        q: asyncio.Queue = asyncio.Queue(maxsize=1)
        if self._last is not None:
            q.put_nowait(self._last)
        self._queues.add(q)
        try:
            while True:
                writer.write(f"data: {await q.get()}\n\n".encode())
                await writer.drain()
        finally:
            self._queues.discard(q)
