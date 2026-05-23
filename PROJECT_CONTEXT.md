# Damage Measurement Tool — Project Context

## Goal

Build a web-based tool to measure physical damage (dents, scratches,
cracks) from photographs, with millimetre-level accuracy, for internal
professional use. The tool must run on both mobile and desktop from a
single codebase.

## Current state

A working single-file HTML/CSS/JavaScript app: `index.html`.
Hosted on GitHub (private repo, set to private in phase 9).
Deployed on Azure Static Web Apps (phase 9).
Installable as a PWA (Progressive Web App) on any device.

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
  side) wins, since it yields the most precise scale.
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
- "View original" button (⊙ Original): visible in measure-idle phase
  when a rectified image is loaded. While held, shows the un-rectified
  photo with no overlays at the current zoom/pan, for before/after
  comparison. Releases back to the rectified view on pointer-up or
  pointer-leave.
- Safe zone overlay: a dashed cyan rectangle covering the central 70%
  of the image (SAFE_ZONE_RATIO = 0.70), shown from the moment a photo
  is loaded until the first calibration point or dimension is placed.
  Guides the inspector to keep both the marker and the damage within
  the low-distortion central region. Disappears permanently after first
  use and does not appear on exported JPEGs.
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
- Multiple named dimensions per photo: add, rename, hide, delete.
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

- Phase 11 — Free annotations: freehand drawing and text labels
  directly on the photo. Two tools: a freehand pen (variable colour
  and stroke width) and a text stamp (tap to place, type the label).
  Both are stored as overlay data (not baked into the photo until
  export). Controls live inside the left-side Tools & Guide panel.
  Annotations are cleared when a new photo is loaded.
- Phase 12 — Measurement reliability heatmap: hold-to-show colour
  gradient overlay (green at centre → yellow → red at edges) based
  on known error model (marker position, safe zone, lens distortion).
  Same interaction pattern as the existing "⊙ Original" button.
- Phase 13 — Multi-marker support: detect and display all known
  markers present in the photo, use the largest as primary scale,
  store all corners in state as groundwork for future geometry.
- Phase 14 — Stereometry: light 3D depth estimation from two photos
  of the same damage (both with visible marker), aligned via marker
  anchor, depth by triangulation. Two photos required, third optional.
- Phase 15 — Assisted automatic damage detection (classical OpenCV,
  no AI): Canny edge detection + contour analysis on the rectified
  image to propose measurement endpoints. Inspector confirms or adjusts.

A separate second portfolio project (AI pipeline on public
aeronautical data) will be planned independently when the tool
reaches maturity. It is not a phase of this project.

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
   GitHub Pages left active as fallback; AUTH_ENABLED remains true in
   index.html as the access control mechanism for shared users.
   Entra ID corporate accounts (Accenture tenant) blocked by corporate
   IT policy — not usable without admin approval from Accenture IT.
10. ✅ UX overhaul: collapsible left-side instruction panel (Tools &
    Guide, Accenture purple tab), visual refresh, secondary buttons
    moved into panel, engineering-style moveable dimension lines
    (parallel to measurement, perpendicular extension lines,
    arrowheads, draggable offset). DIM_OFFSET_DEFAULT = -40.
11. ✅ Free annotations: freehand pen + text stamps on photo.
    Controls in Tools & Guide panel.
12. ✅ Measurement reliability heatmap: hold-to-show radial gradient overlay
    (green at centre → yellow at 70% boundary → red at corners). Same
    interaction pattern as ⊙ Original. Never appears on exported JPEGs.
    Button: ◎ Accuracy lens map, visible in measure-idle alongside
    ⊙ View original.

    Also in this phase:
    - Safe zone cyan rectangle removed (SAFE_ZONE_RATIO = 0.70 kept as
      constant for heatmap calculation).
    - Right-side dimensions panel removed entirely.
    - Dimension edit/delete now via brief tap on the dimension line:
      opens modal with rename + delete, same interaction pattern as
      text stamps. Long press / drag still moves the dimension line.
    - Two pre-existing bugs fixed: pan (missing const dx in onMouseMove)
      and dimension drag (missing draggingDim block in onMouseMove).
13. ⏸ Multi-marker support: detect and display all known markers,
    use largest as primary scale.
14. ⏸ Stereometry: light 3D depth estimation from two photos.
15. ⏸ Assisted damage detection: Canny + contours, no AI.

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

- **Tag v1.0-core**: create this Git tag at the close of phase 13
  (multi-marker support). At that point the measurement core is
  complete and validated. Command: `git tag v1.0-core` + push.
  This marks a permanent stable reference to return to at any time.

