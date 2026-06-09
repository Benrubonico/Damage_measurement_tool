# RPT — Damage Measurement Tool

**Web-based tool for measuring physical damage from photographs with millimetre-level accuracy.**  
Designed for professional industrial inspection. Runs on any modern browser — mobile or desktop — with no installation required beyond a PWA install.

---

## What it does

The inspector places a printed ArUco marker next to the damage, takes a photo, and opens it in the tool. The app detects the marker automatically, corrects the camera perspective, and allows measuring distances directly on the photo in millimetres. No manual calibration needed in normal use.

Typical workflow: **photo → open in tool → measure → save/share** in under 15 seconds.

---

## Key features

### Measurement core
- **Automatic scale calibration** via ArUco marker detection (OpenCV.js, DICT_4X4_50). Three marker sizes supported:
  - ID 0 → 14.75 mm (small damage, < 40 mm)
  - ID 1 → 49.874 mm (medium damage, 50–200 mm) — primary marker
  - ID 2 → 99.874 mm (large damage, > 200 mm)
- **Perspective correction** (`warpPerspective`): the marker's four corners are used to rectify the image plane, making mm/pixel constant across the entire frame. Eliminates the distance-from-marker error present in naive single-point calibration.
- **Multi-marker homography**: when ≥2 markers are detected in the same photo, the app computes a more robust rectification via `cv.findHomography` (least squares over all marker corners). Falls back to single-marker automatically when markers are not sufficiently coplanar (threshold: 15.0 px max residual).
- **Multi-marker display**: all known markers present in a photo are detected and displayed simultaneously, each with a distinct colour overlay and label. The largest marker (most pixels per side) is used as the primary scale reference.
- **Per-device lens calibration** (phase 17): one-time checkerboard calibration per phone model. Coefficients stored in `LENS_PROFILES` in `app.js`. Applied silently via `cv.undistort` before the ArUco pipeline. Currently calibrated: Realme GT 7 Pro (RMS 0.56 px, `CALIB_FIX_K3|K4|K5`). Falls back transparently for uncalibrated devices.
- **Assisted damage detection** (🎯 Auto-detect): two modes — tap a point to detect the most prominent contour in a 120 mm window around it, or draw a rectangle over the object for a modal offering Width, Height, Both, or Longest diagonal. Uses `cv.minAreaRect` so dimensions follow the object's own axes regardless of rotation. If no contour is found, returns to idle silently.
- **Stereometry** (🧪 experimental): load two photos of the same damage from slightly different angles. The app estimates depth/height via template matching and the thin-lens formula. Typical error ~15–25% on non-reflective surfaces. Marked experimental in the UI.
- **Tilt detection**: photos where the marker's sides differ by more than 15% in length trigger a blocking modal. The user can retake the photo or continue under their own responsibility (badge turns red with ⚠).
- **Manual calibration fallback**: two-point reference flow for photos without a marker.

### Measurement display
- **Engineering-style dimensions**: named dimension lines parallel to the measurement, with perpendicular extension lines and arrowheads. Draggable offset.
- **Multiple named dimensions** per photo: add, rename, delete. Tap briefly on a dimension line to edit; drag to reposition.
- **Scale badge**: always visible, shows marker ID, scale in mm/px, and a ⚠ warning if the calibration was accepted under tilt.

### Visual tools
- **Before/after comparison** (⊙ View original): hold to see the un-rectified photo at the same zoom and pan.
- **Accuracy lens map** (◎): hold to show a radial gradient overlay — green at centre (~0.1% error with calibrated device) → yellow at 70% boundary → red at corners (~3% error). Never appears on exported JPEGs.
- **Free annotations**: freehand pen tool with configurable colour and stroke width, plus text stamps. Full undo and clear-all support.
- **Clean view**: hide all overlays to see the photo only.
- **Pinch-zoom and pan** for precise point placement on mobile and desktop.

### Export and sharing
- **Save as JPEG**: exports the annotated photo at full resolution with all marks baked in.
- **Native share**: Web Share API on supported devices (Android, iOS).
- **HEIC/HEIF support**: iPhone photos converted client-side via heic2any — no server needed.

### Infrastructure
- **PWA**: installable on Android, iOS, Windows and macOS. Works fully offline after first load.
- **Privacy-by-design**: all processing is client-side. No images or measurements leave the device. No external API calls after initial load.
- **Optional password gate**: SHA-256 client-side lock. Disabled by default; enable by setting `AUTH_ENABLED = true` in `app.js`.

---

## Accuracy (validated, June 2026)

| Condition | Method | Error |
|---|---|---|
| Calibrated device, straight-edged damage, close, ≤ 70% zone | Auto (minAreaRect) | **~0.1%** |
| Straight-edged damage, close, vertical orientation, ≤ 70% zone | Auto (minAreaRect) | **~0.5%** |
| Straight-edged damage, close, ≤ 70% zone | Manual | ~0.7% (systematic underestimate) |
| Straight-edged damage, far, ≤ 70% zone | Auto or Manual | ~1.5–2.0% |
| Rotated object (up to ~45°) | Auto (minAreaRect) | < 1.5% |
| Damage near image edges (~90%) | Any | 2–3% |
| Marker ID 0 (15 mm), any condition | Any | 3–5% — use with caution |
| Severely tilted photo (> 45°) | Any | 2–3% |
| Circular objects (coins, rivets) | Manual only | ~1–2% |

**Auto-detect vs manual:** for straight-edged objects, 🎯 Auto-detect is more accurate than manual point placement. Manual tapping typically lands ~0.5–1 mm inside the real edge, causing a systematic underestimate of ~0.7%. Use manual only for circular objects or when autodetection fails to find the contour.

