# Damage Measurement Tool — Project Context

## Goal

Build a web-based tool to measure physical damage (dents, scratches,
cracks) from photographs, with millimetre-level accuracy, for internal
professional use. The tool must run on both mobile and desktop from a
single codebase.

**Target domain:** The tool is designed for industrial inspection of
flat or slightly curved surfaces — its primary intended application is
aerospace (fuselage panels, wing skin, structural components). All
pipeline design decisions, accuracy targets, and operational rules
reflect that context.

**Personal portfolio and learning track:** Real aerospace damage photos
are confidential (property of Accenture and its clients). For all
personal learning, dataset building, model training, and public
portfolio work, vehicle bodywork damage is used as the equivalent
domain. Car panels are geometrically analogous to aircraft skin panels:
flat or slightly curved, rigid, with similar defect types (dents,
scratches, deformation). The pipeline, marker workflow, accuracy
targets, and operational rules are identical. The skill is directly
transferable: if hired, the same tool applies to aerospace data with
no changes to the core pipeline.

## Current state

A working HTML/CSS/JavaScript app split across `index.html` (shell)
and `app.js` (all logic).
Hosted on GitHub (private repo, set to private in phase 9).
Deployed on Azure Static Web Apps (phase 9).
Installable as a PWA (Progressive Web App) on any device.
Tagged as v1.0-core after phase 13 completion.
Tagged as v1.1-extract-app-js after phase 14 completion.
Tagged as v1.2-multimarker after phase 16 completion.

### Implemented features

- Photo loading from camera or gallery, including HEIC/HEIF support
  for modern iPhones and Android phones (converted client-side to
  JPEG via heic2any).
- Automatic scale calibration via ArUco marker detection (DICT_4X4_50
  dictionary). Marker IDs map to physical sizes via a configurable
  table:
    - ID 0 → 14.75 mm  (small damage, < 40 mm)
    - ID 1 → 49.75 mm  (medium damage, 50–200 mm)
    - ID 2 → 99.75 mm  (large damage, > 200 mm)
  When several markers are detected, the largest one (most pixels per
  side) wins as the primary scale. All detected markers are drawn
  and their corners stored in state for future geometry phases.
- Multi-marker support (phase 13): all known markers present in the
  photo are detected and displayed simultaneously, each with a
  distinct colour per ID and its own quadrilateral overlay and label.
  Corners of all detected markers are stored in state.allDetectedMarkers
  as groundwork for future multi-plane geometry phases.
- Perspective correction (phase 6): after detecting the ArUco marker,
  the app applies cv.warpPerspective using the four detected corners
  to produce a rectified image where mm/pixel is constant across the
  whole frame. The original (un-rectified) image is kept in
  state.originalPhoto for the "view original" comparison button.
  Corner ordering is normalised to canvas-aligned TL/TR/BR/BL before
  the transform, so any physical orientation of the marker works.
  A sanity check (cv.perspectiveTransform on the four corners) verifies
  the matrix before applying it; if it fails the app falls back to
  non-rectified calibration and logs a warning.
- Multi-marker homography (phase 16): when ≥2 known markers are
  detected in the same photo, the app attempts a more robust
  rectification using cv.findHomography (least squares) over all
  corners of all markers. A 2.0 px max-residual threshold gates
  activation — if exceeded, the app falls back transparently to
  single-marker phase 6 rectification. Activates in practice when
  markers are genuinely coplanar (taped to the same flat surface).
  Falls back gracefully in all other scenarios with no precision loss.
- "View original" button (⊙ Original): visible in measure-idle phase
  when a rectified image is loaded. While held, shows the un-rectified
  photo with no overlays at the current zoom/pan, for before/after
  comparison. Releases back to the rectified view on pointer-up or
  pointer-leave.
- Measurement reliability heatmap (◎ Accuracy lens map): hold-to-show
  radial gradient overlay (green at centre → yellow at 70% boundary →
  red at corners), based on the lens distortion error model. Never
  appears on exported JPEGs. SAFE_ZONE_RATIO = 0.70 kept as constant
  for the gradient calculation.
- Perspective tolerance check: photos with side-length variance above
  PERSPECTIVE_TILT_LIMIT = 1.10 trigger a blocking modal with two
  choices: retake the photo, or continue under user responsibility
  (badge turns red with ⚠).
- Visual marker representation: when calibration is automatic, the
  detected marker is drawn as a closed quadrilateral with a label
  showing its real side length. Tilted markers therefore appear
  visibly as trapezoids, making perspective distortion evident.
- Manual two-point calibration as fallback for photos without a
  marker, with onboarding modal and reference value entry.
- Enriched scale badge:
    - Automatic calibration: "ID X — Y.YYY mm/px" (yellow).
    - Manual calibration: "Y.YYY mm/px" (yellow).
    - Tilted photo accepted under user responsibility: red with ⚠.
- Assisted damage detection (phase 15): two interaction modes.
  Tap mode: Canny edge detection in a fixed 120 mm window around the
  tap point, proposes the two farthest endpoints of the most prominent
  contour. Drag-rectangle mode: inspector draws a rectangle over the
  object; Canny runs inside that rectangle; a modal offers Width,
  Height, Both (W+H), or Longest diagonal. Geometry from
  cv.minAreaRect so dimensions follow the object's own axes regardless
  of rotation — a card at 30° gives correct width and height, not the
  axis-aligned bounding box. If Canny finds nothing, returns to idle
  silently without creating spurious dimensions.
