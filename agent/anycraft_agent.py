"""
AnyCraft Local OS Control Agent (Zero External Dependencies)
Listens on ws://127.0.0.1:8765 and translates normalized WebRTC DataChannel
mouse & keyboard events into real OS input on Windows (user32.dll) and
macOS (CoreGraphics / ApplicationServices).
"""

import asyncio
import base64
import ctypes
import hashlib
import json
import platform
import struct
import sys

OS_NAME = platform.system()
IS_WINDOWS = OS_NAME == "Windows"
IS_MAC = OS_NAME == "Darwin"

if IS_WINDOWS:
    user32 = ctypes.windll.user32
    # Make process DPI-aware so normalized coordinates match physical pixels
    try:
        user32.SetProcessDPIAware()
    except Exception:
        pass

    MOUSEEVENTF_MOVE = 0x0001
    MOUSEEVENTF_LEFTDOWN = 0x0002
    MOUSEEVENTF_LEFTUP = 0x0004
    MOUSEEVENTF_RIGHTDOWN = 0x0008
    MOUSEEVENTF_RIGHTUP = 0x0010
    MOUSEEVENTF_MIDDLEDOWN = 0x0020
    MOUSEEVENTF_MIDDLEUP = 0x0040
    MOUSEEVENTF_WHEEL = 0x0800
    MOUSEEVENTF_ABSOLUTE = 0x8000
    KEYEVENTF_KEYUP = 0x0002

    VK_MAP = {
        "Backspace": 0x08,
        "Tab": 0x09,
        "Enter": 0x0D,
        "Shift": 0x10,
        "Control": 0x11,
        "Alt": 0x12,
        "Escape": 0x1B,
        " ": 0x20,
        "PageUp": 0x21,
        "PageDown": 0x22,
        "End": 0x23,
        "Home": 0x24,
        "ArrowLeft": 0x25,
        "ArrowUp": 0x26,
        "ArrowRight": 0x27,
        "ArrowDown": 0x28,
        "Delete": 0x2E,
        "Meta": 0x5B,
    }

elif IS_MAC:
    cg = ctypes.CDLL(
        "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices"
    )
    cf = ctypes.CDLL(
        "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"
    )

    class CGPoint(ctypes.Structure):
        _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]

    cg.CGMainDisplayID.restype = ctypes.c_uint32
    cg.CGDisplayPixelsWide.argtypes = [ctypes.c_uint32]
    cg.CGDisplayPixelsWide.restype = ctypes.c_size_t
    cg.CGDisplayPixelsHigh.argtypes = [ctypes.c_uint32]
    cg.CGDisplayPixelsHigh.restype = ctypes.c_size_t

    cg.CGEventCreateMouseEvent.argtypes = [
        ctypes.c_void_p,
        ctypes.c_uint32,
        CGPoint,
        ctypes.c_uint32,
    ]
    cg.CGEventCreateMouseEvent.restype = ctypes.c_void_p

    cg.CGEventCreateScrollWheelEvent.argtypes = [
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.c_uint32,
        ctypes.c_int32,
    ]
    cg.CGEventCreateScrollWheelEvent.restype = ctypes.c_void_p

    cg.CGEventCreateKeyboardEvent.argtypes = [
        ctypes.c_void_p,
        ctypes.c_uint16,
        ctypes.c_bool,
    ]
    cg.CGEventCreateKeyboardEvent.restype = ctypes.c_void_p

    cg.CGEventKeyboardSetUnicodeString.argtypes = [
        ctypes.c_void_p,
        ctypes.c_ulong,
        ctypes.POINTER(ctypes.c_uint16),
    ]
    cg.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
    cf.CFRelease.argtypes = [ctypes.c_void_p]

    MAC_VK_MAP = {
        "Enter": 36,
        "Tab": 48,
        " ": 49,
        "Backspace": 51,
        "Escape": 53,
        "Meta": 55,
        "Shift": 56,
        "Alt": 58,
        "Control": 59,
        "Home": 115,
        "PageUp": 116,
        "Delete": 117,
        "End": 119,
        "PageDown": 121,
        "ArrowLeft": 123,
        "ArrowRight": 124,
        "ArrowDown": 125,
        "ArrowUp": 126,
    }
    _mac_left_down = False