**Distance matters:** taking the photo closer to the surface gives more pixels per mm and reduces contour detection uncertainty. Far photos approach the 2% limit even within the safe zone.

**Orientation matters:** orient the phone so the long axis of the damage runs vertically in the frame. Best validated result: vertical orientation, close, manual — long side +0.5%, short side +0.2%.

**Key finding from pre/post phase 6 testing:** before perspective correction, error scaled with distance from marker (up to +7.5% at far edges). After correction, this systematic bias was eliminated — error is now distance-independent within the safe zone.

---

## Measurement limits

The pipeline is **2D geometric** — it measures distances on the plane of the marker. It does **not** measure:
- Depth, volume, or relief of the damage (stereometry provides an experimental estimate only).
- Features lying on a different plane from the marker.
- Anything outside the photo frame.

---

## How to install (PWA)

1. Open the app URL in Chrome (mobile or desktop).
2. Sign in with your Microsoft account (access must be granted by the administrator first).
3. Tap or click "Install". The app icon appears on your home screen or desktop.
4. From that point on, the app works fully offline.

**iOS Safari:** tap the share button → "Add to Home Screen".

---

## Operational rules for < 2% error

- Use the phone's **main camera at 1× zoom**. Never wide-angle (0.5×) — its geometric distortion is not corrected by this pipeline.
- Place the marker **flat against the surface**, as close to the damage as possible (ideally 5–15 cm).
- Keep **both marker and damage within the central 70%** of the image. Lens distortion grows toward the edges.
- **Take the photo as close as practicable.** Closer = more pixels per mm = lower error. Far photos approach the 2% limit even within the safe zone.
- **Orient the phone so the long axis of the damage runs vertically** in the frame (portrait orientation for elongated damage).
- Hold the phone as **parallel to the surface** as possible. The tilt warning fires at a 15% side-variance limit, but is a coarse filter — moderate angles below the threshold still introduce error.
- Prefer **marker ID 1** (50 mm) for most inspections. ID 0 (15 mm) is unreliable; use only when ID 1 does not fit the scene.
- Avoid auto-switching to macro mode at very close range on phones that change lens automatically.
- For **straight-edged damage**, use 🎯 Auto-detect. It finds the real contour boundary and is more accurate than manual tapping.
- For **circular damage** (dents with circular shape, rivet pull-ins), use manual measurement. Auto-detect cannot reliably find the true diameter of a circle.

---

## Repository structure

```
repo-root/
├── index.html              App shell (HTML + CSS; script tag points to app.js)
├── app.js                  All application logic (JavaScript)
├── manifest.json           PWA manifest
├── sw.js                   Service worker (Cache-First, offline support)
├── README.md               This file
├── PROJECT_CONTEXT.md      Full project context and development log
├── icons/
│   ├── icon-192.png        PWA icon 192×192
│   └── icon-512.png        PWA icon 512×512
└── lib/
    ├── opencv.js           OpenCV.js 4.12.0 techstark build (~10 MB, includes ArUco)
    └── heic2any.min.js     HEIC→JPEG converter (~1 MB)
```

---

## Tech stack

- **Vanilla HTML + CSS + JavaScript.** No frameworks, no build step, no npm, no transpiler.
- **OpenCV.js** (techstark build 4.12.0): ArUco detection + `warpPerspective` + `findHomography` + `minAreaRect` + `undistort`. Bundled locally — the official opencv.org build does not include ArUco.
- **heic2any** 0.0.4: client-side HEIC/HEIF conversion. Bundled locally.
- **Azure Static Web Apps**: hosting and access control via Microsoft account authentication (role: inspector).
- **GitHub Actions**: automatic deployment to Azure on every push to `main`.

---

## Updating the cache after a new release

When you publish a new version, increment the version constant in `sw.js`:

```javascript
const CACHE_VERSION = 'v2';  // was 'v1'
```

All users will automatically receive the update on their next visit.

---

## Roadmap

| Phase | Status | Description |
|---|---|---|
| 1–5 | ✅ Done | ArUco detection, automatic calibration, photo loading, HEIC support |
| 6 | ✅ Done | Perspective correction (`warpPerspective`) + view original button |
| 7 | ✅ Done | Safe zone overlay (folded into phase 6) |
| 8 | ✅ Done | PWA: manifest + service worker + offline support + app icons |
| 9 | ✅ Done | Azure Static Web Apps deployment + Microsoft account access control |
| 10 | ✅ Done | UX overhaul: left panel, engineering dimension lines, draggable offset |
| 11 | ✅ Done | Free annotations: freehand pen + text stamps + undo |
| 12 | ✅ Done | Accuracy lens map + dimension tap-to-edit + bug fixes |
| 13 | ✅ Done | Multi-marker support — **tagged v1.0-core** |
| 14 | ✅ Done | Extract `app.js` (maintainability refactor) — **tagged v1.1-extract-app-js** |
| 15 | ✅ Done | Assisted damage detection: Canny + `minAreaRect`, no AI |
| 16 | ✅ Done | Multi-marker homography (`findHomography`, 15 px threshold) — **tagged v1.2-multimarker** |
| 17 | ✅ Done | Per-device lens calibration (checkerboard, RMS 0.56 px) — **tagged v1.3-lens-calibration** |
| 18 | ✅ Done | Stereometry: experimental depth estimation from two photos — **tagged v1.4-stereometry** |
| 21 | 🔄 Next | ONNX Runtime Web: custom-trained damage model in browser |
| 23 | ⏸ Planned | Domain-aware detection: rivets, edges, automatic measurement proposals |
| 24 | ⏸ Planned | AI-generated inspection report (Azure OpenAI, numeric data only) |