- Multiple named dimensions per photo: add, rename, delete.
  Tap briefly on a dimension line to open the edit modal (rename
  or delete). Long press / drag moves the dimension line.
- Pinch-zoom and pan for precise point placement.
- Clean view (overlays hidden, photo only), save as JPEG with marks
  baked in, native share via Web Share API.
- Optional password gate (SHA-256 hash, client-side only). Disabled
  by default; configurable at top of script.
- Loading overlay while OpenCV.js initialises (~10 MB WebAssembly,
  needs a few seconds on first load).
- PWA support (phase 8): the app is installable on any device
  (Android, iOS, Windows, macOS) via a manifest.json and a service
  worker (sw.js). Cache-First strategy: small files pre-cached on
  install; opencv.js (~10 MB) and heic2any (~1 MB) cached on first
  use. Once cached, the app works fully offline. To force all users
  to pick up a new version, increment CACHE_VERSION in sw.js.
  App icon: DMT logo with Accenture purple gradient (#A100FF),
  192×192 and 512×512 PNG, stored in icons/.

### Pending work (current focus)

Ongoing improvements to the Damage Measurement Tool, in planned order:

- Phase 17 — Per-device lens distortion calibration: one-time
  checkerboard calibration per phone model using cv.calibrateCamera
  + cv.undistort. Required before stereometry for acceptable accuracy.
- Phase 18 — Stereometry: light 3D depth estimation from two photos
  of the same damage, aligned via marker anchor, depth by
  triangulation. Requires phase 17 to keep error below 5%.
- Phase 19 — ONNX Runtime Web integration: integrate the custom-trained
  vehicle damage model (YOLOv8 → ONNX) into the web app for
  client-side damage detection. No backend required.
- Phase 20 — Real-time capture assistant: live video stream with
  continuous ArUco detection and overlaid guidance. Most complex
  phase technically.

A separate second portfolio project focused on AI applied to vehicle
damage inspection (pipeline, dataset, model training) will be planned
independently when the tool reaches maturity. It is not a phase of
this project.

### Deferred to separate chats

- Native packaging (APK / .exe): deferred per original spec; only
  revisit if a concrete reason emerges.

## Implementation phases (historical reference)

1. ✅ Set up local dev environment (VS Code + clone repo).
2. ✅ Print physical ArUco markers (15/50/100 mm). Real measured
   sizes after printing: 14.75 / 49.75 / 99.75 mm. Validated against
   credit card and 1 € coin as ground-truth references.
3. ✅ Load OpenCV.js locally (bundled, no CDN).
4. ✅ Detect marker on photo load; compute mm/pixel automatically.
5. ✅ Integrate detection into the main photo-load flow
   (sub-edits F, G, H complete). Tilted-photo modal (Edición B)
   and visual marker rectangle (Edición H) both shipped.
6. ✅ Perspective correction using marker's four corners (warpPerspective)
   + safe zone overlay (SAFE_ZONE_RATIO = 0.70) + "view original"
   comparison button. All shipped in this phase.
7. ✅ Safe zone overlay — folded into phase 6.
8. ✅ Convert to PWA: manifest.json + sw.js (Cache-First, opencv.js
   cached on first use) + icons (DMT, Accenture purple gradient,
   192×192 and 512×512). App installable and offline-capable.
   Deployed and verified on GitHub Pages:
   https://benrubonico.github.io/Medidor-danos/
9. ✅ Migrate to Azure Static Web Apps. Repo set to private on GitHub.
   Deployed at: https://purple-bay-0a9a14e10.7.azurestaticapps.net
   Authentication: Microsoft accounts (personal), managed via Azure
   Role Management (role: inspector). Access granted per user manually.
   GitHub Pages left active as fallback; AUTH_ENABLED remains false in
   app.js (password gate disabled by default).
   Entra ID corporate accounts (Accenture tenant) blocked by corporate
   IT policy — not usable without admin approval from Accenture IT.
10. ✅ UX overhaul: collapsible left-side instruction panel (Tools &
    Guide, Accenture purple tab), visual refresh, secondary buttons
    moved into panel, engineering-style moveable dimension lines
    (parallel to measurement, perpendicular extension lines,
    arrowheads, draggable offset). DIM_OFFSET_DEFAULT = -40.
11. ✅ Free annotations: freehand pen + text stamps on photo.
    Controls in Tools & Guide panel.
12. ✅ Measurement reliability heatmap: hold-to-show radial gradient
    overlay (green at centre → yellow at 70% boundary → red at
    corners). Same interaction pattern as ⊙ Original. Never appears
    on exported JPEGs. Button: ◎ Accuracy lens map, visible in
    measure-idle alongside ⊙ View original.

    Also in this phase:
    - Safe zone cyan rectangle removed (SAFE_ZONE_RATIO = 0.70 kept
      as constant for heatmap calculation).
    - Right-side dimensions panel removed entirely.
    - Dimension edit/delete now via brief tap on the dimension line:
      opens modal with rename + delete, same interaction pattern as
      text stamps. Long press / drag still moves the dimension line.
    - Two pre-existing bugs fixed: pan (missing const dx in
      onMouseMove) and dimension drag (missing draggingDim block
      in onMouseMove).
13. ✅ Multi-marker support: all known markers in the photo are
    detected and displayed simultaneously. Each marker ID rendered
    with a distinct colour quadrilateral and label. Largest marker
    used as primary scale (behaviour preserved). All detected marker
    corners stored in state.allDetectedMarkers as groundwork for
    future geometry phases. Tag v1.0-core created at this point.
14. ✅ Extract app.js: all JavaScript moved from index.html to app.js.
    Added to PRE_CACHE_URLS in sw.js. No behaviour change.
    Tag v1.1-extract-app-js created.
15. ✅ Assisted damage detection: Canny + contours, no AI.
    Two interaction modes: tap (Canny in fixed 120 mm window around
    tap point) and drag-rectangle (Canny inside drawn area). Drag
    mode opens a modal: Width, Height, Both (W+H), or Longest diagonal.
    Geometry from cv.minAreaRect so dimensions follow the object's own
    axes regardless of rotation. If Canny finds nothing, returns to
    idle silently — no spurious dimensions created.
    Validated experimentally: credit card horizontal and rotated ~30°,
    error <1.5% with autodetection within safe zone.
16. ✅ Multi-marker homography: cv.findHomography with all corners of
    all detected markers (≥2 markers). Threshold 2.0 px max residual —
    if exceeded, falls back automatically to single-marker phase 6
    rectification with no precision loss. Activates in practice only
    when markers are genuinely coplanar (same flat surface).
    Also in this phase:
    - minAreaRect replaces axis-aligned bbox for rotated object support.
    - Fallback that created dimensions when Canny found nothing removed.
    Tag v1.2-multimarker created.
17. ⏸ Per-device lens distortion calibration (checkerboard).
18. ⏸ Stereometry: light 3D depth estimation from two photos.
19. ⏸ ONNX Runtime Web: custom-trained vehicle damage model in browser.
20. ⏸ Real-time capture assistant: live ArUco + guidance overlay.

## Distribution strategy

- Primary: deployed as PWA on Azure Static Web Apps.
  URL: https://purple-bay-0a9a14e10.7.azurestaticapps.net
  Access controlled via Azure Role Management (role: inspector).
  Each user added manually by the owner. Microsoft personal accounts
  only (Accenture corporate accounts blocked by tenant IT policy).
  Users install by opening the URL in Chrome and tapping "Install".
  After installation, the app works fully offline.
- **Future corporate hosting**: if Accenture IT ever approves the
  Azure SWA application (a request was automatically generated when
  a corporate account attempted login), Entra ID would allow any
  @accenture.com account to access automatically. No code change
  needed; only the Azure Role Management configuration would change.
- Native APK / .exe: deferred unless a concrete reason a PWA can't
  cover emerges. Tools for that day: Capacitor (APK) or Tauri (.exe).

## Versioning strategy

### Checkpoint at phase 13 close — completed

1. ✅ Final commit on main: `phase 13 complete: multi-marker support`
2. ✅ Tag: `v1.0-core` — stable measurement core, always recoverable.

### Checkpoint at phase 14 close — completed

✅ Tag: `v1.1-extract-app-js` — app.js extracted, no behaviour change.

### Checkpoint at phase 16 close — completed

✅ Tag: `v1.2-multimarker` — multi-marker homography + minAreaRect +
experimental validation. Merged to main.

### Planned branches

- `feature/phase-17-lens-calibration` — checkerboard per-device calib.
- `feature/phase-18-stereometry` — light 3D from two photos.
- `feature/phase-19-onnx` — ONNX Runtime Web integration.

All branches fork from main after v1.2-multimarker.

## Tech stack and constraints

- Vanilla HTML + CSS + JavaScript. No frameworks (React, Vue, etc.).
- App logic in `app.js` (extracted in phase 14). HTML shell in
  `index.html`. PWA adds two small files: `manifest.json` and `sw.js`.
- External dependencies bundled locally in `lib/`:
    - OpenCV.js: techstark build, version 4.12.0-release.1.
      Includes the objdetect/ArUco module. Bundled at
      `lib/opencv.js`. ~10 MB. Source verified: the official
      opencv.org build does NOT include ArUco; the techstark
      build does (confirmed by listing cv keys at runtime).
    - heic2any: version 0.0.4. Bundled at `lib/heic2any.min.js`.
      ~1 MB. Self-contained (WebAssembly embedded as base64).
- No npm, no build step, no transpiler.
- Must run identically on iOS Safari, Android Chrome, and desktop
  Chrome / Firefox / Edge.
- No backend. All processing client-side. This constraint is
  fundamental and applies to all planned phases including AI model
  inference (via ONNX Runtime Web) — no API key is ever exposed
  in client-side code.

## Repository structure

    repo-root/
    ├── index.html              (app shell — HTML and CSS only, script in app.js)
    ├── app.js                  (all JavaScript; extracted in phase 14)
    ├── manifest.json           (PWA manifest — created in phase 8)
    ├── sw.js                   (service worker — created in phase 8)
    ├── README.md               (repository description for GitHub)
    ├── PROJECT_CONTEXT.md      (this file, also in Claude project context)
    ├── icons/
    │   ├── icon-192.png        (PWA icon 192×192, DMT Accenture purple)
    │   └── icon-512.png        (PWA icon 512×512, DMT Accenture purple)
    └── lib/
        ├── opencv.js           (~9-10 MB, do not edit)
        └── heic2any.min.js     (~1 MB, do not edit)

## Data handling and privacy

- All image processing is performed client-side, in the user's browser.
- No images, measurements, or user data are transmitted to external
  servers at any point.
- No third-party AI, cloud vision, or analytics services are used.
- External dependencies (OpenCV.js, heic2any) are bundled within the
  repository and served locally. The application makes no external
  network requests after the initial page load.
- This privacy-by-design architecture is what makes the tool suitable
  for confidential industrial environments (aerospace, automotive
  insurance, fleet management) without requiring IT approval for
  cloud data processing.

## Measurement assumptions and physical limits

The measurement pipeline (ArUco scale calibration + perspective
correction) is geometric, not optical. It corrects how pixels are
arranged, not how they are lit or coloured. Honest documentation of
the assumptions underneath:

### What the system measures correctly
- Lengths and contours of features lying on the same plane as the
  ArUco marker.
- Damage on flat or slightly curved surfaces where the local curvature
  around the marker and the damage is negligible (< 1° within the
  marker-to-damage radius). This covers aircraft fuselage panels,
  wing skin, structural components — and equivalently, car body
  panels, bonnets, doors, and bumpers, which share the same geometric
  properties and are used as the personal/portfolio validation domain.

### What the system does NOT measure
- Depth or relief of the damage. The pipeline is 2D over the surface
  plane; it has no notion of out-of-plane displacement.
- Features lying on a different plane from the marker (e.g. marker
  on one face of a corner, damage on the perpendicular face).
- Anything outside the photo. The marker must be in the same shot
  as the damage.

### Operational rules to keep error below the 2% target
- Place the ArUco marker as close as possible to the damage
  (ideally 5–15 cm), on the same surface, flat against it.
- Frame the photo so the marker is near the **optical centre** of
  the image (centre of the camera viewfinder), not at a corner. The
  marker acts as the ruler of the whole system; if it lies in a
  zone where the lens distorts, every measurement inherits that
  distortion.
- Use the phone's main camera (1x zoom). Do NOT use wide-angle
  (0.5x) or ultra-wide lenses: their geometric distortion (5–15%
  at the edges) is not corrected by this pipeline.
- Frame both the damage and the marker within the central 70% of
  the image (the "safe zone" overlay shows this boundary). Lens
  distortion grows toward the edges. Experimentally confirmed: error
  is ~0.3% at centre, rising to ~3% at image edges.
- **Take the photo as close as practicable** while keeping both marker
  and damage within the central 70% of the frame. Closer = more
  pixels per mm = less amplification of contour detection uncertainty.
  "Far" photos approach the 2% error limit even within the safe zone.
- **Orient the phone so the long axis of the damage runs vertically**
  in the frame (portrait orientation for elongated damage). The long
  axis benefits most from maximum pixel coverage. Validated
  experimentally: vertical-close gives best results for both axes
  simultaneously (long side +0.5%, short side +0.2%).
- Use the phone in whichever orientation (portrait / landscape) best
  fits the damage shape following the rule above. No significant
  accuracy difference when framing is otherwise equivalent.
- Avoid auto-switching to macro mode at very close range; some
  phones change lens automatically without warning.
- Avoid extreme oblique angles. Perspective correction (phase 6)
  handles moderate tilt well, but extreme angles (> 45°) degrade
  both detection and correction.
- Use the marker ID appropriate for the damage size:
    - ID 0 (15 mm): only when the damage is so small that larger
      markers do not fit. This marker occupies very few pixels and
      is susceptible to detection noise (~3–5% error, variable
      between photos). Avoid if ID 1 fits.
    - ID 1 (50 mm): primary marker for most inspections. Best
      accuracy of the three in real-world tests (~0.3% at centre).
    - ID 2 (100 mm): for large damage where ID 1 is visually too
      small relative to the damage extent.
- For objects with **straight edges**, prefer **🎯 Auto-detect** over
  manual point placement. Autodetection (minAreaRect) finds the real
  contour boundary; manual tapping typically lands ~0.5–1 mm inside
  the edge, causing a systematic underestimate of ~0.7%.
- For **circular objects** (coins, rivet heads), use manual
  measurement. Autodetection cannot reliably find the true diameter
  of a circle from a single Canny contour.

### What we deliberately do NOT do
- No automatic brightness, contrast, colour or filter adjustments
  are applied to the photo. The image stored in the final JPEG is
  geometrically rectified but otherwise unmodified, preserving
  traceability for professional documentation.
- No AI-based "enhancement" of the image. The pipeline is fully
  deterministic and defensible.
- For photos where lighting is so poor the damage is not visible,
  the correct response is to retake the photo with better light,
  not to post-process the existing one.

## Experimental findings (May 2026)

### Pre-phase-6 results (without perspective correction)

Real-world calibration testing with the three printed markers
(14.75 / 49.75 / 99.75 mm). Test conditions: handheld phone, main
camera at 1×, moderate inclination, marker side-variance below 1.10.

Measuring a 1 € coin (real diameter 23.25 mm) at different distances
from the marker, with each of the three markers:

| Marker | Coin near marker | Coin far from marker |
|--------|------------------|----------------------|
| ID 0   | -1.08 %          | +4.52 %              |
| ID 1   | -1.94 %          | +7.53 %              |
| ID 2   | -3.23 %          | +6.24 %              |

Measuring a credit card (real long side 85.60 mm) with the small
marker (ID 0):

| Position             | Error    |
|----------------------|----------|
| Card near marker     | +3.04 %  |
| Card far from marker | +4.56 %  |

Key finding: error scaled systematically with distance from marker.
Root cause: constant-scale assumption is invalid under any camera tilt.

### Post-phase-6 results (with perspective correction)

Setup: marker ID 1 (49.75 mm), objects centred in image central 70%,
main camera at 1×, handheld.

Credit card long side (real: 85.60 mm) — four photos, three
measurements each:

| Photo | Orientation | Distance | Mean    | Error   |
|-------|-------------|----------|---------|---------|
| 1     | Portrait    | Normal   | 85.83   | +0.27 % |
| 2     | Landscape   | Normal   | 85.80   | +0.23 % |
| 3     | Portrait    | Far      | 85.77   | +0.20 % |
| 4     | Landscape   | Far      | 85.97   | +0.43 % |

1 € coin (real: 23.25 mm) near marker, centred: 23.0–23.3 mm
(−1.1% to +0.2%). Note: measuring circular diameters introduces
user error of ±0.5 mm from estimating the diametral line; objects
with straight edges give more reliable results.

### Post-phase-15/16 results (minAreaRect autodetection, May 2026)

Setup: marker ID 1 (49.75 mm) + marker ID 2 (99.75 mm), objects
within central 70% of image, main camera 1×, handheld, flat surface.
Phase 16 multi-marker fell back to single-marker in all these tests
(markers on separate cartulinas, not coplanar enough to pass the
2.0 px threshold). Results reflect phase 6 rectification + phase 15
autodetection.

**Credit card (real: 85.60 × 53.98 mm) — horizontal, manual
(3 measurements):**

| Measure | M1 | M2 | M3 | Mean | Error |
|---|---|---|---|---|---|
| Long side | 84.8 | 84.8 | 85.3 | 84.97 | −0.73% |
| Short side | 53.6 | 53.6 | 53.5 | 53.57 | −0.76% |
| Auto long | — | — | 85.7 | 85.7 | +0.12% |
| Auto short | — | — | 53.9 | 53.9 | −0.15% |

**Credit card (real: 85.60 × 53.98 mm) — rotated ~30°, manual
(3 measurements):**

| Measure | M1 | M2 | M3 | Mean | Error |
|---|---|---|---|---|---|
| Long side | 86.3 | 86.3 | 86.1 | 86.23 | +0.73% |
| Short side | 54.0 | 53.8 | 54.1 | 53.97 | −0.02% |
| Auto long | — | — | 86.7 | 86.7 | +1.3% |
| Auto short | — | — | 54.4 | 54.4 | +0.74% |

**Fridge magnet (real: 119 × 49.5 mm) — orientation and distance
study:**

| Condition | Method | Long (119mm) | Error | Short (49.5mm) | Error |
|---|---|---|---|---|---|
| Horizontal, close | Auto | 120.2 | +1.0% | 50.4 | +1.8% |
| Horizontal, close | Manual | 120.2 | +1.0% | 49.9 | +0.8% |
| Horizontal, far | Auto | 121.3 | +1.9% | 50.6 | +2.2% |
| Horizontal, far | Manual | 120.9 | +1.6% | 49.6 | +0.2% |
| Vertical, close | Auto | 120.5 | +1.3% | 50.2 | +1.4% |
| Vertical, close | Manual | 119.6 | +0.5% | 49.6 | +0.2% |
| Vertical, far | Auto | 121.4 | +2.0% | 50.8 | +2.6% |
| Vertical, far | Manual | 120.5 | +1.3% | 50.6 | +2.2% |

Best overall result: **vertical orientation, close, manual**
(long +0.5%, short +0.2%).

### Interpretation

1. **Error scales monotonically with the distance from the measured
   point to the marker (pre-phase-6).** This is not noise; it is a
   systematic geometric bias.

2. **Post-phase-6: the systematic bias has been eliminated.** Error
   is now ~0.3% at centre regardless of distance from marker.

3. **Root cause of residual error: radial lens distortion.** Error
   rises from ~0.3% at centre to ~3% at image edges. warpPerspective
   does not correct lens distortion; only perspective. Mitigated by
   the safe zone operational rule.

4. **The tilt warning (PERSPECTIVE_TILT_LIMIT = 1.10) is a weak
   signal for small markers.** A marker occupying 7-10% of the image
   width can show negligible side variance even when the camera is
   tilted enough to cause 5+% measurement error. Useful as a coarse
   filter but not sufficient on its own.

5. **Marker ID 0 is unreliable** due to limited pixel coverage.
   Error is 3–5% and variable between photos (not just biased but
   noisy). Use only when ID 1 does not fit the scene.

6. **Measurement repeatability is high**: three taps by the same
   user on the same photo vary by at most 0.4 mm. Residual error
   is systematic, not random.

7. **Autodetection (minAreaRect) is more accurate than manual
   measurement for straight-edged objects.** Manual tapping lands
   ~0.5–1 mm inside the real edge, causing a systematic underestimate
   of ~0.7%. Autodetection finds the actual contour boundary.
   Exception: circular objects (coins, rivets) — autodetection finds
   an arbitrary chord, not the true diameter. Use manual for those.

8. **Photo distance is the dominant remaining error factor.** Closer
   photos give more pixels per mm, reducing the amplification of
   contour detection uncertainty. Far photos approach the 2% limit
   even within the safe zone. Rule: take the photo as close as
   possible while keeping both marker and damage in the central 70%.

9. **Phone orientation affects accuracy.** Best results when the long
   axis of the damage runs vertically in the frame (portrait for
   elongated damage). Validated: vertical-close gives best results
   for both axes simultaneously.

10. **Phase 16 multi-marker threshold (2.0 px) is correct for the
    target use case.** Markers on separate cartulinas (not truly
    coplanar) produce residuals of 12–32 px and correctly fall back
    to single-marker. Markers taped directly to the same flat surface
    are expected to pass the threshold and activate the more robust
    homography. This matches the operational scenario (markers taped
    to an aircraft panel or car door).

### Implications for the roadmap

These findings confirm the 2% accuracy target is achievable within
the operational rules. Per-device lens calibration (checkerboard,
phase 17) would push best-case error below 0.5% and remove the
distance sensitivity, but is deferred.

Expected error budget post phase 16, assuming operational rules
are followed:
- Straight-edged damage, autodetection, close, vertical: ~0.5%.
- Straight-edged damage, manual, close: ~0.7% (systematic).
- Damage centred in the image (≤ 70% zone), any method: ~0.3–1.5%.
- Damage extending to image edges (~90%): 2–3% from lens distortion.
- Severely tilted photos (> 45°): 2–3% from amplified pixel noise.
- Marker ID 0 in any condition: 3–5%, use with caution.
- Circular objects (coins, rivets): manual only; ~1–2% depending on
  how precisely the inspector places the endpoints on the diameter.

## Code conventions

- All code (variable names, function names, strings shown to the user)
  and comments in English.
- Comments explain *why*, not *what*. Avoid restating what the code
  obviously does.
- Function and variable names descriptive and consistent with
  existing style.
- Configuration block pattern: clearly marked sections near the top
  of the script for any value that might need tweaking (auth,
  marker sizes, perspective tolerance, safe zone ratio, etc.) with
  comments explaining how to change them without programming knowledge.
- All edits should be applied as small, reviewable changes (one
  conceptual change per step), not large rewrites.
- When a technical assertion depends on external library behaviour
  (especially OpenCV), mark it explicitly as an assumption and
  propose a small empirical verification before building code on it.
  Do not write "X does Y" with confidence if it has not been verified
  in this specific build and real photos.

## Success criteria

- A user can take a photo with an ArUco marker visible, open it in
  the tool, and measure a damage feature in under 15 seconds with no
  manual calibration.
- Measurement error under 2% when the marker is fully visible,
  flat, and well lit, and both marker and damage are within the
  central 70% of the image. Achieved post phase 6.
- Works offline once installed as a PWA. Achieved in phase 8.
- Total app size under 20 MB (OpenCV.js ~10 MB + heic2any ~1 MB +
  app code, with headroom for future additions).

## Working preferences (mandatory for AI assistants)

- All chat replies in Spanish, always.
- Code and code comments in English.
- I'm not a programmer. Assume no prior coding knowledge unless I
  explicitly say otherwise. Explain concepts briefly the first time
  they appear (e.g. async loading, Promises, WebAssembly memory
  management).
- Prefer fewer, well-explained incremental changes over large
  rewrites I cannot follow.
- When proposing code, explain the reasoning before pasting the code.
- Flag trade-offs and limitations honestly, even if I don't ask.
- Don't add libraries or complexity without justifying why simpler
  options won't work.
- Before any non-trivial edit: read the relevant code directly from
  the app.js attached to the project — it is always the updated
  source of truth. Do NOT ask the user to paste fragments; read them
  from the attached file. Only ask the user for a specific fragment
  if there is genuine ambiguity that the attached file cannot resolve.
- Give the user only what they need to copy-paste into their editor
  (specific fragments, new files), not whole-file replacements.
  Explain at each step what the fragment does and why, so the user
  understands what they are pasting.
- When proposing a library, download URL, or technical decision,
  verify before asserting. Prefer "let me check" over assuming.
- When a technical assertion depends on external library behaviour
  (especially OpenCV quirks, browser API differences), explicitly
  mark it as an assumption. If the cost of being wrong is high
  (e.g. would produce a wrong transform on real photos), propose
  a verification step BEFORE writing the code that depends on it.
- Ask before opening new sub-tasks or expanding scope. If something
  unexpected comes up mid-implementation, stop and confirm with me.
- If a user observation contradicts your reasoning, take it
  seriously and re-evaluate. Real-world data beats theoretical
  expectations. Do not defend a previous answer against real
  evidence; acknowledge the discrepancy and investigate.
- Before asserting facts about what the user can see in an image
  or screenshot they have shared, look carefully at the image.
  Do not describe image contents based on what "should" be there
  according to theory; describe what is actually visible.

## Source of truth for AI assistants

PROJECT_CONTEXT.md attached to the Claude project is the canonical
version. When the user uploads a PROJECT_CONTEXT.md directly in
the chat, that version takes priority over the project file for
that session — read it with the view tool from
/mnt/user-data/uploads/PROJECT_CONTEXT.md, not from /mnt/project/.
When asked to verify the document, always read every line using
view with explicit line ranges — never rely on memory of previous
reads in the same chat.

### Code quality rules (added after phase 11 incidents)

These rules are mandatory and non-negotiable. They exist because
several bugs in phase 11 were caused by proposing code without
verifying it against the actual file first.

- **Before proposing any code fragment that modifies an existing
  function, read that function from the attached app.js using
  the view tool with a line range.** Do not rely on memory of
  earlier chat content or on what the function "should" look like.
  The attached file is always the source of truth.

- **After composing any code fragment, mentally verify these four
  things before presenting it to the user:**
  1. Brace balance: every `{` has a matching `}` within the same
     scope. The fragment must not introduce an extra opening or
     closing brace that shifts the balance of the surrounding code.
  2. No duplicate blocks: if a block already exists in the file
     (e.g. a comment block, a forEach, a function body), do not
     add it a second time. Search the file for the key identifier
     before inserting.
  3. No use-before-declaration of `const` or `let`: if the fragment
     uses a variable declared with `const` or `let` elsewhere in
     `initApp()`, verify that the declaration appears before the
     first use in document order. `const` and `let` do not hoist.
  4. Interaction side-effects: if the fragment modifies an event
     handler (onMouseDown, onTouchStart, etc.), trace the full
     execution path mentally — check that every flag set in one
     handler (e.g. `state.mouseDown`) is correctly read or reset
     in the handlers that follow.

- **When a bug report contradicts the expected behaviour of a code
  fragment that was just delivered, do not defend the fragment.
  Read the actual file, find the real problem, and fix it.** The
  first step is always `grep` or `view` on the uploaded file, not
  reasoning from memory.

- **For any change that touches onTouchStart / onTouchMove /
  onTouchEnd / onMouseDown / onMouseMove / onMouseUp: read all six
  functions in full before proposing a change to any one of them.**
  These functions share state flags (mouseDown, isPanning,
  isPinching, draggingDim, currentStroke) and a change to one
  always has potential side effects on the others.

- **Never generate a whole-file replacement to fix a bug.** Always
  use the minimum surgical change: identify the exact lines that
  are wrong, show only those lines and their immediate context, and
  explain why the change is correct before presenting it.

- **When a feature is not working and the cause is not immediately
  visible in the static code, do NOT deliver more code. Instead,
  add temporary `console.log` statements at the key points of the
  broken flow, deliver that diagnostic version, and ask the user
  to open DevTools (F12 → Console), reproduce the problem, and
  paste the console output. Only once the logs confirm exactly
  where the flow breaks should new corrective code be written.**
  This rule exists because phase 11 had multiple rounds of blind
  fixes that introduced new bugs without diagnosing the real cause.

## Future ideas (not in roadmap)

These are ideas captured to avoid losing them. They are **not
committed work** and will only enter the roadmap when an explicit
decision is taken. They are organised by ambition, from
"realistic incremental improvement" to "speculative". Items the
project owner has explicitly flagged as more interesting are
marked with ★.

**Domain note:** all items below are described in their aerospace
context (the target application). For personal portfolio and
learning purposes, the equivalent domain is vehicle bodywork — same
pipeline, same techniques, publicly available data. Where items
reference aircraft-specific workflows (SAP, tail number, zone
coding), those are aerospace-only; the vehicle equivalent would be
a damage report per vehicle registration number.

### Workflow and traceability

- **★ Structured inspection session as a first-class entity.**
  Today each photo is independent. An "inspection" would become
  a container: tail number / vehicle registration, date, inspector,
  list of documented damages, each with its photos and measurements.
  The session ends by generating a signed PDF technical report.
  Aerospace: aligns with the Microsoft 365 ecosystem in use at
  the organisation. Vehicle equivalent: damage report at rental
  car return or workshop intake.
- **Damage type catalogue integrated with the existing classifier.**
  Each measured damage would be classified (Dent, Blend-out, Rivet
  Pull-in / equivalent deformation types) using the logic of the
  separate classification tool already developed. The two tools
  would converge into a single deliverable: "measure + classify in
  one flow".
- **Zone coding.** Before taking the photo, the inspector tags the
  zone ("panel L-23, frame 14-15" for aircraft; "front left door"
  for vehicles). The system stores it as metadata and allows
  searching historical damages by zone.
- **Integration with corporate maintenance systems** (e.g. SAP for
  aerospace; fleet management software for automotive). Saved
  damages push automatically into the existing ticketing or
  planning system. Aerospace-only feature; requires IT access.

### Measurement core improvements

- **★ Automatic damage detection (without AI).** ✅ Completed in
  phase 15. Documented here for narrative context.
- **Temporal comparison across inspections.** If the same zone is
  inspected periodically, the app could align successive photos
  (the marker provides the alignment anchor) and highlight new
  defects or growth of existing ones.
- **Web Workers for OpenCV processing.** Today the main browser
  thread briefly freezes while OpenCV processes a heavy photo.
  Moving detection and rectification to a Web Worker would keep
  the UI responsive.

### Capture and quality

- **★ Real-time capture assistant.** Already in roadmap as phase 20.
  Documented here for narrative context.
- **Oblique-lighting documentation.** Not a software item: a torch
  held at grazing angle reveals dents invisible under frontal light.
  Worth standardising as part of the inspection procedure for both
  aerospace and vehicle contexts.

### Speculative

- **Trained AI model on a labelled damage dataset.**
  With hundreds of pre-classified real damages, a custom model
  could classify automatically without human input. Only realistic
  once a labelled dataset exists. For personal learning: built on
  vehicle damage data (see Block 4). For corporate use: requires
  Accenture to decide to build and label an internal aerospace
  dataset.
- **Augmented reality for location.** Pan the phone over the
  surface and see historical damages overlaid. Visually impressive
  but practical ROI is debatable. Could leverage LiDAR on modern
  iPhones.
- **Automatic generation of technical drawings.** Convert the
  measured dimensions into the stylised drawing format used in
  official reports. Aerospace-specific format; vehicle equivalent
  would be a standardised damage diagram per insurance or fleet
  management standards.
- **★ Domain-aware automatic measurement proposals (phase 19
  motivation).** Once a labelled damage dataset exists, a trained
  model (YOLOv8 → ONNX → browser) could learn domain-specific
  measurement conventions automatically. Example in aerospace: when
  a dent is detected near rivets, the model proposes the distance
  from the damage edge to the nearest rivet centre. No backend
  required: all inference runs client-side via ONNX Runtime Web.

### Suggested order going forward (post phase 16)

1. Phase 17 — Per-device lens calibration (checkerboard).
   Required before stereometry for acceptable depth accuracy.
2. Phase 18 — Stereometry (light 3D, two photos).
   Only worthwhile after phase 17 reduces intrinsic camera error.
3. Phase 19 — ONNX Runtime Web (vehicle damage model in browser).
   Depends on vehicle dataset completed in parallel.
4. Phase 20 — Real-time capture assistant (last, most complex).

Personal portfolio and learning track (in parallel, not blocking):
- **Dataset first step: check open sources before taking photos.**
  Roboflow Universe and Kaggle have open-licence car damage datasets
  downloadable via API. Spend an afternoon testing this approach
  before committing weeks to manual photo collection.
- Label with Roboflow (free tier). Classes: dent, scratch,
  paint_damage, bumper_damage. Variety over quantity.
- Learn Python + opencv-python to experiment with the pipeline before
  porting anything to JavaScript (see Block 4, item 15).
- Train a YOLOv8 nano model on the vehicle dataset, export to ONNX,
  integrate into the web app via ONNX Runtime Web (items 16–18).
  No backend required: all inference runs in the browser.
- Once the vehicle model is working, the pitch to any industrial
  client (aerospace or otherwise) is: "same pipeline, same accuracy,
  your data replaces the training set."

**Solve the simple problem well before adding complexity.**

## Detailed catalogue (consolidated, May 2026)

Full enumeration of all future ideas raised across project chats,
grouped for traceability. Some entries duplicate items already in
"Future ideas (not in roadmap)" above; that is intentional — this
catalogue is the consolidated index, the section above is the
narrative discussion. Numbering is for cross-reference only and
does not imply priority.

**Domain note for this catalogue:** all items are described in their
target (aerospace) context. Where personal/portfolio work is involved,
the practical domain is vehicle bodywork damage as the non-confidential
equivalent. This is noted explicitly only where the distinction matters.

### Block 1 — Core measurement improvements

1. **Validate printed ArUco markers in the field.** ✅ Completed in
   phase 2 (cross-reference: see "Experimental findings" above).
2. **Multi-marker support for curved or large surfaces.** ✅ Completed
   in phase 13 (detection and state storage) and phase 16
   (multi-marker homography via findHomography).
3. **Assisted automatic damage detection.** ✅ Completed in phase 15
   (Canny + minAreaRect). ONNX-based detection planned as phase 19.
4. **Temporal comparison across inspections.** Not yet in roadmap.
5. **Per-device lens-distortion calibration.** In roadmap as phase 17.
   One-time checkerboard calibration per phone. Best-case error drops
   from ~0.5% to ~0.05%.
6. **Stereometry: light 3D from two photos.** In roadmap as phase 18.
   Deferred after phase 17 (lens calibration).
7. **Measurement reliability heatmap.** ✅ Completed in phase 12.
8. **Live camera mode with continuous ArUco detection.** In roadmap
   as phase 20.

### Block 2 — Workflow and traceability

9. **Structured inspection session as first-class entity.**
10. **Zone coding.**
11. **Integration with corporate maintenance / fleet system.**
12. **Damage type catalogue + convergence with existing classifier.**

### Block 3 — Capture and image quality

13. **Real-time capture assistant.** In roadmap as phase 20.
14. **Oblique lighting to reveal relief.** Operational rule, not
    software. Belongs in inspector guidelines for both domains.

### Block 4 — Applied AI and custom-trained model

15. **Learn Python oriented to computer vision.**
16. **Build a custom vehicle damage dataset.** 200–500 labelled
    images. No confidentiality constraints. Classes: dent, scratch,
    paint_damage, bumper_damage. Try open sources first (Roboflow
    Universe, Kaggle). ArUco markers NOT required in training photos.
17. **Train a small model with YOLOv8 or similar.** Export to ONNX.
18. **Integrate the trained model into the web app via ONNX Runtime
    Web.** In roadmap as phase 19.
19. **Aerospace AI model for automatic classification (corporate
    decision).** Depends entirely on corporate decisions.

### Block 5 — Augmented reality and technical drawings

20. **Augmented reality for historical damage location.**
21. **Automatic technical drawing generation.**

### Block 6 — Certifications and career

22. **AZ-900 (Azure Fundamentals) certification.**
23. **AZ-204 (Developer) or AI-102 (AI Engineer) after AZ-900.**

### Block 7 — Distribution and public profile

24. **Professional README of the repository.** ✅ Completed in
    phase 8, updated in phase 16.
25. **Public learning artefacts.** Document the construction process
    publicly (LinkedIn or technical blog). Return materialises at
    12–18 months. Cost: 1–2 hours/week.

## How to start the next session (phase 17 — per-device lens calibration)

When opening a new chat:

1. Confirm that the latest app.js, index.html and this
   PROJECT_CONTEXT.md are present in project files.
2. Read PROJECT_CONTEXT.md and app.js before doing anything else.
3. When code inspection is needed, read specific fragments by line
   range — do NOT ask the user to paste fragments.
4. Do not start writing code until the plan has been approved in
   plain language.
5. Deliver changes as copy-pasteable fragments for VS Code, not as
   whole-file replacements. Explain each fragment before presenting it.

Phase 17 covers per-device lens distortion calibration:

  One-time calibration per phone model using a printed checkerboard
  pattern. The phone takes ~15 photos of the checkerboard at different
  angles; cv.calibrateCamera computes the radial distortion coefficients;
  cv.undistort removes them from subsequent photos. This pushes best-case
  error from ~0.5% to ~0.05% and reduces distance sensitivity.
  Required before phase 18 (stereometry) for acceptable depth accuracy.

  Active branch to open: feature/phase-17-lens-calibration
  Suggested commit message: `phase 17 complete: per-device lens calibration`
  Tag after merge to main: v1.3-lens-calibration