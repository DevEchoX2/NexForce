# NexForce Host Guide (Single Host PC + Mobile Clients)

This project uses **one host machine only**: your colleague’s gaming PC. Everyone else just uses the site and plays from mobile clients.

## Hosting model

- Host machine: **1 Windows gaming PC** (colleague PC)
- Stream host software: **Sunshine**
- Player clients: **Moonlight on phones**
- Network layer: **Tailscale**
- Backup remote admin: **Parsec**

No distributed self-hosting for users. End users do not run host infrastructure.

## 1) Single host PC setup (colleague PC)

- Update GPU drivers.
- Install/sign in to game launchers:
  - Epic Games Launcher (Fortnite, Fall Guys, Rocket League)
  - Roblox
- Install Sunshine.
- Sunshine baseline settings:
  - Encoder: `NVENC` / `AMF` / `QuickSync`
  - Resolution: `1080p`
  - FPS: `60`
  - Bitrate: `12–20 Mbps`
- Add Sunshine apps:
  - Desktop
  - Epic Games Launcher
  - Roblox Player
- Host reliability:
  - Wired Ethernet
  - High-performance power mode
  - Disable sleep/hibernation while hosting

## 2) Mobile-first client setup (potato phones supported)

- Install Moonlight on Android/iOS.
- Pair with Sunshine once using PIN.
- Use this default for low-end phones:
  - Resolution: `720p`
  - FPS: `30`
  - Bitrate: `4–8 Mbps`
  - Codec: `H.264` (better compatibility on older devices)

If phone/network is stronger, increase gradually to `1080p60`.

## 3) PC controls on mobile clients

Target UX is mobile device + PC-style controls:

- Preferred: Bluetooth controller (Xbox/PS style)
- Keyboard + mouse via OTG/Bluetooth where supported
- Moonlight on-screen controls only as fallback

For competitive titles, controller or KB/M is recommended over touch.

## 4) Networking (no port-forward pain)

- Install Tailscale on:
  - colleague host PC
  - mobile client devices
- Use same tailnet.
- Connect Moonlight to host via Tailscale IP.

## 5) Parsec usage

- Use Parsec only for admin/troubleshooting on the host PC.
- Gameplay path remains Sunshine → Moonlight.

## 6) Game launch notes

- Fortnite / Fall Guys / Rocket League: launch from Epic on host, then stream.
- Roblox: launch on host desktop and stream.

## 7) Finish-state checklist

- [ ] One host PC online in Sunshine
- [ ] Tailscale connected on host + phone
- [ ] Moonlight paired and tested from phone
- [ ] Potato-phone preset verified (`720p30`, `4–8 Mbps`, `H.264`)
- [ ] PC controls verified (controller or KB/M)