def _to_abs_win(nx: float, ny: float) -> tuple[int, int]:
    ax = max(0, min(65535, int(nx * 65535)))
    ay = max(0, min(65535, int(ny * 65535)))
    return ax, ay


def _to_mac_point(nx: float, ny: float) -> "CGPoint":
    did = cg.CGMainDisplayID()
    w = cg.CGDisplayPixelsWide(did)
    h = cg.CGDisplayPixelsHigh(did)
    x = max(0.0, min(float(w - 1), nx * w))
    y = max(0.0, min(float(h - 1), ny * h))
    return CGPoint(x, y)


def _post_mac_mouse(ev_type: int, pt: "CGPoint", btn: int) -> None:
    ev = cg.CGEventCreateMouseEvent(None, ev_type, pt, btn)
    if ev:
        cg.CGEventPost(0, ev)
        cf.CFRelease(ev)


def handle_control_event_win(ev: dict) -> None:
    t = ev.get("t")
    if t == "m":
        ax, ay = _to_abs_win(ev["x"], ev["y"])
        user32.mouse_event(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, ax, ay, 0, 0)
    elif t == "d":
        ax, ay = _to_abs_win(ev["x"], ev["y"])
        b = ev.get("b", 0)
        flag = (
            MOUSEEVENTF_RIGHTDOWN
            if b == 2
            else MOUSEEVENTF_MIDDLEDOWN
            if b == 1
            else MOUSEEVENTF_LEFTDOWN
        )
        user32.mouse_event(
            MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | flag, ax, ay, 0, 0
        )
    elif t == "u":
        ax, ay = _to_abs_win(ev["x"], ev["y"])
        b = ev.get("b", 0)
        flag = (
            MOUSEEVENTF_RIGHTUP
            if b == 2
            else MOUSEEVENTF_MIDDLEUP
            if b == 1
            else MOUSEEVENTF_LEFTUP
        )
        user32.mouse_event(
            MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | flag, ax, ay, 0, 0
        )
    elif t == "c":
        ax, ay = _to_abs_win(ev["x"], ev["y"])
        b = ev.get("b", 0)
        down_f = MOUSEEVENTF_RIGHTDOWN if b == 2 else MOUSEEVENTF_LEFTDOWN
        up_f = MOUSEEVENTF_RIGHTUP if b == 2 else MOUSEEVENTF_LEFTUP
        user32.mouse_event(
            MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | down_f, ax, ay, 0, 0
        )
        user32.mouse_event(
            MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | up_f, ax, ay, 0, 0
        )
    elif t == "w":
        dy = int(-ev.get("dy", 0))
        if dy != 0:
            user32.mouse_event(MOUSEEVENTF_WHEEL, 0, 0, dy, 0)
    elif t in ("kd", "ku"):
        k = ev.get("k", "")
        vk = VK_MAP.get(k)
        if vk is None and len(k) == 1:
            res = user32.VkKeyScanW(ord(k))
            if res != -1:
                vk = res & 0xFF
        if vk:
            flags = KEYEVENTF_KEYUP if t == "ku" else 0
            user32.keybd_event(vk, 0, flags, 0)


