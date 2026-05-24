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
aeronautical data — NTSB/EASA reports) will be planned independently
when the tool reaches maturity. It is not a phase of this project.

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

### Closing phase 13 — mandatory steps before continuing

When phase 13 (multi-marker support) is complete, execute these
steps in order before touching anything else. They guarantee that
a clean recovery point always exists.

**Step 1 — Final commit on main**
Make sure index.html with all phase 13 changes is saved and pushed.
In VS Code: Source Control → Stage All → Commit → Push.
Suggested commit message: `phase 13 complete: multi-marker support`.

**Step 2 — Create tag v1.0-core**
In the VS Code terminal (Ctrl+ñ on Windows), copy and paste this
in one go:

git tag v1.0-core && git push origin v1.0-core

This tag is permanent. It marks the stable version of the
measurement core. It can be recovered at any time with
`git checkout v1.0-core`. This is the version shown to managers
and potential clients.

**Step 3 — Extract JavaScript to app.js**
Before opening any branch for phase 14 or 15, move all content
inside the <script>...</script> block in index.html to a new file
called app.js in the repository root.
In index.html, replace the <script> block with:
<script src="app.js"></script>
Add './app.js' to the PRE_CACHE_URLS list in sw.js so the service
worker caches it. No behaviour change — maintainability only.
Suggested commit message: `refactor: extract app.js`.

**Step 4 — Open the branch for the next phase**
Only after the tag and app.js extraction, copy and paste this
in one go:

git checkout -b feature/phase-14-stereometry && git push origin feature/phase-14-stereometry

### Planned branches after v1.0-core

- feature/phase-14-stereometry — phase 14, light 3D depth
  estimation from two photos with marker.
- feature/phase-15-detection-no-ai — phase 15, assisted damage
  detection with Canny + contours, no AI, no external dependencies.
- feature/phase-16-detection-ai — ONNX Runtime Web integration
  for the model trained on vehicle bodywork data (see Block 4,
  items 17–18). All inference runs client-side, no backend needed.

All branches fork from main after the v1.0-core tag, so the clean
core is always recoverable.

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
- No backend. All processing client-side. This constraint is
  fundamental and applies to all planned phases including AI model
  inference (via ONNX Runtime Web) — the API key is never exposed
  in client-side code.

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

- **★ Automatic damage detection (without AI).** Instead of the
  inspector marking the two endpoints of a damage manually, classic
  computer vision (edge detection, contour analysis on the
  perspective-corrected image) could propose the measurement
  automatically. The inspector then confirms or adjusts. Works well
  for high-contrast defects (scratches, dents with shadow). No
  training data required. Applicable to both aerospace and vehicle
  domains identically.
- **Multi-marker support for curved surfaces.** Today a single
  marker rectifies a single plane. Placing one marker at each
  corner of a curved panel would allow piecewise reconstruction
  of the real geometry. Useful for large panels where a single
  plane does not hold. Applicable to both fuselage panels and
  car bonnets or doors.
- **Temporal comparison across inspections.** If the same zone is
  inspected periodically, the app could align successive photos
  (the marker provides the alignment anchor) and highlight new
  defects or growth of existing ones.
- **Light 3D via stereometry.** Two photos of the same damage from
  slightly different angles, both with markers, would allow
  estimating depth — the dimension the current pipeline does not
  measure. Would extend the tool from "surface extent" to
  "dent volume". Applicable to both domains identically.
- **Per-device lens-distortion calibration.** A one-time
  checkerboard calibration per phone model removes residual radial
  distortion. Best-case error drops from 1–2% to 0.3–0.5%.
- **Web Workers for OpenCV processing.** Today the main browser
  thread briefly freezes while OpenCV processes a heavy photo.
  Moving detection and rectification to a Web Worker would keep
  the UI responsive. Most relevant before phase 15.

### Capture and quality

- **★ Real-time capture assistant.** When the inspector opens the
  camera, the app overlays guidance: "marker too far from centre",
  "you are too tilted, straighten up", "too dark, turn on the
  light". Reduces drastically the number of bad photos that reach
  the measurement step. Requires moving part of the OpenCV pipeline
  to the live video stream.
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

### Suggested order going forward (post phase 12)

The immediate priority is completing the measurement core:

1. Phase 13 — Multi-marker support (current focus). At close:
   commit final index.html to main, create tag v1.0-core, then
   open feature branches before continuing.
2. Separate app.js from index.html before starting phase 14 or 15.
3. Phase 14 — Stereometry (light 3D, two photos).
4. Phase 15 — Assisted damage detection (Canny + contours, no AI).