- **JavaScript separation**: before starting phase 14 or 15 (when
  the file becomes hard to navigate), move all `<script>` content
  to a separate `app.js` file. Add `app.js` to `PRE_CACHE_URLS` in
  sw.js. No behaviour change, just maintainability.

- **Future branches after v1.0-core**:
    - `feature/detection-no-ai` — Canny + contours assisted
      detection (phase 15), no external dependencies.
    - `feature/detection-ai` — Claude API or Azure OpenAI
      integration for damage classification. Requires a small
      backend or Azure Function to proxy API calls (the API key
      must never be exposed in client-side code). Cost: cents per
      photo analysed at low inspector volume.
  Both branches fork from `main` after the tag, so the clean
  v1.0 core is always recoverable.

## Tech stack and constraints

- Vanilla HTML + CSS + JavaScript. No frameworks (React, Vue, etc.).
- Single-file structure for app logic (`index.html`). PWA adds two
  small files: `manifest.json` and `sw.js`.
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
- No backend. All processing client-side.

## Repository structure

    repo-root/
    ├── index.html              (main app file)
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

## Measurement assumptions and physical limits

The measurement pipeline (ArUco scale calibration + perspective
correction) is geometric, not optical. It corrects how pixels are
arranged, not how they are lit or coloured. Honest documentation of
the assumptions underneath:

### What the system measures correctly
- Lengths and contours of features lying on the same plane as the
  ArUco marker.
- Damage on flat or slightly curved surfaces (fuselage panels, wing
  skin) where the local curvature around the marker and the damage
  is negligible (< 1° within the marker-to-damage radius).

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
- Use the phone in whichever orientation (portrait / landscape) best
  fits the damage shape. No significant accuracy difference between
  the two orientations was found experimentally when framing is
  otherwise equivalent.
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

### Implications for the roadmap

These findings justify prioritising the safe zone overlay (done, in
phase 6) and confirm the 2% accuracy target is achievable within the
operational rules. Per-device lens calibration (checkerboard) would
push best-case error below 0.5% but is deferred to future phases.

Expected error budget post phase 6, assuming the operational rules
are followed:
- Damage centred in the image (≤ 70% zone): ~0.3%.
- Damage extending to image edges (~90%): 2–3% from lens distortion.
- Severely tilted photos (> 45°): 2–3% from amplified pixel noise.
- Marker ID 0 in any condition: 3–5%, use with caution.

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
  the index.html attached to the project — it is always the updated
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

### Code quality rules (added after phase 11 incidents)

These rules are mandatory and non-negotiable. They exist because
several bugs in phase 11 were caused by proposing code without
verifying it against the actual file first.

- **Before proposing any code fragment that modifies an existing
  function, read that function from the attached index.html using
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

### Workflow and traceability

- **★ Structured inspection session as a first-class entity.**
  Today each photo is independent. An "inspection" would become
  a container: aircraft tail number, date, inspector, list of
  documented damages, each with its photos and measurements. The
  session ends by generating a signed PDF technical report. This
  aligns naturally with the Microsoft 365 ecosystem already in use
  at the organisation.
- **Damage type catalogue integrated with the existing classifier.**
  Each measured damage would be classified (Dent, Blend-out, Rivet
  Pull-in, Out of Contour) using the logic of the separate
  classification tool already developed. The two tools would
  converge into a single deliverable: "measure + classify in one
  flow", removing the need for inspectors to use two apps.
- **Zone coding on the aircraft.** Before taking the photo, the
  inspector tags "panel L-23, frame 14-15". The system stores it
  and allows searching historical damages by zone.
- **Integration with corporate maintenance systems** (e.g. SAP).
  Saved damages push automatically into the existing ticketing or
  maintenance-planning system, removing manual data re-entry.

### Measurement core improvements

- **★ Automatic damage detection (without AI).** Instead of the
  inspector marking the two endpoints of a damage manually, classic
  computer vision (edge detection, contour analysis on the
  perspective-corrected image) could propose the measurement
  automatically. The inspector then confirms or adjusts. Works well
  for high-contrast defects (scratches, dents with shadow). No
  training data required.
- **Multi-marker support for curved surfaces.** Today a single
  marker rectifies a single plane. Placing one marker at each
  corner of a curved fuselage panel would allow piecewise
  reconstruction of the real geometry. Useful for large panels
  where a single plane does not hold.
