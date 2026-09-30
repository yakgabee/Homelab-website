#!/usr/bin/env python3
"""Tiny status dashboard for a Raspberry Pi homelab.

Serves a single web page plus a JSON endpoint (/api/status) reporting
storage, memory, CPU temperature, uptime and whether configured services
(e.g. Jellyfin) are running. Uses only the Python standard library.
"""

import argparse
import errno
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
CONFIG_PATH = Path(os.environ.get("DASHBOARD_CONFIG", BASE_DIR / "config.json"))

DEFAULT_CONFIG = {
    "host": "0.0.0.0",
    "port": 8080,
    # Empty list = auto-detect physical drives (SD card, USB, NVMe).
    "mounts": [],
    "services": [
        {
            "name": "Jellyfin",
            "systemd": "jellyfin",
            "url": "http://localhost:8096/health",
            "link": "http://{host}:8096",
        }
    ],
}

PHYSICAL_DEVICE_PREFIXES = ("/dev/sd", "/dev/mmcblk", "/dev/nvme", "/dev/root", "/dev/mapper/")


def load_config():
    config = dict(DEFAULT_CONFIG)
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH) as f:
            config.update(json.load(f))
    return config


# ---------------------------------------------------------------- metrics

def detect_mounts():
    """Return mount points backed by physical block devices, one per device."""
    seen_devices = set()
    mounts = []
    try:
        with open("/proc/mounts") as f:
            for line in f:
                device, mountpoint = line.split()[:2]
                if not device.startswith(PHYSICAL_DEVICE_PREFIXES):
                    continue
                if device in seen_devices or mountpoint.startswith("/boot"):
                    continue
                seen_devices.add(device)
                mounts.append(mountpoint.replace("\\040", " "))
    except OSError:
        pass
    return mounts or ["/"]


def get_storage(configured_mounts):
    disks = []
    for mount in configured_mounts or detect_mounts():
        try:
            usage = shutil.disk_usage(mount)
        except OSError as exc:
            disks.append({"mount": mount, "error": str(exc)})
            continue
        disks.append({
            "mount": mount,
            "total": usage.total,
            "used": usage.used,
            "free": usage.free,
            # Same formula as `df`: blocks reserved for root don't count as free.
            "percent": round(usage.used / (usage.used + usage.free) * 100, 1)
            if usage.used + usage.free else 0,
        })
    return disks


def get_memory():
    info = {}
    with open("/proc/meminfo") as f:
        for line in f:
            key, value = line.split(":", 1)
            info[key] = int(value.split()[0]) * 1024  # kB -> bytes

    total = info.get("MemTotal", 0)
    available = info.get("MemAvailable", info.get("MemFree", 0))
    used = total - available
    swap_total = info.get("SwapTotal", 0)
    swap_used = swap_total - info.get("SwapFree", 0)
    return {
        "total": total,
        "used": used,
        "available": available,
        "percent": round(used / total * 100, 1) if total else 0,
        "swap_total": swap_total,
        "swap_used": swap_used,
        "swap_percent": round(swap_used / swap_total * 100, 1) if swap_total else 0,
    }


def get_cpu_temp():
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as f:
            return round(int(f.read().strip()) / 1000, 1)
    except (OSError, ValueError):
        return None


def get_uptime():
    try:
        with open("/proc/uptime") as f:
            return int(float(f.read().split()[0]))
    except (OSError, ValueError):
        return None


def get_load():
    try:
        return [round(x, 2) for x in os.getloadavg()]
    except OSError:
        return None


# --------------------------------------------------------------- services

def run(cmd):
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        return result.returncode, result.stdout.strip()
    except (OSError, subprocess.TimeoutExpired) as exc:
        return None, str(exc)


def check_systemd(unit):
    code, out = run(["systemctl", "is-active", unit])
    if code is None:
        return {"type": "systemd", "ok": None, "detail": "systemctl unavailable"}
    return {"type": "systemd", "ok": out == "active", "detail": out or "unknown"}


def check_docker(container):
    code, out = run(["docker", "inspect", "-f", "{{.State.Status}}", container])
    if code is None:
        return {"type": "docker", "ok": None, "detail": "docker unavailable"}
    if code != 0:
        return {"type": "docker", "ok": False, "detail": "container not found"}
    return {"type": "docker", "ok": out == "running", "detail": out}