Personal portfolio and learning track (in parallel, not blocking):
- Collect 200–500 photos of vehicle bodywork damage in public spaces
  (parking lots, streets). No confidentiality constraints.
- Label with Roboflow (free tier). Collect variety over quantity:
  different lighting, distances, car colours, damage types.
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
   phase 8 (cross-reference: see "Experimental findings" above).
   Listed here only for completeness of the catalogue.
2. **Multi-marker support for curved or large surfaces.** A single
   marker assumes a single plane. With two or more markers placed
   across the piece, the geometry can be reconstructed piecewise.
   Useful for fuselage panels or car bonnets with curvature or large
   damage areas where a single marker leaves too much margin.
   Mathematically non-trivial (interpolation between planes), but
   feasible and pedagogically rich.
3. **Assisted automatic damage detection.** Today the inspector
   manually places the two endpoints of each dimension. The app
   could propose them and the inspector only confirms. Three paths:
   (a) classical OpenCV (Canny edge detection, adaptive thresholding,
   contour analysis) for high-contrast defects, no AI, zero cost,
   local processing; (b) a custom-trained model (see Block 4);
   (c) Azure AI Vision / Custom Vision for corporate environments,
   no data leaving Microsoft.
4. **Temporal comparison across inspections.** If the same zone is
   inspected periodically, the app could align successive photos
   (using the ArUco marker as a stable anchor) and highlight new
   defects or growth of existing ones. Valuable for both scheduled
   aerospace maintenance and vehicle fleet management.
5. **Per-device lens-distortion calibration.** Today perspective
   is corrected but residual radial distortion remains. A one-time
   chequerboard calibration with `cv.calibrateCamera` + `cv.undistort`
   per phone model removes it. ~15-minute setup per phone, reused
   for every photo afterwards. Best-case error drops from 1–2% to
   0.3–0.5%.
6. **Stereometry: light 3D from two photos.** Two photos of the same
   damage from slightly different angles, both with visible markers,
   allow estimating depth by triangulation — the dimension the
   current pipeline does not measure. Turns the tool from "surface
   extent" into "dent volume". Software-only, no extra hardware.
7. **Measurement reliability heatmap.** ✅ Completed in phase 12.
   Radial gradient overlay (green at centre → yellow → red at edges)
   visualising where measurements are most reliable. Hold-to-show,
   same pattern as ⊙ Original. Never appears on exported JPEGs.
8. **Live camera mode with continuous ArUco detection.** Real-time
   video stream where ArUco is detected on every frame and scale
   is recalibrated continuously. The inspector can frame and see
   live measurements before capturing. Large conceptual phase; the
   technical learning (video stream handling, per-frame processing,
   sync between video and canvas) is substantial.

### Block 2 — Workflow and traceability

9. **Structured inspection session as first-class entity.** Today
   each photo is independent. An "inspection" would become a
   container: identifier (tail number for aerospace / registration
   for vehicles), date, inspector, list of documented damages, each
   with its photos and measurements. Session ends generating a
   signed technical PDF report.