- **Temporal comparison across inspections.** If the same zone is
  inspected every X weeks, the app could align successive photos
  (the marker provides the alignment anchor) and highlight new
  defects or growth of existing ones.
- **Light 3D via stereometry.** Two photos of the same damage from
  slightly different angles, both with markers, would allow
  estimating depth — the dimension the current pipeline does not
  measure. Would extend the tool from "surface extent" to
  "dent volume".
- **Per-device lens-distortion calibration.** If an inspector
  always uses the same phone, a one-time calibration of that
  phone's lens with a checkerboard pattern would remove the
  residual radial distortion that survives perspective correction.
  Would push best-case error below 0.5%.
- **Web Workers for OpenCV processing.** Today the main browser
  thread briefly freezes while OpenCV processes a heavy photo. Moving
  detection and rectification to a Web Worker would keep the UI
  responsive during processing. Most relevant before phase 15
  (Canny + contours will be heavier than ArUco detection alone).
  No visible change for the user beyond smoother loading.

### Capture and quality

- **★ Real-time capture assistant.** When the inspector opens the
  camera, the app overlays guidance: "marker too far from centre",
  "you are too tilted, straighten up", "too dark, turn on the
  light". Reduces drastically the number of bad photos that reach
  the measurement step. Requires moving part of the OpenCV
  pipeline to the live video stream rather than only the final
  still photo.
- **Oblique-lighting documentation.** Not a software item, but
  worth noting: a torch held at grazing angle reveals dents
  invisible under frontal light. Worth standardising as part of
  the inspection procedure.

### Speculative (only worth revisiting once the basic flow is mature)

- **Trained AI model on the organisation's own damage dataset.**
  With hundreds or thousands of pre-classified real damages, a
  custom model could classify automatically without human input.
  Only realistic once a labelled dataset exists; not something
  to start from scratch.
- **Augmented reality for location.** Move the phone over the
  aircraft and see historical damages of that zone overlaid.
  Could leverage LiDAR on modern iPhones. Visually impressive but
  the practical inspection ROI is debatable.
- **Automatic generation of technical drawings.** Convert the
  measured dimensions into the stylised drawing format used in
  official reports, with dimensions formatted per the
  organisation's standard.

### Suggested medium-term order (after phase 8)

If pursued, a reasonable order of attack — focused on highest
practical value before complexity:

1. Phase 9 (Azure + Entra ID) — once PWA is stable.
2. Structured inspection session + PDF report — turns the tool
   from "measurer" into "documentation system".
3. Damage type catalogue integration — merges this app with the
   existing classification tool. From two apps into one.
4. Real-time capture assistant.

Visual or AI-flavoured items are deliberately deferred until the
basic flow is polished and real users are asking for them.
**Solve the simple problem well before adding complexity.**

## Detailed catalogue (consolidated, May 2026)

Full enumeration of all future ideas raised across project chats,
grouped for traceability. Some entries duplicate items already in
"Future ideas (not in roadmap)" above; that is intentional — this
catalogue is the consolidated index, the section above is the
narrative discussion. Numbering is for cross-reference only and
does not imply priority.

### Block 1 — Core measurement improvements

1. **Validate printed ArUco markers in the field.** ✅ Completed in
   phase 8 (cross-reference: see "Experimental findings" above).
   Listed here only for completeness of the catalogue.
2. **Multi-marker support for curved or large surfaces.** A single
   marker assumes a single plane. With two or more markers placed
   across the piece, the geometry can be reconstructed piecewise.
   Useful for fuselage panels with curvature or large damage areas
   where a single marker leaves too much margin. Mathematically
   non-trivial (interpolation between planes), but feasible and
   pedagogically rich.
3. **Assisted automatic damage detection.** Today the inspector
   manually places the two endpoints of each dimension. The app
   could propose them and the inspector only confirms. Three paths:
   (a) classical OpenCV (Canny edge detection, adaptive thresholding,
   contour analysis) for high-contrast defects, no AI, zero cost,
   local processing; (b) a custom-trained model (see Block 4);
   (c) Azure AI Vision / Custom Vision for the corporate version,
   no data leaving Microsoft.
4. **Temporal comparison across inspections.** If the same zone is
   inspected periodically, the app could align successive photos
   (using the ArUco marker as a stable anchor) and highlight new
   defects or growth of existing ones. Valuable for scheduled
   maintenance workflows.
5. **Per-device lens-distortion calibration.** Today perspective
   is corrected but residual radial distortion remains. A one-time
   chequerboard calibration with `cv.calibrateCamera` + `cv.undistort`
   per phone model removes it. ~15-minute setup per phone, reused
   for every photo afterwards. Best-case error drops from 1-2 % to
   0.3-0.5 %. Best effort/accuracy ratio of any pending measurement
   improvement.