def handle_control_event_mac(ev: dict) -> None:
    global _mac_left_down
    t = ev.get("t")
    if t == "m":
        pt = _to_mac_point(ev["x"], ev["y"])
        _post_mac_mouse(6 if _mac_left_down else 5, pt, 0)
    elif t == "d":
        pt = _to_mac_point(ev["x"], ev["y"])
        b = ev.get("b", 0)
        if b == 0:
            _mac_left_down = True
            _post_mac_mouse(1, pt, 0)
        elif b == 2:
            _post_mac_mouse(3, pt, 1)
        else:
            _post_mac_mouse(25, pt, 2)
    elif t == "u":
        pt = _to_mac_point(ev["x"], ev["y"])
        b = ev.get("b", 0)
        if b == 0:
            _mac_left_down = False
            _post_mac_mouse(2, pt, 0)
        elif b == 2:
            _post_mac_mouse(4, pt, 1)
        else:
            _post_mac_mouse(26, pt, 2)
    elif t == "c":
        pt = _to_mac_point(ev["x"], ev["y"])
        b = ev.get("b", 0)
        if b == 2:
            _post_mac_mouse(3, pt, 1)
            _post_mac_mouse(4, pt, 1)
        else:
            _post_mac_mouse(1, pt, 0)
            _post_mac_mouse(2, pt, 0)
    elif t == "w":
        dy = int(-ev.get("dy", 0) / 10)
        if dy != 0:
            sev = cg.CGEventCreateScrollWheelEvent(None, 1, 1, dy)
            if sev:
                cg.CGEventPost(0, sev)
                cf.CFRelease(sev)
    elif t in ("kd", "ku"):
        k = ev.get("k", "")
        is_down = t == "kd"
        vk = MAC_VK_MAP.get(k)
        if vk is not None:
            kev = cg.CGEventCreateKeyboardEvent(None, vk, is_down)
            if kev:
                cg.CGEventPost(0, kev)
                cf.CFRelease(kev)
        elif len(k) == 1:
            kev = cg.CGEventCreateKeyboardEvent(None, 0, is_down)
            if kev:
                ch = (ctypes.c_uint16 * 1)(ord(k))
                cg.CGEventKeyboardSetUnicodeString(kev, 1, ch)
                cg.CGEventPost(0, kev)
                cf.CFRelease(kev)


def handle_control_event(ev: dict) -> None:
    if IS_WINDOWS:
        handle_control_event_win(ev)
    elif IS_MAC:
        handle_control_event_mac(ev)


async def read_ws_frame(reader: asyncio.StreamReader) -> str | None:
    try:
        header = await reader.readexactly(2)
    except asyncio.IncompleteReadError:
        return None
    b1, b2 = header[0], header[1]
    opcode = b1 & 0x0F
    if opcode == 0x8:  # Close frame
        return None
    masked = bool(b2 & 0x80)
    length = b2 & 0x7F
    if length == 126:
        length = struct.unpack("!H", await reader.readexactly(2))[0]
    elif length == 127:
        length = struct.unpack("!Q", await reader.readexactly(8))[0]
    mask = await reader.readexactly(4) if masked else b"\x00\x00\x00\x00"
    payload = bytearray(await reader.readexactly(length))
    if masked:
        for i in range(length):
            payload[i] ^= mask[i % 4]
    if opcode == 0x1:
        return payload.decode("utf-8", errors="ignore")
    return ""


async def handle_client(
    reader: asyncio.StreamReader, writer: asyncio.StreamWriter
):
    try:
        req = await reader.readuntil(b"\r\n\r\n")
        headers = req.decode("utf-8", errors="ignore").split("\r\n")
        ws_key = None
        for line in headers:
            if line.lower().startswith("sec-websocket-key:"):
                ws_key = line.split(":", 1)[1].strip()
                break
        if not ws_key:
            writer.close()
            return

        accept = base64.b64encode(
            hashlib.sha1(
                (ws_key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()
            ).digest()
        ).decode()
        resp = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
        )
        writer.write(resp.encode())
        await writer.drain()
        print(f"[AnyCraft Agent] Browser connected ({OS_NAME}) — OS control active.")

        while True:
            msg = await read_ws_frame(reader)
            if msg is None:
                break
            if not msg:
                continue
            try:
                ev = json.loads(msg)
                handle_control_event(ev)
            except Exception:
                pass
    except Exception:
        pass
    finally:
        writer.close()


async def main():
    if not (IS_WINDOWS or IS_MAC):
        print(
            f"[AnyCraft Agent] Note: Native OS input injection targets Windows & macOS (detected {OS_NAME}).",
            file=sys.stderr,
        )
    server = await asyncio.start_server(handle_client, "127.0.0.1", 8765)
    print(f"AnyCraft OS Control Agent ({OS_NAME}) listening on ws://127.0.0.1:8765")
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nAgent stopped.")