def check_http(url):
    start = time.monotonic()
    try:
        with urllib.request.urlopen(url, timeout=4) as resp:
            ms = round((time.monotonic() - start) * 1000)
            return {"type": "http", "ok": 200 <= resp.status < 400,
                    "detail": f"HTTP {resp.status} in {ms} ms"}
    except urllib.error.HTTPError as exc:
        return {"type": "http", "ok": False, "detail": f"HTTP {exc.code}"}
    except (urllib.error.URLError, OSError) as exc:
        reason = getattr(exc, "reason", exc)
        return {"type": "http", "ok": False, "detail": f"unreachable ({reason})"}


def check_netbird():
    """Ask the local NetBird client which peers are connected to this Pi."""
    code, out = run(["netbird", "status", "--json"])
    if code is None:
        return {"type": "netbird", "ok": None, "detail": "netbird CLI not found"}, None
    try:
        status = json.loads(out)
    except ValueError:
        # Not JSON: usually "daemon not running" or a permissions error.
        detail = out.splitlines()[0] if out else f"netbird status exited with {code}"
        return {"type": "netbird", "ok": False, "detail": detail}, None

    connected = bool(status.get("management", {}).get("connected"))
    peers = status.get("peers") or {}
    online = [
        {
            "name": (p.get("fqdn") or "").split(".")[0] or p.get("netbirdIp", "?"),
            "ip": p.get("netbirdIp", ""),
            "type": p.get("connectionType", ""),
        }
        for p in peers.get("details") or []
        if str(p.get("status", "")).lower() == "connected"
    ]
    online.sort(key=lambda p: p["name"].lower())
    ip = (status.get("netbirdIp") or "").split("/")[0]
    detail = ("connected" if connected else "not connected to management") + (f" · {ip}" if ip else "")
    peer_info = {
        "connected": peers.get("connected", len(online)),
        "total": peers.get("total", len(peers.get("details") or [])),
        "online": online,
    }
    return {"type": "netbird", "ok": connected, "detail": detail}, peer_info


def check_service(service, request_host):
    checks = []
    peers = None
    if service.get("systemd"):
        checks.append(check_systemd(service["systemd"]))
    if service.get("docker"):
        checks.append(check_docker(service["docker"]))
    if service.get("url"):
        checks.append(check_http(service["url"]))
    if service.get("netbird"):
        check, peers = check_netbird()
        checks.append(check)

    known = [c["ok"] for c in checks if c["ok"] is not None]
    if not known:
        state = "unknown"
    elif all(known):
        state = "running"
    elif any(known):
        state = "degraded"
    else:
        state = "down"

    link = service.get("link")
    if link:
        link = link.replace("{host}", request_host)
    result = {"name": service["name"], "state": state, "checks": checks, "link": link}
    if peers is not None:
        result["peers"] = peers
    return result


# ------------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    config = None

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/status":
            self.send_status()
        elif path in ("/", "/index.html"):
            self.send_file(STATIC_DIR / "index.html", "text/html; charset=utf-8")
        else:
            self.send_error(404)

    def send_status(self):
        host = (self.headers.get("Host") or "localhost").rsplit(":", 1)[0]
        payload = {
            "hostname": os.uname().nodename,
            "timestamp": int(time.time()),
            "uptime": get_uptime(),
            "load": get_load(),
            "cpu_temp": get_cpu_temp(),
            "memory": get_memory(),
            "storage": get_storage(self.config["mounts"]),
            "services": [check_service(s, host) for s in self.config["services"]],
        }
        self.send_bytes(json.dumps(payload).encode(), "application/json")

    def send_file(self, path, content_type):
        try:
            self.send_bytes(path.read_bytes(), content_type)
        except OSError:
            self.send_error(404)

    def send_bytes(self, body, content_type):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass  # keep the journal quiet; the page polls every few seconds


def main():
    parser = argparse.ArgumentParser(description="Raspberry Pi status dashboard")
    parser.add_argument("--port", type=int, help="port to listen on (overrides config.json)")
    args = parser.parse_args()

    config = load_config()
    port = args.port or int(os.environ.get("DASHBOARD_PORT", config["port"]))
    Handler.config = config
    try:
        server = ThreadingHTTPServer((config["host"], port), Handler)
    except OSError as exc:
        if exc.errno != errno.EADDRINUSE:
            raise
        sys.exit(
            f"Port {port} is already in use.\n"
            f"  See what is using it:   sudo ss -ltnp 'sport = :{port}'\n"
            f"  If it's this dashboard: sudo systemctl stop pi-dashboard\n"
            f"  Or pick another port:   python3 server.py --port 8090"
        )
    print(f"Pi dashboard running on http://{config['host']}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