6. **Stereometry: light 3D from two photos.** Two photos of the same
   damage from slightly different angles, both with visible markers,
   allow estimating depth by triangulation — the dimension the
   current pipeline does not measure. Turns the tool from "surface
   extent" into "dent volume". Software-only, no extra hardware.
7. **Measurement reliability heatmap (replaces LiDAR depth item).**
   A colour-gradient overlay (green at centre → yellow → red at
   edges) visualising where measurements are most reliable based
   on known error sources: distance from marker, safe zone boundary,
   and lens distortion model documented in "Experimental findings".
   Shown only while the user holds a dedicated button — same
   interaction pattern as the existing "⊙ Original" button — so
   it never clutters the working image. Released immediately on
   pointer-up or pointer-leave. No external data or hardware
   required: the overlay is computed from information already
   present in state (marker position, image dimensions,
   SAFE_ZONE_RATIO, mmPerPixel). Visually effective for presenting
   the tool and for training inspectors on correct framing.
   Candidate for phase 14 or later once phases 10–13 are complete.
8. **Live camera mode with continuous ArUco detection.** Real-time
   video stream where ArUco is detected on every frame and scale
   is recalibrated continuously. The inspector can frame and see
   live measurements before capturing. Large conceptual phase; the
   technical learning (video stream handling, per-frame processing,
   sync between video and canvas) is substantial.

### Block 2 — Workflow and traceability

9. **Structured inspection session as first-class entity.** Today
   each photo is independent. An "inspection" would become a
   container: aircraft tail number, date, inspector, list of
   documented damages, each with its photos and measurements.
   Session ends generating a signed technical PDF report.
   Natural fit with the corporate Microsoft 365 ecosystem.
   Converts the tool from "measurer" into "inspection documentation
   system".
10. **Aircraft zone coding.** Before each photo, the inspector tags
    the zone ("panel L-23, frame 14-15"). The system stores it as
    metadata and allows searching historical damages by zone. Small
    addition, large value for accumulated information.
11. **Integration with SAP or corporate maintenance system.** When
    the app saves a damage measurement, the data is automatically
    pushed to the corporate ticketing or maintenance-planning system.
    Requires IT conversations and internal API access. Converts the
    tool from "inspector aid" into "official process component".
12. **Damage type catalogue + convergence with existing classifier.**
    Each damage classified (Dent, Blend-out, Rivet Pull-in, Out of
    Contour) using the logic of the existing classification tool.
    With automatic measurement + classification combined, the full
    information piece the official system needs is captured in one
    flow. The two tools would converge into one — potentially
    multiplying the value of each in isolation.

### Block 3 — Capture and image quality

13. **Real-time capture assistant.** When the inspector opens the
    camera, the app gives live feedback: "marker outside safe zone",
    "you are tilted, straighten up", "too dark, turn on the light".
    Requires moving part of the OpenCV pipeline to the live video
    stream (related to item 8). Probably the highest practical-impact
    UX improvement for real users. Drastically reduces the number of
    unusable photos reaching the measurement step.
14. **Oblique lighting to reveal relief.** Not a software item, but
    worth documenting: a lateral torch at grazing angle makes dents
    invisible under frontal light appear as clear shadows. Combined
    with the existing perspective correction, a powerful combo.
    Belongs in the operational rules / inspector guidelines.

### Block 4 — Applied AI and custom-trained model

15. **Learn Python oriented to computer vision.** Not "Python in
    abstract" but with specific focus:
    - `numpy` and `opencv-python` (the Python port of OpenCV, far
      more powerful than the JS build).
    - `Pillow` for image handling.
    - Jupyter notebooks for visual step-by-step experimentation.
    Realistic timeline: 4–6 weeks for fluency at 4–5 hours/week.
    Foundation for everything else in this block.
16. **Build a custom damage dataset.** Foundation for any training.
    No public aerospace-damage dataset is usable. Steps: collect
    200–500 real damage photos (variety > quantity), label them
    with `LabelImg` or `Roboflow` (both free). **Confidentiality
    constraint:** real aircraft damage photos are property of
    Accenture and its clients; they CANNOT be used for personal
    training. Equivalent damage in non-corporate contexts (car
    bodywork, appliances, anything visually and geometrically
    analogous) must be used instead. The technical skill is fully
    transferable when Accenture decides to train its own model with
    corporate data.
