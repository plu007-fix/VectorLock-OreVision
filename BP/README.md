# ⚡ VECTOR LOCK — Add-on Family v2.2.0

**Minecraft Bedrock Add-on** · Created by **p7x939**
GitHub: https://github.com/plu007-fix · YouTube: https://www.youtube.com/@p7x939

---

## 🆕 v2.2.0 — API master switch + Achievements screen

- **`API: ON/OFF` button in the menu** — tap OFF and **every feature of every pack stops instantly** (pure vanilla mode, perfect for achievement hunting). Tap ON to bring it all back anytime, without losing a single setting.
- Features shut down gracefully: if you're flying you land and gravity is restored; a swapped-in totem returns your original offhand item.
- **🏆 Achievements Enabled for real** — every pack (all 22 manifests, BP + RP) declares `"product_type": "addon"` per Minecraft's official spec → **with the add-on active the world stays Achievements Enabled and you earn achievements as normal** (Stable Script API only, no Experiments required).
- **`Achievements` screen** — check your world's achievement-safety status in-game anytime.
- The same screen warns about what **permanently** disables a world's achievements: enabling Cheats / enabling Experiments / switching to Creative (with a live warning while you're in Creative mode).

---

## 🔑 Every add-on works solo — but runs best with Core!

> **Every add-on works on its own right away, nothing else required.**
> **But if you want to run more than one of my add-ons at once at full performance,
> we recommend always installing `VectorLock-Core.mcaddon` too.**

### Solo mode (no Core)
- Each add-on auto-detects Core when you enter the world — if none is found, it switches to **solo mode** on its own.
- **Sneak + Compass** → opens the settings screen **for that add-on directly** (just its own, no other menus).
- Settings save to the world as usual — install Core later and your existing settings carry over instantly.

### Why you should have Core when running 2+ add-ons
- **Unified tick management**: every add-on runs in Core's single loop → smoother than each running its own loop.
- **One unified menu**: every add-on appears as a button in a single menu, tidy, auto-added and removed.
- **Status screen / central settings (sound, particles) / Thai–English language toggle** — Core only.
- **Shared Target Mode**: Bow + Sword use the same target set through Core.

### How to install
1. (Recommended) Open `VectorLock-Core.mcaddon` first (double-click or drag into Minecraft).
2. Open each power add-on you want, one file at a time.
3. Enter the world → enable the Behavior Packs you want (Ore Vision pulls in its Resource Pack automatically).
4. In game: **Sneak + use the Compass** to open the menu / settings.

---

## 📦 All 18 power add-ons

| File | Power | Configurable |
|---|---|---|
| `VectorLock-Fly` | Fly in Survival (double-jump to toggle) | On/off |
| `VectorLock-OreVision` | See through blocks to ores/chests/spawners (X-Ray) | 13 ore types, radius, marker count |
| `VectorLock-Waypoints` | Pins, warp, HUD compass, auto-saves death location | Manage pins in the menu |
| `VectorLock-BowAiming` | Homing arrows onto target + instant crossbow fire (has Target Mode) | Range, lock angle, speed, headshot, etc. — 15 settings |
| `VectorLock-SwordAiming` | Lock camera onto target while holding a sword (has Target Mode) | Range, turn sensitivity, lock on hit |
| `VectorLock-AutoShield` | Auto-raise shield to block damage when attacked | On/off |
| `VectorLock-AutoTotem` | Auto-swap Totem into offhand when near death | Health threshold |
| `VectorLock-PreEquipShield` | Pre-equip a shield when an enemy comes close | Enemy detection range |
| `VectorLock-KillAdrenaline` | Instant Speed + Regen on a kill | Duration, buff level |
| `VectorLock-ItemMagnet` | Magnet that pulls in items/XP around you | Pull radius |
| `VectorLock-AutoRestock` | Auto-refill the hotbar when items run out / a tool breaks | On/off |
| `VectorLock-StackMerge` | Auto-merge duplicate item stacks in your inventory | On/off |
| `VectorLock-MLG` | Auto-place a water bucket to catch your fall from height | Ground scan range |
| `VectorLock-Torch` | Auto-place torches in the dark | Light-check radius |
| `VectorLock-TreeCutter` | Fell a whole tree in one cut (+ clear leaves) | Max blocks, clear leaves |
| `VectorLock-VeinMiner` | Mine a connected vein of the same ore at once | Vein radius |
| `VectorLock-ReplantHarvest` | Harvest ripe crops across an area + replant instantly | Area radius |
| `VectorLock-Bridge` | Auto-place blocks under your feet / bridge across gaps | Scaffold, Smart Gap |

**Target Mode (shared by Bow/Sword):** All / Enemies only / Animals only / Players only — set it in either pack and it applies to both.

> 💡 **Ore Vision** must be used together with its Resource Pack (bundled in the same file — enable the BP and the RP comes along automatically).
> 💡 Settings are saved to the world — remove the add-on and reinstall it and your settings are still there.

---

## ⚠️ License

**Copyright (c) 2026 p7x939. All Rights Reserved.**
Original work — entirely designed and developed by p7x939.
Copying, redistributing, re-uploading, modifying, or claiming this work as your own —
in part or in whole — is prohibited without the author's prior written permission.

*Unauthorized copying, redistribution, re-uploading, modification, or claiming
this work as your own is strictly prohibited without the author's prior
written permission.*
