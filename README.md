# RPT — Damage Measurement Tool

**Internal tool for measuring physical damage from photographs with millimetre-level accuracy.**  
Built for professional aircraft damage inspection. Runs on any modern browser — mobile or desktop.

---

## What it does

The inspector places a printed ArUco marker next to the damage, takes a photo, and opens it in the tool. The app detects the marker automatically, corrects perspective, and allows measuring distances directly on the photo in millimetres. No manual calibration needed.

Typical workflow: **photo → open in tool → measure → save/share** in under 15 seconds.

---

## Key features

- **Automatic scale calibration** via ArUco marker detection (OpenCV.js). Three marker sizes supported (15 / 50 / 100 mm).
- **Perspective correction** (`warpPerspective`): the plane of the marker is rectified so mm/pixel is constant across the entire image, eliminating the distance-from-marker error present in naive single-point calibration.
- **Safe zone overlay**: dashed guide covering the central 70% of the image, where lens distortion is minimal (~0.3% error vs ~3% at edges).
- **Tilt detection**: photos with a deformed marker trigger a warning modal. The user can retake or accept responsibility.
- **Multiple named dimensions** per photo: add, rename, hide, delete.
- **Before/after comparison**: hold the "Original" button to see the un-rectified photo at the same zoom and pan.
- **Manual calibration fallback**: two-point reference flow for photos without a marker.
- **HEIC/HEIF support**: iPhone photos converted client-side via heic2any, no server needed.
- **Save and share**: export annotated JPEG or share via native Web Share API.
- **PWA**: installable on Android, iOS, Windows and macOS. Works fully offline after first use.
- **Optional password gate**: SHA-256 client-side lock. Disabled by default; enable by setting `AUTH_ENABLED = true` in the script.

---

## Accuracy (measured, May 2026)

| Condition | Error |
|---|---|
| Damage centred in image (≤ 70% zone) | ~0.3% |
| Damage near image edges (~90%) | 2–3% |
| Marker ID 1 (50 mm), main camera 1×, centred | **< 0.5%** |
| Marker ID 0 (15 mm), any condition | 3–5% (use with caution) |

Root cause of residual error: radial lens distortion (not corrected by perspective transform). Mitigated by the safe zone operational rule.

---

## Measurement limits

The pipeline is **2D geometric** — it measures distances on the plane of the marker. It does **not** measure:
- Depth or volume of the damage.
- Features on a different plane from the marker.

---

## How to install (PWA)

1. Open **https://benrubonico.github.io/Medidor-danos/** in Chrome (mobile or desktop).
2. Chrome shows an install prompt (⊕ icon in the address bar on desktop, or "Add to home screen" on Android).
3. Accept. The app icon appears on your home screen or desktop.
4. From that point on, the app works offline.

**iOS Safari:** tap the share button → "Add to Home Screen".

---

## Operational rules for < 2% error

- Use the phone's **main camera at 1× zoom**. Do not use wide-angle (0.5×).
- Place the marker **flat against the surface**, as close to the damage as possible (5–15 cm).
- Keep **both marker and damage within the central 70%** of the image (the cyan safe zone overlay guides this).
- Prefer **marker ID 1** (50 mm) for most inspections. Use ID 2 (100 mm) only for large damage.
- Avoid angles > 45°. The tilt warning fires at the configured limit but is a coarse filter.

---

## Repository structure

```
repo-root/
├── index.html              Main app (single file)
├── manifest.json           PWA manifest
├── sw.js                   Service worker (Cache-First, offline support)
├── README.md               This file
├── PROJECT_CONTEXT.md      Full project context for AI-assisted development
├── icons/
│   ├── icon-192.png        PWA icon 192×192
│   └── icon-512.png        PWA icon 512×512
└── lib/
    ├── opencv.js           OpenCV.js 4.12.0 techstark build (~10 MB)
    └── heic2any.min.js     HEIC→JPEG converter (~1 MB)
```

---

## Tech stack

- **Vanilla HTML + CSS + JavaScript.** No frameworks, no build step, no npm.
- **OpenCV.js** (techstark build 4.12.0): ArUco detection + `warpPerspective`. Bundled locally.
- **heic2any** 0.0.4: client-side HEIC conversion. Bundled locally.
- **All processing is client-side.** No images or data leave the device.

---

## Updating the cache after a new release

When you publish a new version of `index.html`, increment the version constant in `sw.js`:

```javascript
const CACHE_VERSION = 'v2';  // was 'v1'
```

All users will automatically receive the update on their next visit.

---

## Roadmap

| Phase | Status | Description |
|---|---|---|
| 1–7 | ✅ Done | ArUco detection, perspective correction, safe zone, tilt warning |
| 8 | ✅ Done | PWA (manifest + service worker + offline support) |
| 9 | ⏸ Next | Azure Static Web Apps + Entra ID corporate authentication |

---

*Internal use only — Accenture / Airbus Operations.*