17. **Train a small model with YOLOv8 or similar.** With dataset
    prepared, train an object-detection model. `Ultralytics YOLOv8`
    is the most accessible — a few lines of Python. Train on local
    GPU if available, or free Google Colab GPU. Trained model size:
    5–50 MB. Export to **ONNX** format because **ONNX Runtime Web**
    runs ONNX models directly in the browser via JavaScript — the
    custom model can therefore be integrated into the existing web
    app without a server, without sending photos anywhere. Fully
    local processing, faithful to the project's data-handling stance.
18. **Integrate the trained model into the web app.** Port the
    working Python model to the browser via ONNX Runtime Web. Closes
    the learning loop: Python, applied AI, custom training, and
    application back to the existing project. Probably the richest
    single technical achievement possible from this learning track.
19. **Corporate AI model for automatic classification.** Ambitious
    extension of items 17–18: if Accenture accumulates hundreds or
    thousands of pre-classified real damages, a custom model could
    classify automatically ("this is a Dent of class 2") without
    human input. Only viable when a sizeable labelled dataset
    exists. Depends on corporate decisions, not personal ones.

### Block 5 — Augmented reality and technical drawings

20. **Augmented reality for historical damage location.** Pan the
    phone over the aircraft and see historical damages of the zone
    overlaid. Works best with LiDAR-equipped iPhones. Visually
    impressive but the practical inspection ROI is debatable: the
    inspector likely already knows where the damages are or has
    faster ways to look them up.
21. **Automatic technical drawing generation.** From the captured
    dimensions, generate the stylised technical drawing used in
    official reports, with dimensions formatted per Accenture's
    or the client's standard. Converts the tool from "documenter"
    into "formal deliverable producer". Very valuable when the
    organisation has official templates to match.

### Block 6 — Certifications and career

22. **AZ-900 (Azure Fundamentals) certification.** Weekend study
    over 1–2 months. Exam ~50 €, typically reimbursed by Accenture.
    Provides vocabulary, panoramic understanding, and official
    recognition. Highest short-term CV return of any single
    investment.
23. **AZ-204 (Developer) or AI-102 (AI Engineer) after AZ-900.**
    Intermediate-level certification. Better fit than AZ-104
    (infrastructure-oriented). Positions the holder as
    "developer / AI engineer in Azure", not as systems administrator.

### Block 7 — Distribution and public profile

24. **Professional README of the repository.** ✅ Completed in
    phase 8 (cross-reference: see README.md in the repository).
    Listed here only for completeness of the catalogue.
25. **Public learning artefacts.** Document the construction process
    publicly (LinkedIn or a technical blog) as a career identity
    asset. For this specific profile (self-taught, 38, applied AI
    + computer vision + corporate environments), the combination
    is rare and valuable. Return materialises at 12–18 months.
    Cost: 1–2 hours/week.

## How to start the next session (phase 11 — free annotations)

When opening a new chat:

1. Confirm that the latest index.html and this PROJECT_CONTEXT.md
   are present in project files (uploaded by the user after the
   previous chat).
2. The assistant should read this PROJECT_CONTEXT.md and index.html
   first.
3. When code inspection is needed, read specific fragments by line
   range — do NOT ask the user to paste fragments and do NOT rely
   on memory of earlier chat content.
4. The assistant should not start writing code until the plan has
   been approved in plain language.
5. Deliver changes as copy-pasteable fragments for VS Code, not as
   whole-file replacements. Explain each fragment before presenting
   it.

Phase 11 covers free annotations directly on the photo:

  1. Freehand pen tool: the user draws strokes directly on the
     photo. Configurable colour (at minimum red, yellow, white,
     black) and stroke width (thin / medium / thick). Strokes are
     stored as an array of paths in state, not baked into the photo
     until export.
  2. Text stamp tool: the user taps a point on the photo and types
     a short label (e.g. "dent class 2", "revisar"). The label
     appears at that point with the same background box style as
     the dimension labels.
  3. Undo: full history (multiple undo steps), not just one step.
  4. Clear all annotations button.
  5. All controls live inside the Tools & Guide left panel, not in
     the main toolbar.
  6. Annotations are cleared automatically when a new photo is
     loaded.
  7. On export (Save / Share), annotations are baked into the JPEG
     together with the dimension overlays.
  8. Text stamps are editable in-place with a tap/click directly on
     the canvas, like editing text in PowerPoint.

Before proposing anything, read the current left panel HTML
structure and the panel-actions buttons block to understand what
exists today. Read also the exportImage() function to understand
how overlays are currently baked into the exported JPEG.