10. **Zone coding.** Before each photo, the inspector tags the zone
    ("panel L-23, frame 14-15" for aircraft; "front left door, lower
    edge" for vehicles). The system stores it as metadata and allows
    searching historical damages by zone.
11. **Integration with corporate maintenance / fleet system.**
    Aerospace: SAP or equivalent, requires IT access and API
    agreements. Vehicle fleet: fleet management software (not
    planned for personal portfolio; noted for completeness).
12. **Damage type catalogue + convergence with existing classifier.**
    Each damage classified (aerospace: Dent, Blend-out, Rivet
    Pull-in, Out of Contour; vehicles: equivalent deformation
    categories) using the logic of the existing classification tool.
    With automatic measurement + classification combined, the full
    information piece needed by the official system is captured in
    one flow.

### Block 3 — Capture and image quality

13. **Real-time capture assistant.** Live feedback on the camera
    view: "marker outside safe zone", "you are tilted, straighten
    up", "too dark, turn on the light". Requires moving part of the
    OpenCV pipeline to the live video stream (related to item 8).
    Applicable to both domains identically.
14. **Oblique lighting to reveal relief.** Not a software item: a
    lateral torch at grazing angle makes dents invisible under
    frontal light appear as clear shadows. Belongs in the operational
    rules for both aerospace and vehicle inspection.

### Block 4 — Applied AI and custom-trained model

**Domain note for Block 4:** training on real aerospace damage photos
is not possible for personal work (confidentiality constraint). All
personal model training uses vehicle bodywork damage as the equivalent
domain. The technical pipeline (dataset → labelling → YOLOv8 →
ONNX → browser) is identical regardless of domain; only the photos
and class labels differ. No backend is required at any step: training
runs locally or on Google Colab (free GPU), and inference runs
entirely in the browser via ONNX Runtime Web.

15. **Learn Python oriented to computer vision.** Not "Python in
    abstract" but with specific focus:
    - `numpy` and `opencv-python` (the Python port of OpenCV, far
      more powerful than the JS build).
    - `Pillow` for image handling.
    - Jupyter notebooks for visual step-by-step experimentation.
    Realistic timeline: 4–6 weeks for fluency at 4–5 hours/week.
    Foundation for everything else in this block.
16. **Build a custom vehicle damage dataset.** Collect 200–500 photos
    of real vehicle bodywork damage in public spaces (parking lots,
    streets, workshops). Variety over quantity: different lighting,
    distances, car colours, damage types (dents, scratches,
    deformations). Label with Roboflow (free tier). No
    confidentiality constraints — this data is personal.
    **Why vehicles:** aerospace damage photos are property of
    Accenture and its clients and cannot be used for personal
    training. Vehicle panels are geometrically equivalent (flat or
    slightly curved rigid panels with similar defect types). The
    trained model and all techniques transfer directly to aerospace
    data if an employer provides it.
17. **Train a small model with YOLOv8 or similar.** With the vehicle
    dataset prepared, train an object-detection model. Ultralytics
    YOLOv8 nano or small is the most accessible — a few lines of
    Python. Train on local GPU if available, or free Google Colab
    GPU. Trained model size: 5–20 MB. Export to **ONNX** format.
    **No backend required at this step** — training is a one-time
    offline process.
18. **Integrate the trained model into the web app via ONNX Runtime
    Web.** ONNX Runtime Web runs ONNX models directly in the browser
    via JavaScript, with no server and no data leaving the device.
    The model is bundled in `lib/` like OpenCV.js. **No backend
    required** — all inference is client-side, consistent with the
    project's privacy-by-design architecture. This closes the full
    learning loop: Python → training → ONNX → browser integration.
    Probably the richest single technical achievement possible from
    this learning track.
19. **Aerospace AI model for automatic classification (corporate
    decision).** Ambitious extension of items 16–18 applied to
    the real aerospace domain: if Accenture builds a labelled dataset
    of real aircraft damages, a custom model could classify
    automatically. This depends entirely on corporate decisions
    (data ownership, IT approval, project budget) — it is not
    something that can be done personally. The vehicle-domain work
    in items 16–18 is the proof of concept that makes this
    conversation possible.

### Block 5 — Augmented reality and technical drawings

20. **Augmented reality for historical damage location.** Pan the
    phone over the surface and see historical damages overlaid.
    Works best with LiDAR-equipped iPhones. Visually impressive but
    practical ROI is debatable. Aerospace-specific in concept;
    technically feasible for vehicles too.
21. **Automatic technical drawing generation.** From the captured
    dimensions, generate the stylised technical drawing used in
    official reports. Aerospace: formatted per Accenture/Airbus
    standard. Vehicle: formatted per insurance or fleet management
    standard. Very valuable when official templates must be matched.

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
    asset. For this specific profile (self-taught, applied AI +
    computer vision + industrial domain knowledge), the combination
    is rare and valuable. Framing: "validated on vehicles because
    aerospace data is confidential — same pipeline, transferable
    on day one." Return materialises at 12–18 months.
    Cost: 1–2 hours/week.

## How to start the next session (phase 13 — multi-marker support)

When opening a new chat:

1. Confirm that the latest index.html and this PROJECT_CONTEXT.md
   are present in project files.
2. Read PROJECT_CONTEXT.md and index.html before doing anything else.
3. When code inspection is needed, read specific fragments by line
   range — do NOT ask the user to paste fragments and do NOT rely
   on memory of earlier chat content.
4. Do not start writing code until the plan has been approved in
   plain language.
5. Deliver changes as copy-pasteable fragments for VS Code, not as
   whole-file replacements. Explain each fragment before presenting it.

Phase 13 covers multi-marker support:

  Detect and display ALL known markers present in the photo (not just
  the best one). Use the largest as the primary scale (current
  behaviour preserved). Draw each detected marker as a quadrilateral
  with its label, using a distinct colour per marker ID. Store all
  detected corners in state as groundwork for future geometry phases.

  Before proposing anything, read detectArucoMarker(), the CALIBRATION
  OVERLAY block in redraw(), and applyAutoCalibration() from the
  attached index.html.