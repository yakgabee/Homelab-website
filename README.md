# Homelab Pi Dashboard

A lightweight status page for a Raspberry Pi 4 that shows:

- **Services**: whether Jellyfin (or anything else you add) is running
- **Memory**: RAM and swap in use
- **Storage**: used and free space on the SD card and any attached USB or NVMe drives
- **System**: CPU temperature, load average and uptime

The page refreshes every 5 seconds. It only needs Python 3, which ships with Raspberry Pi OS, so there's nothing to `pip install`.

## Quick start

On the Pi:

```bash
git clone https://github.com/yakgabee/Homelab-website.git ~/Homelab-website
cd ~/Homelab-website
python3 server.py
```

Then open `http://<pi-ip-address>:8080` from any device on your network (for example `http://raspberrypi.local:8080`).

If port 8080 is already taken, run `python3 server.py --port 8090` instead, or set `"port"` in `config.json`. To see what is using a port, run `sudo ss -ltnp 'sport = :8080'`.

## Run it on boot

```bash
# Edit User= and the paths if your username isn't "pi"
sudo cp pi-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now pi-dashboard
```

Check it with `systemctl status pi-dashboard`.

## Configuration

The defaults work for a standard Jellyfin install (the `jellyfin` systemd service on port 8096). To change them:

```bash
cp config.example.json config.json
nano config.json
```

| Key | Meaning |
| --- | --- |
| `port` | Port the dashboard listens on (default `8080`) |
| `mounts` | Mount points to show, e.g. `["/", "/mnt/media"]`. Leave empty to auto-detect every physical drive. |
| `services` | List of services to check (see below) |

Each service can use any combination of checks. It shows **running** when every check passes, **degraded** when only some pass, and **down** when none pass.

| Field | Check |
| --- | --- |
| `systemd` | Unit name; passes when `systemctl is-active` reports `active` |
| `docker` | Container name; passes when the container state is `running` |
| `url` | HTTP URL; passes on a 2xx or 3xx response |
| `tailscale` | `true` to read `tailscale status --json`; passes when Tailscale is connected and shows how many devices on your tailnet are online |
| `link` | Optional link on the card. `{host}` becomes whatever hostname you used to open the dashboard. |

### Jellyfin in Docker

If Jellyfin runs in a container instead of as a system service:

```json
{
  "name": "Jellyfin",
  "docker": "jellyfin",
  "url": "http://localhost:8096/health",
  "link": "http://{host}:8096"
}
```

The user running the dashboard must be in the `docker` group (`sudo usermod -aG docker pi`). Otherwise drop the `docker` field and rely on the `url` check.

### Tailscale

```json
{ "name": "Tailscale", "tailscale": true, "systemd": "tailscaled", "link": "https://login.tailscale.com/admin/machines" }
```

The card shows the Pi's Tailscale IP, how many devices on your tailnet are online, and each online device's name, IP, OS and how it's reaching the Pi: `direct` (peer-to-peer), `relay (…)` (through a Tailscale DERP relay) or `idle` (online, but no recent traffic with the Pi). Devices your ACLs hide from the Pi aren't counted.

If the card says `permission denied` or `stopped`, check that `tailscale status` works as the user running the dashboard.

### Adding more services

Add entries to `services`, for example:

```json
{ "name": "Pi-hole", "systemd": "pihole-FTL", "url": "http://localhost/admin/" }
```

## API

`GET /api/status` returns everything on the page as JSON, which is handy for scripts or Home Assistant.

## Security

The dashboard has no login. Keep it on your home network, and don't port-forward it to the internet. If you need remote access, use a VPN such as Tailscale: open `http://<pi-tailscale-ip>:8080` from any device signed in to your tailnet.
