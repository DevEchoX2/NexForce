# Low-Budget Game Streaming Host Guide

Use this setup to run Roblox, Fall Guys, Fortnite, and Rocket League from your own gaming PC with low latency.

## Best low-budget stack

- Host: **Windows gaming PC**
- Streaming host software: **Sunshine**
- Streaming client: **Moonlight**
- Remote networking: **Tailscale**
- Backup remote desktop/control: **Parsec**

## 1) Host PC setup (Sunshine)

- Install latest GPU drivers.
- Install and sign in to:
  - Epic Games Launcher (Fortnite, Fall Guys, Rocket League)
  - Roblox
- Install Sunshine.
- In Sunshine, set:
  - Hardware encoder (`NVENC`/`AMF`/`QuickSync`)
  - Start with `1080p 60fps`
- Add launch targets in Sunshine:
  - Desktop
  - Epic Games Launcher
  - Roblox Player (or browser shortcut)
- Host PC recommendations:
  - Wired Ethernet
  - High-performance power mode
  - Disable sleep while hosting

## 2) Client setup (Moonlight)

- Install Moonlight on your client device (phone/laptop/TV).
- Pair with Sunshine (PIN pairing).
- Start with these settings:
  - Resolution: `1080p`
  - FPS: `60`
  - Bitrate: `15–25 Mbps`
  - HEVC: enabled (if supported)

## 3) Make it work remotely (no port-forward pain)

- Install Tailscale on host and client.
- Log into the same tailnet account.
- In Moonlight, connect to the host using its Tailscale IP.

This avoids most NAT/port-forwarding issues and stays low-cost/free for personal use.

## 4) Where Parsec fits

- Use Parsec for desktop/admin tasks and troubleshooting.
- Use Moonlight for actual low-latency controller gameplay.

## Game-specific notes

- **Fortnite / Fall Guys / Rocket League**:
  - Launch from Epic on host, then stream via Moonlight.
- **Roblox**:
  - Launch on host desktop and stream it.
  - Some Roblox experiences may need mouse-lock/fullscreen tweaking.
- Anti-cheat titles generally work better on your **own physical PC** than low-end cloud VMs.

## Free / low-cost tools

- Sunshine + Moonlight: free
- Tailscale: free tier
- Parsec: free personal tier
- Optional launcher UI: Playnite (free)

## Quick presets

### Stable 1080p60 preset

- FPS: `60`
- Bitrate: `20 Mbps`
- Codec: `HEVC` (or `H.264` if compatibility issues)
- V-Sync: Off on host game if latency is priority

### Better quality 1440p60 preset

- FPS: `60`
- Bitrate: `30–45 Mbps`
- Codec: `HEVC`
- Requires stronger upload and stable Wi-Fi 6 or Ethernet
