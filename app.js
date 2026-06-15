/* ============================================================
   OPENCV READINESS
   ============================================================
   OpenCV.js loads asynchronously (see <script async> in <head>).
   The library exposes a global `cv` object, but it is not usable
   until its WebAssembly runtime has finished initialising. The
   standard signal for that is the existence of cv.Mat.

   While we wait we keep the loading overlay visible and the
   photo-pick buttons disabled. The moment cv is ready we:
     - hide the overlay
     - enable the buttons
     - log to console whether ArUco detection is available

   The ArUco check is the verification we need before phase 2:
   if it logs `false`, this opencv.js build does not include the
   detector and we cannot proceed with automatic calibration.
   ============================================================ */
(function waitForOpenCV() {
  function isReady() {
    return typeof cv !== 'undefined' && cv && typeof cv.Mat === 'function';
  }

  function onReady() {
    document.getElementById('opencv-loading').hidden = true;
    document.getElementById('btn-pick-camera').disabled = false;
    document.getElementById('btn-pick-gallery').disabled = false;

    /* This build exposes ArUco under the namespaced name
       cv.aruco_ArucoDetector (rather than the bare cv.ArucoDetector
       that some other builds use). Either way, the constructor
       must exist as a function for detection to be usable. */
    var arucoAvailable = (typeof cv.aruco_ArucoDetector === 'function');
    console.log('OpenCV ready, ArUco available:', arucoAvailable);

    /* heic2any usually loads faster than OpenCV (it's much smaller),
       so by the time we get here it should already be defined as
       window.heic2any. If for some reason it isn't, log false; the
       app will still work with non-HEIC photos but HEIC files will
       fail in loadPhotoFromFile. */
    var heicAvailable = (typeof window.heic2any === 'function');
    console.log('heic2any ready:', heicAvailable);
  }

  if (isReady()) { onReady(); return; }

  /* The "official" signal: OpenCV calls this when its WASM
     runtime is fully initialised. We register it first, in case
     it hasn't fired yet. */
  if (typeof cv !== 'undefined' && cv) {
    cv.onRuntimeInitialized = onReady;
  }

  /* Fallback poll for the edge cases where onRuntimeInitialized
     does not fire (e.g. cv was assigned but already initialised,
     or assigned after our handler). Cheap and self-terminating. */
  var pollId = setInterval(function () {
    if (isReady()) {
      clearInterval(pollId);
      onReady();
    }
  }, 100);
})();


/* ============================================================
   ARUCO MARKERS CONFIGURATION
   ============================================================
   Real-world size of each printed marker, in millimetres.
   The ID of the marker tells the app its physical size, so
   detection is fully automatic — the user does not pick a
   marker size anywhere in the UI.

   HOW TO ADD A NEW MARKER:

   1. Print a new ArUco marker (DICT_4X4_50 dictionary). You
      can generate one at https://chev.me/arucogen/ — pick
      "4x4 (50, 100, 250, 1000)" and any ID not already in
      use below. Print it large enough that the black border
      is at least a few millimetres thick.

   2. Measure the printed side length precisely with a ruler.
      It is normally NOT exactly the size you asked the printer
      for; measure the actual print.

   3. Add a new line to ARUCO_MARKER_SIZES_MM below in the form
      `ID: size_in_mm,` — for example, a marker with ID 5 that
      measures 75 mm per side becomes:  5: 75,

   4. Save and reload the app. No other changes needed.

   HOW TO CHANGE THE DICTIONARY:

   Change ARUCO_DICTIONARY below to one of the DICT_* constants
   listed in OpenCV docs. Then re-print all your markers using
   the new dictionary. Keep the table in sync.

   WHY DICT_4X4_50:
   The 4x4 grid is the simplest pattern (easiest to detect at
   distance and under poor lighting). The "50" means we have
   50 distinct IDs available, which is far more than the three
   markers we use, but the trade-off cost is zero — smaller
   dictionaries are not meaningfully faster.
   ============================================================ */

const ARUCO_DICTIONARY = 'DICT_4X4_50';

const ARUCO_MARKER_SIZES_MM = {
  0:  14.75,   // small — not in use, pending reprint at 30 mm
  1:  49.874,  // medium damage (50–200 mm)
  2:  99.874,  // large damage  (> 200 mm)
};

/* ============================================================
   PERSPECTIVE TOLERANCE
   ============================================================
   When the detected marker's four sides differ in length by more
   than this ratio (max_side / min_side), the photo is considered
   too tilted for reliable measurement: we block automatic
   calibration and force the user to either retake the photo or
   explicitly continue under their own responsibility.

   1.00 = perfectly square (impossible in practice).
   1.05 = barely noticeable tilt; well within 2% error target.
   1.10 = ~3-5% measurement error using averaged scale (our limit).
   1.15 = ~5-10% error.
   1.30 = clearly tilted, errors over 10%.

   Lower values are stricter (more rejections, more accuracy).
   Raising this above 1.15 makes the protection essentially useless.
   ============================================================ */

   /* ============================================================
   LENS DISTORTION PROFILES (phase 17)
   ============================================================
   Per-device lens distortion coefficients computed with
   cv.calibrateCamera (checkerboard calibration, phase 17).
   Applied silently via cv.undistort before the ArUco pipeline.

   HOW TO ADD A NEW DEVICE:
   1. Run calibrate.py with photos from the new device.
   2. Copy the JSON output and add a new entry below.
   3. The key MUST match the EXIF Model field exactly
      (verify with leer_exif.py).
   4. Save and deploy. No other changes needed.

   If a photo has no EXIF, or the model is not in this table,
   undistortion is silently skipped — the app works as before.
   ============================================================ */
const LENS_PROFILES = {
  'realme GT 7 Pro': {
    // Calibrated: 2026-06-04, 14 checkerboard photos, RMS 0.5617 px
    // Camera: Sony IMX906, 1x (24mm equiv), portrait orientation
    // Flags: CALIB_FIX_K3 | CALIB_FIX_K4 | CALIB_FIX_K5 — k3 fixed to 0, no overfitting
    imageSize:    [2304, 4096],
    cameraMatrix: [
      [2909.8974, 0.0,       1112.8302],
      [0.0,       2927.3153, 2043.2394],
      [0.0,       0.0,       1.0      ]
    ],
    distCoeffs: [0.19135971, -0.80445332, -0.003869, -0.00160775, 0.0]
  }
};
   
const PERSPECTIVE_TILT_LIMIT = 1.15;

/* Central 70% of the image — low-distortion zone.
   Used by the reliability heatmap (phase 12). */
const SAFE_ZONE_RATIO = 0.70;

/* ============================================================
   DIMENSION OFFSET DEFAULT
   ============================================================
   Initial perpendicular offset (in image pixels) between the
   measurement line and the dimension line when a new dimension
   is created. The user can drag the dimension line to adjust it.
   Increase for a more visible initial separation on high-res photos.
   ============================================================ */
const DIM_OFFSET_DEFAULT = -40;

/* ============================================================
   AUTO-DETECT WINDOW SIZE
   ============================================================
   Side length (in real millimetres) of the square region that
   suggestDamageEndpoints() analyses around the inspector's tap.
   Expressed in mm so it scales correctly regardless of how far
   the phone was from the surface when the photo was taken.

   120 mm covers:
   - A credit card (85.6 mm long) with comfortable margin.
   - A 1 € coin (23.25 mm) with plenty of margin.
   - Typical aerospace/automotive dents (20–100 mm range).

   Increase if the damage is consistently larger than the window.
   Decrease if Canny is capturing too many nearby objects.
   ============================================================ */
const AUTO_DETECT_WINDOW_MM = 120;

/* ============================================================
   ONNX DAMAGE DETECTION (phase 21)
   ============================================================
   ONNX_ENABLED: set to false to disable the damage detector
   entirely. The app works exactly as before (no model loaded,
   no inference run).

   ONNX_CONFIDENCE_THRESHOLD: detections below this score are
   discarded. 0.35 = 35% confidence minimum. Raise to reduce
   false positives; lower to catch more damage at the cost of
   more noise.

   ONNX_MODEL_PATH: path to the .onnx file relative to the
   app root. The model is served as a static file alongside
   the other assets.
   ============================================================ */
const ONNX_ENABLED            = true;
const ONNX_CONFIDENCE_THRESHOLD = 0.35;
const ONNX_MODEL_PATH         = './lib/best.onnx';

/* Class names in the same order as the model was trained.
   Index 0 = crack, 1 = dent, 2 = paint-off, 3 = scratch.
   These must match the classes in data.yaml exactly. */
const ONNX_CLASS_NAMES  = ['crack', 'dent', 'paint-off', 'scratch'];
const ONNX_CLASS_COLORS = ['#e53935', '#ff9800', '#ffeb3b', '#2a6fdb'];

/* ============================================================
   AUTH / LOGIN
   ============================================================
   HOW TO CONFIGURE:

   - AUTH_ENABLED: set to false to disable the password screen
     entirely. The app will unlock immediately for everyone.
     Set to true to require the password.

   - REMEMBER_DAYS: how long (in days) the browser remembers a
     successful login before asking again. 1 = 24h, 7 = a week,
     1/24 = 1 hour, 0 = never remember (ask on every visit).

   HOW TO CHANGE THE PASSWORD:

   1. Go to any "SHA-256 generator" online, for example:
      https://emn178.github.io/online-tools/sha256.html
   2. Type your new password there and copy the resulting 64-char hash
   3. Replace the PASSWORD_HASH value below with that hash
   4. To invalidate everyone's existing logged-in session (force
      them to re-enter the new password), also change AUTH_VERSION
      to a different value (e.g. '2', '3'...)

   Default password (so you can test immediately): accenture2026
   Change it as soon as possible.

   SECURITY DISCLAIMER:
   This is a "thin lock", not real security. Anyone determined can
   bypass it (the hashed password ships in this file). It only stops
   casual access. For real protection you need a backend with proper
   authentication (e.g. Azure Static Web Apps with corporate auth).
   ============================================================ */

const AUTH_ENABLED  = false;  // Set to true to enable password protection
const PASSWORD_HASH = 'bdfe587a475d957ab20b53503db6b9a95f6148a43ba93d237cea0531851b2af5';
const AUTH_VERSION  = '1';
const REMEMBER_DAYS = 1;
const STORAGE_KEY   = 'damageMeasurementAuth';

/* SHA-256 using the Web Crypto API. Returns a hex string.
   This API is available in all modern browsers without libraries. */
async function sha256(text) {
  const buffer = new TextEncoder().encode(text);
  const hashBuf = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function isAlreadyAuthenticated() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    /* Three things must match:
       - version (lets us invalidate everyone at once)
       - hash (in case the password has changed)
       - timestamp not too old */
    if (data.version !== AUTH_VERSION) return false;
    if (data.hash !== PASSWORD_HASH) return false;
    const ageDays = (Date.now() - data.timestamp) / (1000 * 60 * 60 * 24);
    if (ageDays > REMEMBER_DAYS) return false;
    return true;
  } catch (e) {
    return false;
  }
}

function rememberAuth() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    version: AUTH_VERSION,
    hash: PASSWORD_HASH,
    timestamp: Date.now()
  }));
}

function unlockApp() {
  document.getElementById('login').hidden = true;
  document.getElementById('app').hidden = false;
  /* Initialize the main app only AFTER passing auth, so all the
     code below doesn't run for unauthenticated users. */
  initApp();
}

async function tryLogin() {
  const input = document.getElementById('login-input').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';

  if (!input) {
    errorEl.textContent = 'Please enter the password';
    return;
  }

  const hash = await sha256(input);
  if (hash === PASSWORD_HASH) {
    rememberAuth();
    unlockApp();
  } else {
    errorEl.textContent = 'Incorrect password';
    document.getElementById('login-input').value = '';
  }
}

/* Bootstrap: if auth is disabled, unlock immediately. If already
   authenticated, skip login. Otherwise wait for password. */
(function bootstrap() {
  if (!AUTH_ENABLED) {
    unlockApp();
    return;
  }
  if (isAlreadyAuthenticated()) {
    unlockApp();
    return;
  }
  document.getElementById('login-button').addEventListener('click', tryLogin);
  document.getElementById('login-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tryLogin();
  });
  /* Focus the input automatically on desktop. On mobile we don't
     auto-focus because it would pop the keyboard before the user
     even sees the page. */
  if (!('ontouchstart' in window)) {
    document.getElementById('login-input').focus();
  }
})();


/* ============================================================
   MAIN APP
   ============================================================
   Everything below runs only after successful authentication.
   Wrapped in a function called by unlockApp().
   ============================================================ */
function initApp() {

/* ============================================================
   STATE
   ============================================================ */
const state = {
  phase: 'init',
  photo: null,
  originalPhoto: null,  // The un-rectified image (HTMLImageElement)
                        // kept around for the future "view original"
                        // button (phase 6 step 3). When auto-calibration
                        // succeeds, `photo` becomes the rectified canvas
                        // and `originalPhoto` keeps the source image.
                        // For manual calibration this stays null because
                        // there is no rectification to compare against.

  scale: 1,
  offsetX: 0,
  offsetY: 0,

  pinchStartDist: 0,
  pinchStartScale: 1,
  pinchCenter: null,
  panStart: null,
  isPinching: false,
  isPanning: false,
  touchStartTime: 0,
  touchStartPos: null,
  mouseDown: false,

  calibPoints: [],
  mmPerPixel: null,
  calibTilted: false,    // true if user accepted a tilted-marker calibration
  calibMarkerId: null,   // ID of the auto-detected marker, null if manual
  calibMarkerCorners: null, // 4 corners of the detected marker in image
                            // coords (auto calib only); null when manual
  allDetectedMarkers: [],   // all known markers found in the photo (phase 13);
                            // each entry is the full marker object from
                            // detectArucoMarker(). The primary calibration
                            // marker is always the one with the largest
                            // avgSidePx; the rest are secondary.
  dimensions: [],
  pendingA: null,
  pendingB: null,
  dimCounter: 0,
  renamingId: null,
  editingReference: false,

  /* Safe zone overlay: shown from photo load until the first
     calibration point or dimension is placed. Once dismissed
     it stays off for the rest of the session. */
 
  /* View-original mode: true only while the user holds the
     "Original" button. Causes redraw() to show the un-rectified
     photo without any overlays. Cleared on pointer-up/cancel. */
  viewingOriginal: false,
  viewingHeatmap: false,
  heatmapCanvas: null,

  /* Dimension line dragging */
  draggingDim: null,       // the dimension object being dragged, or null
  dragStartOffset: 0,      // dimOffset value at the moment dragging began
  dragStartImgPos: null,   // image-space position where the drag started
  draggingText: null,      // the text annotation being dragged, or null
  dragTextStartImgPos: null, // image-space position where the text drag started
  dragTextOrigin: null,    // {x,y} of the annotation at drag start
  editingTextAnn: null,    // annotation being edited in the modal, or null (null = creating new)

  /* ---- Annotations (phase 11) ---- */
  annotations: [],         // array of {type:'stroke'|'text', ...} objects
  annotationHistory: [],   // snapshots of annotations array for full undo
  penActive: false,        // true while the pen tool is the active mode
  eraserActive: false,     // true while the eraser tool is active
  textActive: false,       // true while the text stamp tool is active
  editingText: null,       // reference to the text annotation being edited in-place, or null
  penColor: '#e53935',     // currently selected colour (hex string)
  penWidth: 5,             // currently selected stroke width in image px (2 / 5 / 10)
  textSize: 'medium',      // currently selected text size ('small' | 'medium' | 'large')
  currentStroke: null,     // the stroke object being drawn right now (between touchstart and touchend)

  /* ---- Rectangle selection (phase 15 auto-detect) ---- */
  rectStart: null,         // image-space {x,y} where the auto-detect drag started; null when inactive
  rectEnd: null,           // image-space {x,y} of the opposite corner while dragging; null when inactive
  pendingRectProposal: null, // result of suggestDamageEndpointsInRect(), held while modal is open
  lensModel: null,          // EXIF Model string of the photo's camera, or null (phase 17)

  /* ---- ONNX detections (phase 21) ---- */
  onnxDetections: [],       // array of {label, confidence, x, y, w, h} in image-space px

  /* ---- Word report (phase 24) ---- */
  lastStereoDepthMm: null,  // last stereo depth result, for report form pre-fill
};

const welcome = document.getElementById('welcome');
const canvas  = document.getElementById('canvas');
const ctx     = canvas.getContext('2d');
const hint    = document.getElementById('hint');
const controls= document.getElementById('controls');
const badge   = document.getElementById('scale-badge');
const fabFit  = document.getElementById('fab-fit');

const fileCamera  = document.getElementById('file-camera');
const fileGallery = document.getElementById('file-gallery');

const btnPickCamera    = document.getElementById('btn-pick-camera');
const btnPickGallery   = document.getElementById('btn-pick-gallery');
const btnNewProject    = document.getElementById('btn-new-project');
const btnConfirmPoint  = document.getElementById('btn-confirm-point');
const btnConfirmMeas   = document.getElementById('btn-confirm-meas');
const btnCancelMeas    = document.getElementById('btn-cancel-meas');
const btnAutoDetect    = document.getElementById('btn-auto-detect');
const btnAddDim        = document.getElementById('btn-add-dim');
const fabExitClean     = document.getElementById('fab-exit-clean');

const modalOnboard    = document.getElementById('modal-onboard');
const modalScaleSet   = document.getElementById('modal-scale-set');
const modalCalib      = document.getElementById('modal-calib');
const modalEditRef    = document.getElementById('modal-edit-ref');
const modalRename     = document.getElementById('modal-rename');
const modalNewProject = document.getElementById('modal-new-project');
const mmInput         = document.getElementById('mm-input');
const renameInput     = document.getElementById('rename-input');

const panelBackdrop = document.getElementById('panel-backdrop');
const leftPanel        = document.getElementById('left-panel');
const leftPanelClose   = document.getElementById('left-panel-close');
const btnCleanPanel    = document.getElementById('btn-clean-panel');
const btnSavePanel     = document.getElementById('btn-save-panel');
const btnSharePanel    = document.getElementById('btn-share-panel');
const btnReportPanel   = document.getElementById('btn-report-panel');


/* ============================================================
   PHOTO LOADING
   ============================================================ */
btnPickCamera.addEventListener('click',    () => fileCamera.click());
btnPickGallery.addEventListener('click',   () => fileGallery.click());

[fileCamera, fileGallery].forEach(input => {
  input.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    loadPhotoFromFile(file);
    input.value = '';
  });
});

/* ============================================================
   EXIF MODEL READER (phase 17)
   ============================================================
   Reads the camera Model field from a JPEG or HEIC file's EXIF
   data without any external library. Must be called on the
   original file Blob before heic2any conversion, because
   heic2any strips EXIF from the output JPEG.
   Returns the Model string or null if not found.
   ============================================================ */
async function readExifModel(blob) {
  try {
    const slice = blob.slice(0, 524288);   // 512 KB — cubre EXIF en archivos HEIC grandes
    const buf   = await slice.arrayBuffer();
    const data  = new Uint8Array(buf);

    /* HEIC files use ISO Base Media format — skip JPEG check.
       For HEIC, try parsing as TIFF directly from offset 0. */
    if (data[0] !== 0xFF || data[1] !== 0xD8) {
      /* Try reading as a container format (HEIC/MP4-based).
         The EXIF box in HEIC starts with 'Exif\0\0' somewhere
         in the first 64KB. Scan for it directly. */
      const marker = 'Exif\0\0';
      for (let i = 0; i < data.length - 6; i++) {
        if (data[i]   === 0x45 && data[i+1] === 0x78 &&
            data[i+2] === 0x69 && data[i+3] === 0x66 &&
            data[i+4] === 0x00 && data[i+5] === 0x00) {
          return parseExifModel(data, i + 6);
        }
      }
      return null;
    }

    let i = 2;
    while (i < data.length - 3) {
      if (data[i] !== 0xFF) break;
      const marker = data[i + 1];
      const segLen = (data[i + 2] << 8) | data[i + 3];
      if (marker === 0xE1) {
        const hdr = String.fromCharCode(...data.slice(i + 4, i + 10));
        if (hdr === 'Exif\0\0') return parseExifModel(data, i + 10);
      }
      i += 2 + segLen;
    }
    return null;
  } catch (e) {
    console.warn('readExifModel failed:', e);
    return null;
  }
}

function parseExifModel(data, tiffStart) {
  try {
    /* In Realme GT 7 Pro HEIC files, the TIFF block does not start
       immediately after 'Exif\0\0'. Scan the full data buffer for
       the byte-order marker instead of a fixed offset. */
    for (let s = tiffStart; s < data.length - 8; s++) {
      const isLE = data[s]===0x49 && data[s+1]===0x49 &&
                   data[s+2]===0x2A && data[s+3]===0x00;
      const isBE = data[s]===0x4D && data[s+1]===0x4D &&
                   data[s+2]===0x00 && data[s+3]===0x2A;
      if (!isLE && !isBE) continue;

      const le  = isLE;
      const u16 = (o) => le
        ? data[s+o] | (data[s+o+1]<<8)
        : (data[s+o]<<8) | data[s+o+1];
      const u32 = (o) => le
        ? data[s+o] | (data[s+o+1]<<8) | (data[s+o+2]<<16) | (data[s+o+3]<<24)
        : (data[s+o]<<24) | (data[s+o+1]<<16) | (data[s+o+2]<<8) | data[s+o+3];

      const ifd0  = u32(4);
      const count = u16(ifd0);
      if (count < 1 || count > 256) continue;  // sanity: skip false positives

      for (let e = 0; e < count; e++) {
        const base = ifd0 + 2 + e * 12;
        if (base + 12 > data.length - s) break;
        const tag  = u16(base);
        const type = u16(base+2);
        const len  = u32(base+4);
        if (tag === 0x0110 && type === 2) {
          const offset = len <= 4 ? base + 8 : u32(base+8);
          const bytes  = data.slice(s+offset, s+offset+len);
          return new TextDecoder().decode(bytes).replace(/\0/g,'').trim();
        }
      }
    }
    return null;
  } catch (e) {
    console.warn('parseExifModel error:', e);
    return null;
  }
}
/* ============================================================
   LENS UNDISTORTION (phase 17)
   ============================================================
   Applies cv.undistort if a LENS_PROFILES entry exists for
   state.lensModel. Returns a corrected HTMLCanvasElement, or
   the original img unchanged if no profile is found.
   ============================================================ */
function undistortPhoto(img) {
  const profile = state.lensModel ? LENS_PROFILES[state.lensModel] : null;
  if (!profile) return img;

  console.log(`Phase 17: applying lens undistortion for "${state.lensModel}"`);

  const src     = cv.imread(img);
  const dst     = new cv.Mat();
  const cm      = profile.cameraMatrix;
  const camMat  = cv.matFromArray(3, 3, cv.CV_64FC1, [
    cm[0][0], cm[0][1], cm[0][2],
    cm[1][0], cm[1][1], cm[1][2],
    cm[2][0], cm[2][1], cm[2][2]
  ]);
  const distMat = cv.matFromArray(1, 5, cv.CV_64FC1, profile.distCoeffs);

  try {
    cv.undistort(src, dst, camMat, distMat);
    const outCanvas = document.createElement('canvas');
    outCanvas.width  = img.naturalWidth  || img.width;
    outCanvas.height = img.naturalHeight || img.height;
    cv.imshow(outCanvas, dst);
    console.log(`Phase 17: undistortion applied (${outCanvas.width}x${outCanvas.height})`);
    return outCanvas;
  } catch (err) {
    console.warn('Phase 17: undistortion failed, using original photo:', err);
    return img;
  } finally {
    src.delete();
    dst.delete();
    camMat.delete();
    distMat.delete();
  }
}

function loadPhotoFromFile(file) {
  /* HEIC detection — check both the MIME type and the filename
     extension. The MIME type is the more reliable signal but some
     Android browsers leave it empty, so we fall back to extension. */
  const isHeic = /image\/hei[cf]/i.test(file.type || '') ||
                 /\.(heic|heif)$/i.test(file.name || '');

  /* Phase 17: read EXIF model from the original file BEFORE any
     conversion. heic2any strips EXIF from the converted JPEG, so
     this is the only moment the metadata is available. */
  readExifModel(file).then(model => {
    state.lensModel = model || null;
    if (model) console.log(`Phase 17: EXIF model detected — "${model}"`);
    else        console.log('Phase 17: no EXIF model found, undistortion skipped.');

    if (isHeic) {
      convertHeicAndLoad(file);
    } else {
      loadPhotoFromBlob(file);
    }
  });
}

/* ============================================================
   HEIC CONVERSION
   ============================================================
   HEIC is Apple's image format, also used by modern Android
   phones. Browsers cannot decode it natively, so we use
   heic2any (libheif compiled to WebAssembly) to convert it to
   JPEG in the browser before the rest of the app sees it.

   Conversion takes a couple of seconds for typical photos; we
   show a spinner so the user knows the app hasn't frozen.

   Quality 0.92 matches what the app uses elsewhere when exporting
   JPEGs — a sensible balance of file size and fidelity.
   ============================================================ */
async function convertHeicAndLoad(file) {
  const indicator = document.getElementById('heic-converting');
  indicator.classList.add('show');
  try {
    const jpegBlob = await window.heic2any({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.92
    });
    /* heic2any can return a Blob or an array of Blobs (for
       animated HEIC bursts). For a normal photo we expect a
       single Blob; if we got an array, take the first frame. */
    const blob = Array.isArray(jpegBlob) ? jpegBlob[0] : jpegBlob;
    loadPhotoFromBlob(blob);
  } catch (err) {
    console.error('HEIC conversion failed:', err);
    alert('Could not read this HEIC photo. Please try another photo.');
  } finally {
    indicator.classList.remove('show');
  }
}

/* Shared image-loading code: takes any Blob (JPEG, PNG, or the
   JPEG produced by HEIC conversion) and pushes it through the
   existing FileReader/Image pipeline so the rest of the app sees
   it as a normal photo. */
function loadPhotoFromBlob(blob) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      state.photo = img;
      state.originalPhoto = null;
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      state.calibPoints = [];
      state.dimensions = [];
      state.mmPerPixel = null;
      state.calibTilted = false;
      state.calibMarkerId = null;
      state.calibMarkerCorners = null;
      state.allDetectedMarkers = [];
      state.pendingA = null;
      state.pendingB = null;
      state.dimCounter = 0;
      state.annotations = [];
      state.annotationHistory = [];
      state.currentStroke = null;
      state.heatmapCanvas = null;
      state.onnxDetections = [];   // clear previous detections on new photo
      state.showSafeZone = true;   // shown until first point is placed
      resetZoom();
      /* Phase 17: apply lens undistortion if a profile exists for
         the device that took this photo (identified via EXIF Model).
         undistortPhoto() returns either a corrected HTMLCanvasElement
         or the original img unchanged — both work as state.photo. */
      state.photo = undistortPhoto(state.photo);
      canvas.width  = state.photo.width  || state.photo.naturalWidth;
      canvas.height = state.photo.height || state.photo.naturalHeight;
      /* Try automatic calibration first. If a known ArUco marker
         is found, the scale is set automatically and we skip the
         manual two-point flow. If not, we fall back to the manual
         flow (identical to what the app did before this change). */
      tryAutoCalibration();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(blob);
}


/* ============================================================
   AUTOMATIC CALIBRATION (via ArUco marker)
   ============================================================
   Called after a photo has been loaded into state.photo. Runs
   ArUco detection and, on success, jumps straight to the
   measurement phase with a fully configured scale. On failure,
   falls through to the manual two-point flow that was the only
   option before this change.

   Why we populate state.calibPoints on success:
   The rest of the app (badge text, "edit reference" flow,
   recalculation when the user edits mm value) reads from
   calibPoints to know "where is the reference in the image".
   Filling it with two opposite corners of the marker keeps
   those features working coherently without rewriting them.
   ============================================================ */
function tryAutoCalibration() {
  const result = detectArucoMarker(state.photo);

  if (result.errorMessage) {
    console.warn('Auto calibration error:', result.errorMessage);
  }

  /* Store all detected markers for the secondary overlay (phase 13).
     Cleared here so a photo with zero markers never shows stale data
     from a previous load. */
  state.allDetectedMarkers = result.markers || [];

  if (result.best) {
    const m = result.best;
    console.log(`Auto calibration OK: marker ID ${m.id}, ` +
                `${m.sizeMm} mm, scale = ${m.mmPerPixel.toFixed(4)} mm/px, ` +
                `side variance = ${m.sideVariance.toFixed(3)}`);

    /* Block the calibration if the photo is too tilted. The user
       will be shown a modal (Edición B) with two choices: retake
       the photo, or accept the risk. We stash the detected marker
       in state.pendingMarker so the modal handlers can decide. */
    if (m.sideVariance > PERSPECTIVE_TILT_LIMIT) {
      state.pendingMarker = m;
      showTiltedPhotoModal(m);
      return;
    }

    /* Phase 16: if ≥2 markers detected, use multi-marker homography
       for a more robust rectification. Falls back to single-marker
       (phase 6) if the multi-marker attempt throws. */
    if (result.markers.length >= 2) {
      console.log(`Phase 16: ${result.markers.length} markers detected — ` +
                  `attempting multi-marker homography.`);
      try {
        applyAutoCalibration(m, false, result.markers);
        return;
      } catch (err) {
        console.warn('Multi-marker homography failed, falling back ' +
                     'to single-marker:', err);
        /* Fall through to single-marker path below. */
      }
    }

    /* Single marker (phase 6 path). */
    applyAutoCalibration(m, false);
    return;
  }

  /* No known marker detected — fall back to the manual flow,
     identical to the pre-ArUco behaviour of the app. */
  console.log('No ArUco marker detected, falling back to manual calibration.');
  /* Phase 21: run ONNX detection even without a marker — the
     inspector can still benefit from knowing the damage type
     before deciding whether to calibrate manually. */
  if (ONNX_ENABLED) runOnnxDetection();
  setPhase('calib-1');
  modalOnboard.classList.add('show');
}


/* Apply a detected marker as the new calibration. Called either
   directly when the photo is acceptably flat, or from the tilted-
   photo modal when the user explicitly chooses to continue. The
   `tilted` flag controls whether the badge shows a warning.

   Phase 6 step 2: this function now rectifies the photo using
   warpPerspective before applying the calibration. After this,
   state.photo is the rectified canvas (not the original image),
   and mm/pixel is constant across the whole image — eliminating
   the "error grows with distance from marker" problem documented
   in PROJECT_CONTEXT.md "Experimental findings".

   Robustness: if rectification fails for any reason (degenerate
   matrix, OpenCV edge case, sanity check rejection), we fall
   back to the pre-step-2 behaviour: use the original photo with
   the (non-constant) marker-derived scale. The app keeps
   working, just without the rectification benefit. */
function applyAutoCalibration(marker, tilted, allMarkers) {
  let rectified = null;
  try {
    if (allMarkers && allMarkers.length >= 2) {
      /* Phase 16: multi-marker path. */
      rectified = rectifyImageWithMultipleMarkers(state.photo, allMarkers);
    } else {
      /* Phase 6: single-marker path. */
      rectified = rectifyImageWithMarker(
        state.photo, marker.corners, marker.sizeMm
      );
    }
  } catch (err) {
    console.warn('Multi-marker rectification failed:', err);
    /* If the multi-marker attempt failed, retry with the single
       best marker (phase 6 path) before giving up entirely. */
    if (allMarkers && allMarkers.length >= 2) {
      try {
        console.log('Retrying with single-marker rectification (phase 6 fallback).');
        rectified = rectifyImageWithMarker(
          state.photo, marker.corners, marker.sizeMm
        );
      } catch (err2) {
        console.warn('Single-marker rectification also failed, ' +
                     'falling back to non-rectified calibration:', err2);
      }
    }
  }

  if (rectified) {
    /* Rectified path: state.photo becomes the rectified canvas,
       state.originalPhoto keeps the un-rectified image for the
       upcoming "view original" button. Canvas dimensions are
       reasserted explicitly (with decision C1 they don't change,
       but being explicit protects against future tweaks). */
    state.originalPhoto      = state.photo;
    state.photo              = rectified.image;
    canvas.width             = rectified.image.width;
    canvas.height            = rectified.image.height;

    /* In the rectified space the marker IS a perfect square, so
       the two "opposite corners" we store for legacy callers
       (calibPoints) are the TL and BR of that square. */
    state.calibPoints        = [
      rectified.markerCornersRectified[0],
      rectified.markerCornersRectified[2]
    ];
    state.calibMarkerCorners = rectified.markerCornersRectified;
    state.mmPerPixel         = rectified.mmPerPixelRectified;

    /* Transform secondary marker corners into rectified space (phase 13).
       applyHomography() multiplies a 2D point by the 3×3 perspective
       matrix using homogeneous coordinates — the same operation
       cv.perspectiveTransform does, but in plain JS so we don't need
       to keep a cv.Mat alive outside rectifyImageWithMarker(). */
    if (rectified.homography && state.allDetectedMarkers.length > 1) {
      const h = rectified.homography;
      function applyHomography(p) {
        const w = h[6] * p.x + h[7] * p.y + h[8];
        return {
          x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
          y: (h[3] * p.x + h[4] * p.y + h[5]) / w
        };
      }
      state.allDetectedMarkers = state.allDetectedMarkers.map(m => {
        if (m.id === marker.id) return m;   // primary: already handled above
        return { ...m, corners: m.corners.map(applyHomography) };
      });
    }
  } else {
    /* Fallback path: same behaviour as before phase 6 step 2. */
    state.originalPhoto      = null;
    state.calibPoints        = [marker.corners[0], marker.corners[2]];
    state.calibMarkerCorners = marker.corners;
    state.mmPerPixel         = marker.mmPerPixel;
  }

  state.calibMarkerId = marker.id;
  state.calibTilted   = tilted;
  setPhase('measure-idle');

  /* Phase 21: run ONNX detection after calibration is complete.
     Async — does not block the UI. If it fails, state.onnxDetections
     stays empty and the app continues normally. */
  if (ONNX_ENABLED) runOnnxDetection();
}

/* ============================================================
   ONNX MODEL INITIALISATION (phase 21)
   ============================================================
   Called once at app startup. Loads the model in the background
   while the inspector picks a photo. onnxSession is kept as a
   variable inside initApp() so all functions below can access it.
   If loading fails (file missing, incompatible model), onnxSession
   stays null and all inference calls are silently skipped.
   ============================================================ */
let onnxSession = null;

async function initOnnxModel() {
  if (!ONNX_ENABLED) return;
  try {
    /* Wait for ort to be defined — ort.min.js loads async so it
       may not be available yet when initApp() runs. Poll in the
       same way the app waits for cv to be ready. */
    await new Promise((resolve, reject) => {
      if (typeof ort !== 'undefined') { resolve(); return; }
      let attempts = 0;
      const poll = setInterval(() => {
        attempts++;
        if (typeof ort !== 'undefined') { clearInterval(poll); resolve(); }
        else if (attempts > 100) { clearInterval(poll); reject(new Error('ort.min.js did not load after 10s')); }
      }, 100);
    });
    /* Tell ORT where to find the .wasm files — they live in lib/
       alongside ort.min.js so the relative path is the same. */
    ort.env.wasm.wasmPaths = './lib/';
    onnxSession = await ort.InferenceSession.create(ONNX_MODEL_PATH, {
      executionProviders: ['wasm']
    });
    console.log('Phase 21: ONNX model loaded OK. Input:',
      Object.keys(onnxSession.inputNames),
      'Output:', Object.keys(onnxSession.outputNames));
  } catch (err) {
    console.warn('Phase 21: ONNX model failed to load — detection disabled.', err);
    onnxSession = null;
  }
}

/* ============================================================
   ONNX PREPROCESSING (phase 21)
   ============================================================
   YOLOv8 expects a 640×640 RGB image normalised to [0, 1] as a
   flat Float32Array in BCHW format:
     B = batch size (always 1 here)
     C = channels (3: red, green, blue — separate planes)
     H = height (640)
     W = width (640)

   We draw state.photo onto a 640×640 offscreen canvas (which
   handles the resize automatically), read the RGBA pixels, and
   rearrange them from interleaved RGBA into separate RGB planes.
   Alpha channel is discarded.
   ============================================================ */
function preprocessForOnnx(photo) {
  const SIZE = 640;
  const offscreen = document.createElement('canvas');
  offscreen.width  = SIZE;
  offscreen.height = SIZE;
  const octx = offscreen.getContext('2d');
  octx.drawImage(photo, 0, 0, SIZE, SIZE);

  const imageData = octx.getImageData(0, 0, SIZE, SIZE);
  const pixels    = imageData.data;   // Uint8ClampedArray, RGBA interleaved

  /* Allocate one Float32 per pixel per channel: 3 × 640 × 640 */
  const tensor = new Float32Array(3 * SIZE * SIZE);
  const planeSize = SIZE * SIZE;

  for (let i = 0; i < planeSize; i++) {
    tensor[i]                  = pixels[i * 4]     / 255;  // R plane
    tensor[planeSize + i]      = pixels[i * 4 + 1] / 255;  // G plane
    tensor[planeSize * 2 + i]  = pixels[i * 4 + 2] / 255;  // B plane
  }

  return new ort.Tensor('float32', tensor, [1, 3, SIZE, SIZE]);
}

/* ============================================================
   ONNX INFERENCE + POSTPROCESSING (phase 21)
   ============================================================
   Runs the model on state.photo and stores results in
   state.onnxDetections. Each detection is:
     { label, confidence, x, y, w, h }
   where x, y, w, h are in IMAGE-SPACE pixels (not 640×640 space).

   YOLOv8 output shape: (1, 8, 8400)
     8400 = candidate boxes
     8    = [cx, cy, w, h, score_class0, score_class1, score_class2, score_class3]
   All coordinates are in the 640×640 input space and must be
   scaled back to the real image dimensions.

   NMS (Non-Maximum Suppression): when two boxes overlap heavily
   and detect the same class, we keep only the one with the higher
   confidence. "Overlap heavily" means IoU > 0.45 (industry default).
   IoU = Intersection over Union — the ratio of the overlapping area
   to the total area covered by both boxes combined.
   ============================================================ */
async function runOnnxDetection() {
  if (!onnxSession || !state.photo) return;

  try {
    const inputTensor = preprocessForOnnx(state.photo);
    const inputName   = onnxSession.inputNames[0];
    const feeds       = { [inputName]: inputTensor };
    const results     = await onnxSession.run(feeds);
    const outputName  = onnxSession.outputNames[0];
    const output      = results[outputName].data;   // Float32Array, shape (1,8,8400)

    /* output is stored in column-major order for YOLOv8:
       output[attr * 8400 + box] — not row-major.
       So output[0..8399] = all cx values, output[8400..16799] = all cy, etc. */
    const numBoxes  = 8400;
    const numAttrs  = 8;   // 4 coords + 4 class scores
    const imgW = state.photo.width  || state.photo.naturalWidth;
    const imgH = state.photo.height || state.photo.naturalHeight;
    const scaleX = imgW / 640;
    const scaleY = imgH / 640;

    const raw = [];

    for (let b = 0; b < numBoxes; b++) {
      /* Find the class with the highest score for this box */
      let bestClass = 0;
      let bestScore = output[4 * numBoxes + b];   // score for class 0
      for (let c = 1; c < 4; c++) {
        const score = output[(4 + c) * numBoxes + b];
        if (score > bestScore) { bestScore = score; bestClass = c; }
      }

      if (bestScore < ONNX_CONFIDENCE_THRESHOLD) continue;

      /* cx, cy, w, h are in 640×640 space — scale to image space */
      const cx = output[0 * numBoxes + b] * scaleX;
      const cy = output[1 * numBoxes + b] * scaleY;
      const bw = output[2 * numBoxes + b] * scaleX;
      const bh = output[3 * numBoxes + b] * scaleY;

      raw.push({
        label:      ONNX_CLASS_NAMES[bestClass],
        classIdx:   bestClass,
        confidence: bestScore,
        x: cx - bw / 2,   // convert centre → top-left
        y: cy - bh / 2,
        w: bw,
        h: bh
      });
    }

    /* NMS: sort by confidence descending, then suppress overlapping boxes */
    raw.sort((a, b) => b.confidence - a.confidence);
    const kept = [];
    const suppressed = new Uint8Array(raw.length);

    for (let i = 0; i < raw.length; i++) {
      if (suppressed[i]) continue;
      kept.push(raw[i]);
      for (let j = i + 1; j < raw.length; j++) {
        if (suppressed[j]) continue;
        if (raw[i].classIdx !== raw[j].classIdx) continue;
        if (iou(raw[i], raw[j]) > 0.45) suppressed[j] = 1;
      }
    }

    state.onnxDetections = kept;
    console.log(`Phase 21: ${kept.length} detection(s) after NMS.`, kept);
    redraw();

  } catch (err) {
    console.warn('Phase 21: inference failed.', err);
    state.onnxDetections = [];
  }
}

/* IoU helper: given two boxes {x, y, w, h}, returns the
   Intersection over Union ratio (0 = no overlap, 1 = identical). */
function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter === 0) return 0;
  return inter / (a.w * a.h + b.w * b.h - inter);
}


/* Show the tilted-photo modal. The marker is already stored in
   state.pendingMarker by the caller (tryAutoCalibration), so all
   we do here is populate the variance line and reveal the modal.
   The two button handlers below (tilted-retake / tilted-continue)
   decide what happens next based on the user's choice. */
function showTiltedPhotoModal(marker) {
  console.warn(`Photo too tilted: side variance = ${marker.sideVariance.toFixed(3)} ` +
               `(limit = ${PERSPECTIVE_TILT_LIMIT}).`);
  document.getElementById('tilted-variance').textContent =
    `Side variance: ${marker.sideVariance.toFixed(2)} (limit: ${PERSPECTIVE_TILT_LIMIT.toFixed(2)})`;
  document.getElementById('modal-tilted').classList.add('show');
}


/* ============================================================
   ZOOM AND PAN
   ============================================================ */
function resetZoom() {
  state.scale = 1; state.offsetX = 0; state.offsetY = 0;
  updateFabFit();
}
function updateFabFit() {
  fabFit.classList.toggle('show',
    state.scale > 1.01 || state.offsetX !== 0 || state.offsetY !== 0);
}
function zoomAt(cx, cy, newScale) {
  newScale = Math.max(1, Math.min(8, newScale));
  const imgX = (cx - state.offsetX) / state.scale;
  const imgY = (cy - state.offsetY) / state.scale;
  state.scale = newScale;
  state.offsetX = cx - imgX * state.scale;
  state.offsetY = cy - imgY * state.scale;
  clampOffset(); updateFabFit();
}
function clampOffset() {
  if (!state.photo) return;
  const maxOffX = 0;
  const minOffX = canvas.width  - canvas.width  * state.scale;
  const maxOffY = 0;
  const minOffY = canvas.height - canvas.height * state.scale;
  state.offsetX = Math.min(maxOffX, Math.max(minOffX, state.offsetX));
  state.offsetY = Math.min(maxOffY, Math.max(minOffY, state.offsetY));
}


/* ============================================================
   COORDINATES
   ============================================================ */
function getCanvasCoord(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (canvas.width  / rect.width),
    y: (clientY - rect.top)  * (canvas.height / rect.height)
  };
}
function getImagePoint(clientX, clientY) {
  const c = getCanvasCoord(clientX, clientY);
  return {
    x: (c.x - state.offsetX) / state.scale,
    y: (c.y - state.offsetY) / state.scale
  };
}


/* ============================================================
   DRAWING
   ============================================================ */
/* ============================================================
   SCREEN-CONSISTENT SIZING
   ============================================================
   The cross/stroke/font sizes are defined in SCREEN pixels and
   then translated to IMAGE pixels using the current display
   ratio. This makes them look the same physical size on both
   mobile (~400px wide canvas on screen) and desktop (~1200px
   wide). Without this, a percentage-of-image size would look
   2-3× bigger on desktop than on mobile.

   When exporting, we want LARGER marks (proportional to the
   image, not the screen) so the saved JPEG is readable when
   viewed at full size. The exportMode flag handles that.
   ============================================================ */
let exportMode = false;

function imagePerScreenPx() {
  /* How many image pixels fit in one screen pixel of canvas */
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return 1;
  return canvas.width / rect.width;
}

function baseCrossSize() {
  if (exportMode) return Math.max(20, canvas.width * 0.012);
  return 14 * imagePerScreenPx();   // 14 screen px
}
function baseStroke() {
  if (exportMode) return Math.max(5, canvas.width * 0.003);
  return 3 * imagePerScreenPx();    // 3 screen px
}
function baseFontSize() {
  if (exportMode) return Math.max(28, canvas.width * 0.022);
  return 18 * imagePerScreenPx();   // 18 screen px
}

function redraw() {
  if (!state.photo) return;
  const cleanMode = document.body.classList.contains('clean');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(state.scale, 0, 0, state.scale, state.offsetX, state.offsetY);

  /* VIEW-ORIGINAL MODE
     ----------------------------------------------------------
     While the user holds the "Original" button, draw the
     un-rectified photo with no overlays at all. The zoom and
     pan state is untouched, so the two images are compared at
     the same framing. We return immediately so nothing else
     is drawn on top of the original.
     ---------------------------------------------------------- */
  if (state.viewingOriginal && state.originalPhoto) {
    ctx.drawImage(state.originalPhoto, 0, 0);
    return;
  }

  ctx.drawImage(state.photo, 0, 0);

  const k = 1 / state.scale;
  const crossSize = baseCrossSize() * k;
  const stroke    = baseStroke() * k;
  const fontSize  = baseFontSize() * k;

  /* RELIABILITY HEATMAP — phase 12
     Draw the pre-built gradient canvas on top of the photo,
     only while the user holds the heatmap button and only in
     interactive mode (never on exported JPEGs). */
  if (state.viewingHeatmap && state.heatmapCanvas && !exportMode) {
    ctx.drawImage(state.heatmapCanvas, 0, 0);
  }

  /* In clean mode, skip all overlays — show photo only. */
  if (cleanMode) return;

  /* CALIBRATION OVERLAY (Edición H + phase 13) */

  /* Secondary markers: draw first so the primary marker is always
     rendered on top. Each ID gets a distinct colour so the user
     can tell them apart at a glance. The primary marker (the one
     used for calibration) is excluded from this loop to avoid
     drawing it twice. */
  const SECONDARY_MARKER_COLORS = {
    0: '#ff9800',   // orange  — ID 0 (small,  ~15 mm)
    1: '#00bcd4',   // cyan    — ID 1 (medium, ~50 mm)
    2: '#66bb6a',   // green   — ID 2 (large, ~100 mm)
  };

  if (state.allDetectedMarkers.length > 1) {
    state.allDetectedMarkers.forEach(m => {
      if (m.id === state.calibMarkerId) return;   // skip primary
      const color = SECONDARY_MARKER_COLORS[m.id] || '#aaaaaa';
      drawPolygon(m.corners, color, stroke);
      const cx = (m.corners[0].x + m.corners[1].x + m.corners[2].x + m.corners[3].x) / 4;
      const cy = (m.corners[0].y + m.corners[1].y + m.corners[2].y + m.corners[3].y) / 4;
      drawLabelAtPoint({ x: cx, y: cy },
        `Marker ID ${m.id} — ${m.sizeMm} mm`,
        color, fontSize, k);
    });
  }

  if (state.calibMarkerCorners) {
    /* Auto-detected marker: closed quadrilateral, no corner
       crosses (the rectangle is enough). Tilted calibrations use
       the same yellow line, since the badge already conveys the
       warning in red. */
    drawPolygon(state.calibMarkerCorners, '#ffeb3b', stroke);
    if (state.mmPerPixel && state.calibMarkerId != null) {
      const corners = state.calibMarkerCorners;
      const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
      const cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
      const sizeMm = ARUCO_MARKER_SIZES_MM[state.calibMarkerId];
      const text = `Marker ID ${state.calibMarkerId} — ${sizeMm} mm`;
      drawLabelAtPoint({ x: cx, y: cy }, text, '#ffeb3b', fontSize, k);
    }
  } else {
    /* Manual calibration: two crosses and a connecting line. */
    state.calibPoints.forEach(p => drawCross(p.x, p.y, '#ffeb3b', crossSize, stroke));
    if (state.calibPoints.length === 2) {
      const [a, b] = state.calibPoints;
      drawLine(a, b, '#ffeb3b', stroke);
      if (state.mmPerPixel) {
        const mm = Math.hypot(b.x - a.x, b.y - a.y) * state.mmPerPixel;
        drawLabel(a, b, `Reference: ${mm.toFixed(1)} mm`, '#ffeb3b', fontSize, k);
      }
    }
  }

    state.dimensions.forEach(m => {
    if (m.hidden) return;
    drawDimension(m, crossSize, stroke, fontSize, k);
  });

  if (state.pendingA) drawCross(state.pendingA.x, state.pendingA.y, '#e53935', crossSize, stroke);
  if (state.pendingB) {
    drawCross(state.pendingB.x, state.pendingB.y, '#e53935', crossSize, stroke);
    drawLine(state.pendingA, state.pendingB, '#e53935', stroke);
  }

  /* Auto-detect rectangle: drawn in green while the inspector is dragging.
     rectStart is the corner where the drag began; pendingB tracks the
     current drag position (the opposite corner). Never drawn on export. */
  if (state.phase === 'detect-tap' && state.rectStart && state.rectEnd && !exportMode) {
    const rx = state.rectStart.x;
    const ry = state.rectStart.y;
    const rw = state.rectEnd.x - rx;
    const rh = state.rectEnd.y - ry;
    ctx.save();
    ctx.strokeStyle = '#2a6fdb';
    ctx.lineWidth   = stroke * 1.5;
    ctx.setLineDash([8 * k, 4 * k]);
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.fillStyle = 'rgba(42, 111, 219, 0.10)';
    ctx.fillRect(rx, ry, rw, rh);
    ctx.setLineDash([]);
    ctx.restore();
  }

  /* annotations drawn below */

  /* ANNOTATIONS (phase 11)
     ----------------------------------------------------------
     Draw all saved annotations plus the stroke currently being
     drawn (currentStroke). Both use the same rendering path so
     the in-progress stroke looks identical to a finished one.
     Annotations are drawn AFTER dimensions so they appear on top.
     In export mode the stroke width is scaled up proportionally
     to remain readable at full image resolution.
     ---------------------------------------------------------- */
  const annScale = exportMode ? imagePerScreenPx() : 1;

  const allToDraw = state.currentStroke
    ? [...state.annotations, state.currentStroke]
    : state.annotations;

  allToDraw.forEach(ann => {
    if (ann.type === 'stroke') {
      if (ann.points.length < 2) return;
      ctx.save();
      ctx.strokeStyle = ann.color;
      ctx.lineWidth   = (ann.width * annScale) * k;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.beginPath();
      ctx.moveTo(ann.points[0].x, ann.points[0].y);
      for (let i = 1; i < ann.points.length; i++) {
        ctx.lineTo(ann.points[i].x, ann.points[i].y);
      }
      ctx.stroke();
      ctx.restore();
    } else if (ann.type === 'text') {
      /* Text stamps are drawn in step 7. */
      const tFontSize = ann.size === 'small'  ? fontSize * 0.8
                      : ann.size === 'large'  ? fontSize * 1.4
                      : fontSize;
      drawLabelAtPoint({ x: ann.x, y: ann.y }, ann.label, ann.color, tFontSize, k);
    }
  });

  /* ONNX DETECTIONS (phase 21)
     ----------------------------------------------------------
     Draw bounding boxes for all detections above the confidence
     threshold. Label appears inside the box when there is not
     enough space above it (y too close to top edge).
     Never drawn in exportMode (same rule as the heatmap).
     ---------------------------------------------------------- */
  if (!exportMode && state.onnxDetections !== null && state.onnxDetections !== undefined) {
    /* No detections: show a brief notice in the top-left corner
       so the inspector knows the model ran but found nothing. */
    if (state.onnxDetections.length === 0) {
      const noDetFontSz = fontSize * 0.8;
      const noDetPad    = 6 * k;
      const noDetText   = 'No damage type detected';
      ctx.save();
      ctx.font         = `${noDetFontSz}px sans-serif`;
      const noDetW     = ctx.measureText(noDetText).width + noDetPad * 2;
      const noDetH     = noDetFontSz + noDetPad * 2;
      const noDetX     = noDetPad * 2;
      const noDetY     = canvas.height - noDetH - noDetPad * 2;
      ctx.fillStyle    = 'rgba(0,0,0,0.60)';
      ctx.fillRect(noDetX, noDetY, noDetW, noDetH);
      ctx.fillStyle    = '#aaaaaa';
      ctx.textBaseline = 'middle';
      ctx.textAlign    = 'left';
      ctx.fillText(noDetText, noDetX + noDetPad, noDetY + noDetH / 2);
      ctx.textBaseline = 'alphabetic';
      ctx.restore();
    }
  }

  if (!exportMode && state.onnxDetections && state.onnxDetections.length > 0) {
    /* No bounding boxes — too invasive alongside dimension lines
       and future overlays (rivets, edges, phase 23+).
       Show only a text summary badge, bottom-right of the image. */
    const sumFontSz  = fontSize * 0.85;
    const sumPad     = 7 * k;
    const sumSpacing = sumFontSz + sumPad;

    const sumLines = state.onnxDetections.map(d => {
      const cap = d.label.charAt(0).toUpperCase() + d.label.slice(1);
      return `Damage type detected: ${cap} ${Math.round(d.confidence * 100)}%`;
    });

    ctx.save();
    ctx.font = `bold ${sumFontSz}px sans-serif`;
    const sumMaxW = Math.max(...sumLines.map(l => ctx.measureText(l).width));
    const dotSpace = sumFontSz + sumPad * 0.5;
    const sumW = sumMaxW + sumPad * 2 + dotSpace;
    const sumH = sumPad + sumLines.length * sumSpacing + sumPad;
    const sumX = canvas.width  - sumW - sumPad * 2;
    const sumY = canvas.height - sumH - sumPad * 2;

    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(sumX, sumY, sumW, sumH);

    sumLines.forEach((line, idx) => {
      const det   = state.onnxDetections[idx];
      const color = ONNX_CLASS_COLORS[ONNX_CLASS_NAMES.indexOf(det.label)] || '#ffffff';
      const rowY  = sumY + sumPad + idx * sumSpacing + sumSpacing / 2;

      /* Colour dot */
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(sumX + sumPad + sumFontSz * 0.4, rowY, sumFontSz * 0.4, 0, Math.PI * 2);
      ctx.fill();

      /* Text */
      ctx.fillStyle    = '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.textAlign    = 'left';
      ctx.fillText(line, sumX + sumPad + dotSpace, rowY);
    });

    ctx.textBaseline = 'alphabetic';
    ctx.textAlign    = 'left';
    ctx.restore();
  }
}

function drawCross(x, y, color, size, stroke) {
  ctx.strokeStyle = color;
  ctx.lineWidth = stroke;
  ctx.beginPath();
  ctx.moveTo(x - size, y); ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size); ctx.lineTo(x, y + size);
  ctx.stroke();
}
function drawLine(a, b, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}
function drawLabel(a, b, text, color, fontSize, k) {
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  ctx.font = `bold ${fontSize}px sans-serif`;
  const metrics = ctx.measureText(text);
  const padX = 10 * k, padY = 6 * k;
  const w = metrics.width + padX * 2;
  const h = fontSize + padY * 2;
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(midX - w / 2, midY - h / 2, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * k;
  ctx.strokeRect(midX - w / 2, midY - h / 2, w, h);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, midX, midY);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/* Draw a closed polygon by connecting points in order and back
   to the first. Used to draw the four sides of a detected ArUco
   marker (Edición H). Caller passes the points already in image
   coordinates; the current canvas transform handles zoom/pan. */
function drawPolygon(points, color, width) {
  if (!points || points.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
  ctx.stroke();
}

/* Draw a labelled box centred on a single point. Variant of
   drawLabel used when there is no natural "two endpoints" to
   centre between — for example, the marker's centroid (Edición H).
   The styling intentionally matches drawLabel so the visual
   language stays consistent. */
function drawLabelAtPoint(point, text, color, fontSize, k) {
  ctx.font = `bold ${fontSize}px sans-serif`;
  const metrics = ctx.measureText(text);
  const padX = 10 * k, padY = 6 * k;
  const w = metrics.width + padX * 2;
  const h = fontSize + padY * 2;
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(point.x - w / 2, point.y - h / 2, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * k;
  ctx.strokeRect(point.x - w / 2, point.y - h / 2, w, h);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, point.x, point.y);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/* ============================================================
   ENGINEERING DIMENSION DRAWING
   ============================================================
   Draws a single dimension in the technical drawing style:
   - Two crosses at the original measurement endpoints (a, b)
   - A dimension line parallel to ab, offset perpendicularly
     by m.dimOffset image pixels
   - Extension lines from each endpoint to the dimension line,
     perpendicular to it (90° exactly)
   - A rotated label centred on the dimension line

   The perpendicular direction is computed fresh each draw from
   the current a/b positions, so the geometry is always correct
   even if points were moved in a future phase.

   Sign convention for dimOffset:
   Positive = offset in the direction of the left-hand normal
   of the vector a→b (i.e. "above" the line when b is to the
   right of a). Negative flips to the other side. The user
   can drag to either side.
   ============================================================ */
function drawDimension(m, crossSize, stroke, fontSize, k) {
  const ax = m.a.x, ay = m.a.y;
  const bx = m.b.x, by = m.b.y;

  /* Unit vector along the measurement line (a → b) */
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 1) return;   // degenerate: points on top of each other
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;

  /* Left-hand perpendicular unit vector (rotate ux,uy by +90°) */
  const px = -uy;
  const py =  ux;

  /* Offset amount in image pixels */
  const off = m.dimOffset || 0;

  /* Endpoints of the dimension line (offset copies of a and b) */
  const dax = ax + px * off;
  const day = ay + py * off;
  const dbx = bx + px * off;
  const dby = by + py * off;

  /* Crosses at original measurement points */
  drawCross(ax, ay, '#e53935', crossSize, stroke);
  drawCross(bx, by, '#e53935', crossSize, stroke);

  /* Extension lines: from each original point to the dimension line.
     They are perpendicular to the dimension line by construction
     (they travel exactly along the px,py direction). */
  ctx.strokeStyle = '#e53935';
  ctx.lineWidth = stroke;
  ctx.beginPath();
  ctx.moveTo(ax, ay); ctx.lineTo(dax, day);
  ctx.moveTo(bx, by); ctx.lineTo(dbx, dby);
  ctx.stroke();

  /* Dimension line with arrow-tick caps */
  const capSize = crossSize * 0.9;
  ctx.strokeStyle = '#e53935';
  ctx.lineWidth = stroke * 1.2;
  ctx.beginPath();
  ctx.moveTo(dax, day); ctx.lineTo(dbx, dby);
  ctx.stroke();

  /* Arrowheads at each end of the dimension line, pointing outward.
     Each arrow is drawn as two lines forming a V shape.
     The arrow at da points in the -ux,-uy direction (away from b).
     The arrow at db points in the +ux,+uy direction (away from a).
     Wing angle: 25° each side of the shaft direction.
     Wing length: same as capSize. */
  const wingAngle = 0.436;   // 25 degrees in radians
  const cosW = Math.cos(wingAngle);
  const sinW = Math.sin(wingAngle);

  ctx.lineWidth = stroke;
  ctx.beginPath();

  /* Arrow at da — shaft points inward toward b (along +ux, +uy) */
  const daDirX = ux, daDirY = uy;
  /* Rotate wing +wingAngle */
  const da1x = dax + capSize * ( daDirX * cosW - daDirY * sinW);
  const da1y = day + capSize * ( daDirX * sinW + daDirY * cosW);
  /* Rotate wing -wingAngle */
  const da2x = dax + capSize * ( daDirX * cosW + daDirY * sinW);
  const da2y = day + capSize * (-daDirX * sinW + daDirY * cosW);
  ctx.moveTo(da1x, da1y); ctx.lineTo(dax, day); ctx.lineTo(da2x, da2y);

  /* Arrow at db — shaft points inward toward a (along -ux, -uy) */
  const dbDirX = -ux, dbDirY = -uy;
  const db1x = dbx + capSize * ( dbDirX * cosW - dbDirY * sinW);
  const db1y = dby + capSize * ( dbDirX * sinW + dbDirY * cosW);
  const db2x = dbx + capSize * ( dbDirX * cosW + dbDirY * sinW);
  const db2y = dby + capSize * (-dbDirX * sinW + dbDirY * cosW);
  ctx.moveTo(db1x, db1y); ctx.lineTo(dbx, dby); ctx.lineTo(db2x, db2y);

  ctx.stroke();

  /* Label: centred on the dimension line, rotated to be parallel */
  const midX = (dax + dbx) / 2;
  const midY = (day + dby) / 2;
  const angle = Math.atan2(dby - day, dbx - dax);   // radians

  const text = `${m.name}: ${m.mm.toFixed(1)} mm`;
  ctx.font = `bold ${fontSize}px sans-serif`;
  const metrics = ctx.measureText(text);
  const padX = 10 * k, padY = 6 * k;
  const w = metrics.width + padX * 2;
  const h = fontSize + padY * 2;

  ctx.save();
  ctx.translate(midX, midY);
  ctx.rotate(angle);

  /* Keep text readable: if the line points left (angle outside
     ±90°), flip 180° so the text never appears upside-down */
  if (angle > Math.PI / 2 || angle < -Math.PI / 2) {
    ctx.rotate(Math.PI);
  }

  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = '#e53935';
  ctx.lineWidth = 2 * k;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = '#e53935';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, 0, 0);

  ctx.restore();
}

/* ============================================================
   TOUCH AND MOUSE
   ============================================================ */
const TAP_THRESHOLD_PX = 10;
const TAP_MAX_MS = 500;

/* ============================================================
   DIMENSION HIT TEST
   ============================================================
   Returns the dimension whose dimension line (the offset parallel
   line, not the original measurement line) is closest to imgPoint,
   provided that point is within HIT_RADIUS image pixels of it.
   Returns null if no dimension qualifies.

   We test against the dimension LINE (infinite), then verify the
   foot of the perpendicular falls within the segment, to avoid
   triggering on extensions of the line beyond the endpoints.

   HIT_RADIUS is defined in screen pixels and converted to image
   pixels so the hit area stays the same physical size regardless
   of zoom level or photo resolution.
   ============================================================ */
const DIM_HIT_RADIUS_SCREEN_PX = 30;

function getDimAtPoint(imgPoint) {
  if (state.phase !== 'measure-idle') return null;

  /* Convert hit radius from screen px to image px */
  const hitRadius = DIM_HIT_RADIUS_SCREEN_PX * imagePerScreenPx() / state.scale;

  let best = null;
  let bestDist = Infinity;

  state.dimensions.forEach(m => {
    if (m.hidden) return;

    const ax = m.a.x, ay = m.a.y;
    const bx = m.b.x, by = m.b.y;
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1) return;

    /* Unit vectors along and perpendicular to the measurement line */
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    const px = -uy;
    const py =  ux;

    /* Centre of the dimension line (offset copy) */
    const off = m.dimOffset || 0;
    const dax = ax + px * off;
    const day = ay + py * off;
    const dbx = bx + px * off;
    const dby = by + py * off;

    /* Signed distance from imgPoint to the dimension line.
       Project imgPoint onto the perpendicular axis of the dim line. */
    const dx = imgPoint.x - dax;
    const dy = imgPoint.y - day;

    /* Perpendicular distance to the infinite line */
    const perpDist = Math.abs(dx * px + dy * py);
    if (perpDist > hitRadius) return;

    /* Parametric position along the dimension line segment (0=da, 1=db) */
    const t = (dx * ux + dy * uy) / len;
    /* Only register a hit if the foot falls within the segment
       (with a small margin so the endpoints are also hittable) */
    if (t < -0.05 || t > 1.05) return;

    if (perpDist < bestDist) {
      bestDist = perpDist;
      best = m;
    }
  });

  return best;
}

/* ============================================================
   TEXT STAMP HIT TEST
   ============================================================
   Returns the text annotation whose bounding box contains
   imgPoint, or null. Used to detect drag targets when the
   text tool is active.

   The bounding box is estimated from the same font size logic
   as redraw(), using a fixed characters-per-pixel approximation.
   We use imagePerScreenPx() to keep the hit area consistent
   regardless of zoom level, matching the visual size the user
   sees on screen.
   ============================================================ */
function getTextAtPoint(imgPoint) {
  const k = 1 / state.scale;
  const baseFontPx = baseFontSize() * k;

  for (let i = state.annotations.length - 1; i >= 0; i--) {
    const ann = state.annotations[i];
    if (ann.type !== 'text') continue;

    const tFontSize = ann.size === 'small'  ? baseFontPx * 0.8
                    : ann.size === 'large'  ? baseFontPx * 1.4
                    : baseFontPx;

    /* Approximate width: avg ~0.6× font size per character */
    const approxW = ann.label.length * tFontSize * 0.6 + tFontSize * 0.8;
    const approxH = tFontSize * 1.6;

    if (
      imgPoint.x >= ann.x - approxW / 2 &&
      imgPoint.x <= ann.x + approxW / 2 &&
      imgPoint.y >= ann.y - approxH / 2 &&
      imgPoint.y <= ann.y + approxH / 2
    ) {
      return ann;
    }
  }
  return null;
}

/* ============================================================
   DIMENSION DRAG — apply offset update
   ============================================================
   Called on every move event while a dimension is being dragged.
   Computes the displacement from the drag start position in image
   space, projects it onto the perpendicular axis of the dimension,
   and adds that projection to the stored start offset.

   Why project onto the perpendicular axis:
   The user may move their finger in any direction. Only the
   component of that movement that is perpendicular to the
   dimension line should change the offset — the parallel
   component just means the finger drifted sideways, which we
   deliberately ignore. This gives the same "guided" feel as
   dragging a dimension in CATIA.
   ============================================================ */
function applyDimDrag(imgPos) {
  const m = state.draggingDim;
  if (!m || !state.dragStartImgPos) return;

  const ax = m.a.x, ay = m.a.y;
  const bx = m.b.x, by = m.b.y;
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 1) return;

  /* Perpendicular unit vector (same convention as drawDimension) */
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  const px = -uy;
  const py =  ux;

  /* Displacement from drag start in image space */
  const ddx = imgPos.x - state.dragStartImgPos.x;
  const ddy = imgPos.y - state.dragStartImgPos.y;

  /* Project displacement onto the perpendicular axis */
  const perpDelta = ddx * px + ddy * py;

  m.dimOffset = state.dragStartOffset + perpDelta;
  redraw();
}

/* ============================================================
   ERASER HIT TEST
   ============================================================
   Removes any stroke annotation that passes within ERASE_RADIUS
   screen pixels of imgPos. Operates on whole strokes — clicking
   near any point of a stroke removes the entire stroke.
   ============================================================ */
/* ============================================================
   ANNOTATION HISTORY — undo / clear
   ============================================================
   pushAnnotationHistory() snapshots the current annotations
   array before any destructive action (new stroke, erase).
   undoAnnotation() restores the previous snapshot.
   clearAnnotations() wipes everything and saves a snapshot first.
   ============================================================ */
function pushAnnotationHistory() {
  state.annotationHistory.push(JSON.parse(JSON.stringify(state.annotations)));
}
function undoAnnotation() {
  if (state.annotationHistory.length === 0) return;
  state.annotations = state.annotationHistory.pop();
  state.currentStroke = null;
  redraw();
}
function clearAnnotations() {
  if (state.annotations.length === 0) return;
  pushAnnotationHistory();
  state.annotations = [];
  state.currentStroke = null;
  redraw();
}

function eraseAt(imgPos) {
  const eraseRadius = 15 * imagePerScreenPx() / state.scale;
  const before = state.annotations.length;
  state.annotations = state.annotations.filter(ann => {
    if (ann.type !== 'stroke') return true; // never erase text here
    return !ann.points.some(p =>
      Math.hypot(p.x - imgPos.x, p.y - imgPos.y) < eraseRadius
    );
  });
  if (state.annotations.length !== before) redraw();
}

function onTouchStart(evt) {
  evt.preventDefault();
  if (evt.touches.length === 2) {
    /* Two fingers always means zoom — cancel any active stroke first. */
    if (state.currentStroke) {
      state.currentStroke = null;
      redraw();
    }
    state.isPinching = true; state.isPanning = false;
    const t1 = evt.touches[0], t2 = evt.touches[1];
    state.pinchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    state.pinchStartScale = state.scale;
    state.pinchCenter = getCanvasCoord((t1.clientX + t2.clientX) / 2, (t1.clientY + t2.clientY) / 2);
  }
  else if (evt.touches.length === 1) {
    state.isPinching = false; state.isPanning = false;
    const t = evt.touches[0];
    state.touchStartTime = Date.now();
    state.touchStartPos = { x: t.clientX, y: t.clientY };
    state.panStart = { x: t.clientX, y: t.clientY, offsetX: state.offsetX, offsetY: state.offsetY };

    const imgPos = getImagePoint(t.clientX, t.clientY);

    
    
    /* Auto-detect: start rectangle drag or prepare for tap. */
    if (state.phase === 'detect-tap') {
      state.rectStart = imgPos;
      state.rectEnd   = imgPos;
      return;
    }

    /* Pen: start a new stroke. */
    if (state.penActive) {
      pushAnnotationHistory();
      state.currentStroke = {
        type: 'stroke', id: Date.now() + Math.random(),
        color: state.penColor, width: state.penWidth,
        points: [imgPos]
      };
      return;
    }

    /* Eraser: remove strokes that pass near this point. */
    if (state.eraserActive) {
      eraseAt(imgPos);
      return;
    }

    /* Check if the touch lands on a dimension line */
    const hit = getDimAtPoint(imgPos);
    if (hit) {
      state.draggingDim = hit;
      state.dragStartOffset = hit.dimOffset;
      state.dragStartImgPos = imgPos;
    }

    /* Text tool: check if touch lands on an existing text stamp to drag it */
    if (state.textActive) {
      const textHit = getTextAtPoint(imgPos);
      if (textHit) {
        state.draggingText = textHit;
        state.dragTextStartImgPos = imgPos;
        state.dragTextOrigin = { x: textHit.x, y: textHit.y };
      }
    }
  }
}
function onTouchMove(evt) {
  evt.preventDefault();
  if (evt.touches.length === 2 && state.isPinching) {
    const t1 = evt.touches[0], t2 = evt.touches[1];
    const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    zoomAt(state.pinchCenter.x, state.pinchCenter.y, state.pinchStartScale * (dist / state.pinchStartDist));
    redraw();
  }
  else if (evt.touches.length === 1 && !state.isPinching) {
    const t = evt.touches[0];
    const imgPos = getImagePoint(t.clientX, t.clientY);

    /* Auto-detect rectangle: update the dragged corner. */
    if (state.phase === 'detect-tap' && state.rectStart) {
      state.rectEnd = imgPos;
      redraw();
      return;
    }
    
    /* Pen: add point to current stroke. */
    if (state.penActive && state.currentStroke) {
      state.currentStroke.points.push(imgPos);
      redraw();
      return;
    }

    /* Eraser: erase continuously while dragging. */
    if (state.eraserActive) {
      eraseAt(imgPos);
      return;
    }

    /* Dimension drag takes priority over pan */
    if (state.draggingDim) {
      applyDimDrag(imgPos);
      return;
    }

    /* Text stamp drag */
    if (state.draggingText) {
      state.draggingText.x = state.dragTextOrigin.x + (imgPos.x - state.dragTextStartImgPos.x);
      state.draggingText.y = state.dragTextOrigin.y + (imgPos.y - state.dragTextStartImgPos.y);
      redraw();
      return;
    }

    const dx = t.clientX - state.touchStartPos.x;
    const dy = t.clientY - state.touchStartPos.y;
    if (Math.hypot(dx, dy) > TAP_THRESHOLD_PX && state.scale > 1.01) {
      state.isPanning = true;
      const rect = canvas.getBoundingClientRect();
      state.offsetX = state.panStart.offsetX + dx * (canvas.width  / rect.width);
      state.offsetY = state.panStart.offsetY + dy * (canvas.height / rect.height);
      clampOffset(); redraw();
    }
  }
}
function onTouchEnd(evt) {
  if (state.isPinching && evt.touches.length < 2) {
    state.isPinching = false;
    if (evt.touches.length === 1) {
      const t = evt.touches[0];
      state.touchStartTime = Date.now();
      state.touchStartPos = { x: t.clientX, y: t.clientY };
      state.panStart = { x: t.clientX, y: t.clientY, offsetX: state.offsetX, offsetY: state.offsetY };
    }
    state.mouseDown = false;
    return;
  }

  /* Auto-detect: if the finger moved enough, commit rectangle.
     If it barely moved (tap), run Canny detection instead. */
  if (state.phase === 'detect-tap' && state.rectStart) {
    const t = evt.changedTouches[0];
    const releaseImg = getImagePoint(t.clientX, t.clientY);
    const moved = Math.hypot(
      releaseImg.x - state.rectStart.x,
      releaseImg.y - state.rectStart.y
    );
    if (moved > TAP_THRESHOLD_PX) {
      commitRectDimensions();
    } else {
      const tapPoint = state.rectStart;
      state.rectStart = null;
      state.rectEnd   = null;
      runAutoDetect(tapPoint);
    }
    return;
  }
  
  /* Commit finished pen stroke. */
  if (state.currentStroke) {
    if (state.currentStroke.points.length > 1) {
      state.annotations.push(state.currentStroke);
    }
    state.currentStroke = null;
    redraw();
    return;
  }

  if (evt.touches.length === 0 && !state.isPanning && !state.isPinching) {
    const dt = Date.now() - state.touchStartTime;
    if (dt > TAP_MAX_MS) return;
    const t = evt.changedTouches[0];
    handleTap(getImagePoint(t.clientX, t.clientY));
  }
  state.isPanning = false;
  /* Dimension: if the finger didn't move, it's an edit tap — open the dim editor. */
  if (state.draggingDim && state.dragStartImgPos) {
    const t = evt.changedTouches[0];
    const releaseImg = getImagePoint(t.clientX, t.clientY);
    const moved = Math.hypot(
      releaseImg.x - state.dragStartImgPos.x,
      releaseImg.y - state.dragStartImgPos.y
    );
    const dim = state.draggingDim;
    state.draggingDim = null;
    state.dragStartImgPos = null;
    if (moved < TAP_THRESHOLD_PX) {
      openDimEditor(dim);
      return;
    }
  } else {
    state.draggingDim = null;
    state.dragStartImgPos = null;
  }
  /* Text stamp: if the finger didn't move, it's an edit tap — open the modal. */
  if (state.draggingText && state.dragTextStartImgPos) {
    const t = evt.changedTouches[0];
    const releaseImg = getImagePoint(t.clientX, t.clientY);
    const moved = Math.hypot(
      releaseImg.x - state.dragTextStartImgPos.x,
      releaseImg.y - state.dragTextStartImgPos.y
    );
    if (moved < TAP_THRESHOLD_PX) {
      openTextStampEditor(state.draggingText);
      state.draggingText = null;
      state.dragTextStartImgPos = null;
      state.dragTextOrigin = null;
      return;
    }
  }
  state.draggingText = null;
  state.dragTextStartImgPos = null;
  state.dragTextOrigin = null;
}
function onMouseDown(evt) {
  evt.preventDefault();
  state.mouseDown = true; state.isPanning = false;
  state.touchStartTime = Date.now();
  state.touchStartPos = { x: evt.clientX, y: evt.clientY };
  state.panStart = { x: evt.clientX, y: evt.clientY, offsetX: state.offsetX, offsetY: state.offsetY };

  const imgPos = getImagePoint(evt.clientX, evt.clientY);

  /* Auto-detect rectangle: start dragging. */
  if (state.phase === 'detect-tap') {
    state.rectStart = imgPos;
    state.rectEnd   = imgPos;
    return;
  }

  /* Pen: start a new stroke. mouseDown stays true so onMouseMove
     receives events; penActive + currentStroke guards the pen path. */
  if (state.penActive) {
    pushAnnotationHistory();
    state.currentStroke = {
      type: 'stroke', id: Date.now() + Math.random(),
      color: state.penColor, width: state.penWidth,
      points: [imgPos]
    };
    return;
  }

  /* Eraser: remove strokes near this point. */
  if (state.eraserActive) {
    eraseAt(imgPos);
    return;
  }

  /* Check if the pointer is on a dimension line. */
  const hit = getDimAtPoint(imgPos);
  if (hit) {
    state.draggingDim = hit;
    state.dragStartOffset = hit.dimOffset;
    state.dragStartImgPos = imgPos;
  }

  /* Text tool: check if pointer lands on an existing text stamp to drag it */
  if (state.textActive) {
    const textHit = getTextAtPoint(imgPos);
    if (textHit) {
      state.draggingText = textHit;
      state.dragTextStartImgPos = imgPos;
      state.dragTextOrigin = { x: textHit.x, y: textHit.y };
    }
  }
}
function onMouseMove(evt) {
  if (!state.mouseDown) return;

  const imgPos = getImagePoint(evt.clientX, evt.clientY);

  /* Auto-detect rectangle: update the dragged corner. */
  if (state.phase === 'detect-tap' && state.rectStart) {
    state.rectEnd = imgPos;
    redraw();
    return;
  }
  
  /* Pen: add point to current stroke — takes priority over everything. */
  if (state.penActive && state.currentStroke) {
    state.currentStroke.points.push(imgPos);
    redraw();
    return;
  }

  /* Eraser: erase continuously while dragging. */
  if (state.eraserActive) {
    eraseAt(imgPos);
    return;
  }

  /* Block pan entirely when a drawing tool is active. */
  if (state.penActive || state.eraserActive) return;

  /* Text stamp drag */
  if (state.draggingText) {
    const imgPos = getImagePoint(evt.clientX, evt.clientY);
    state.draggingText.x = state.dragTextOrigin.x + (imgPos.x - state.dragTextStartImgPos.x);
    state.draggingText.y = state.dragTextOrigin.y + (imgPos.y - state.dragTextStartImgPos.y);
    redraw();
    return;
  }
  /* Dimension drag takes priority over pan */
  if (state.draggingDim) {
    applyDimDrag(imgPos);
    return;
  }

  const dx = evt.clientX - state.touchStartPos.x;
  const dy = evt.clientY - state.touchStartPos.y;
  if (Math.hypot(dx, dy) > TAP_THRESHOLD_PX && state.scale > 1.01) {
    state.isPanning = true;
    const rect = canvas.getBoundingClientRect();
    state.offsetX = state.panStart.offsetX + dx * (canvas.width  / rect.width);
    state.offsetY = state.panStart.offsetY + dy * (canvas.height / rect.height);
    clampOffset(); redraw();
  }
}
function onMouseUp(evt) {
  if (!state.mouseDown) return;
  state.mouseDown = false;

  /* Auto-detect: if the pointer moved enough, commit rectangle.
     If it barely moved (click), run Canny detection instead. */
  if (state.phase === 'detect-tap' && state.rectStart) {
    const releaseImg = getImagePoint(evt.clientX, evt.clientY);
    const moved = Math.hypot(
      releaseImg.x - state.rectStart.x,
      releaseImg.y - state.rectStart.y
    );
    if (moved > TAP_THRESHOLD_PX) {
      commitRectDimensions();
    } else {
      const tapPoint = state.rectStart;
      state.rectStart = null;
      state.rectEnd   = null;
      runAutoDetect(tapPoint);
    }
    return;
  }
  
  /* Commit finished pen stroke. */
  if (state.currentStroke) {
    if (state.currentStroke.points.length > 1) {
      state.annotations.push(state.currentStroke);
    }
    state.currentStroke = null;
    redraw();
    return;
  }

  /* Dimension: if pointer didn't move, it's an edit tap — open the dim editor. */
  if (state.draggingDim && state.dragStartImgPos) {
    const releaseImg = getImagePoint(evt.clientX, evt.clientY);
    const moved = Math.hypot(
      releaseImg.x - state.dragStartImgPos.x,
      releaseImg.y - state.dragStartImgPos.y
    );
    const dim = state.draggingDim;
    state.draggingDim = null;
    state.dragStartImgPos = null;
    if (moved < TAP_THRESHOLD_PX) {
      openDimEditor(dim);
      return;
    }
    return;
  }

  /* End text stamp drag. If the pointer barely moved, treat as edit tap. */
  if (state.draggingText && state.dragTextStartImgPos) {
    const releaseImg = getImagePoint(evt.clientX, evt.clientY);
    const moved = Math.hypot(
      releaseImg.x - state.dragTextStartImgPos.x,
      releaseImg.y - state.dragTextStartImgPos.y
    );
    const ann = state.draggingText;
    state.draggingText = null;
    state.dragTextStartImgPos = null;
    state.dragTextOrigin = null;
    if (moved < TAP_THRESHOLD_PX) {
      openTextStampEditor(ann);
      return;
    }
    return;
  }

  if (state.isPanning) { state.isPanning = false; return; }
  const dx = evt.clientX - state.touchStartPos.x;
  const dy = evt.clientY - state.touchStartPos.y;
  if (Math.hypot(dx, dy) > TAP_THRESHOLD_PX) return;
  handleTap(getImagePoint(evt.clientX, evt.clientY));
}
function onWheel(evt) {
  evt.preventDefault();
  const c = getCanvasCoord(evt.clientX, evt.clientY);
  const factor = evt.deltaY < 0 ? 1.15 : 1 / 1.15;
  zoomAt(c.x, c.y, state.scale * factor); redraw();
}


/* ============================================================
   TAP HANDLER
   ============================================================ */
function handleTap(imgPoint) {
  /* Text stamp: save the tap point and open the modal to type the label. */
  if (state.textActive && state.phase === 'measure-idle') {
    state.pendingTextPoint = imgPoint;
    openTextStampEditor(null);
    return;
  }
  if (state.phase === 'calib-1') { state.calibPoints[0] = imgPoint; setPhase('calib-1-set'); }
  else if (state.phase === 'calib-1-set') { state.calibPoints[0] = imgPoint; redraw(); }
  else if (state.phase === 'calib-2') { state.calibPoints[1] = imgPoint; setPhase('calib-2-set'); }
  else if (state.phase === 'calib-2-set') { state.calibPoints[1] = imgPoint; redraw(); }
  else if (state.phase === 'measure-1-empty') { state.pendingA = imgPoint; setPhase('measure-1'); }
  else if (state.phase === 'measure-1') { state.pendingA = imgPoint; redraw(); }
  else if (state.phase === 'measure-2-empty') { state.pendingB = imgPoint; setPhase('measure-2'); }
  else if (state.phase === 'measure-2') { state.pendingB = imgPoint; redraw(); }
}


/* ============================================================
   ZOOM RESET + CLEAN MODE
   ============================================================ */
fabFit.addEventListener('click', () => { resetZoom(); redraw(); });
fabExitClean.addEventListener('click', () => {
  document.body.classList.remove('clean');
  redraw();
});


/* ============================================================
   VIEW ORIGINAL BUTTON
   ============================================================
   Shows the un-rectified photo while the button is held down,
   and returns to the rectified view when released. This is the
   standard "before / after" pattern from mobile photo editors.

   Three pointer events are needed to guarantee the flag is
   always cleared:
     - touchend / touchcancel for mobile (finger lifts or is
       interrupted by a system gesture or incoming call).
     - mouseup for desktop (normal release).
     - mouseleave for desktop edge-case: user holds the button,
       drags the cursor out of the button area, then releases.
       Without this handler the flag would stay true until the
       next explicit mouseup on the button.

   We do NOT use the pointer events API here intentionally:
   pointerleave fires on every child element crossing, which
   is noisy; mouse + touch is cleaner for this specific case.
   ============================================================ */
function startViewOriginal() {
  if (!state.originalPhoto) return;
  state.viewingOriginal = true;
  redraw();
}
function stopViewOriginal() {
  if (!state.viewingOriginal) return;
  state.viewingOriginal = false;
  redraw();
}

const fabViewOriginal = document.getElementById('fab-view-original');
fabViewOriginal.addEventListener('mousedown',   startViewOriginal);
fabViewOriginal.addEventListener('mouseup',     stopViewOriginal);
fabViewOriginal.addEventListener('mouseleave',  stopViewOriginal);
fabViewOriginal.addEventListener('touchstart',
  (e) => { e.preventDefault(); startViewOriginal(); }, { passive: false });
fabViewOriginal.addEventListener('touchend',    stopViewOriginal);
fabViewOriginal.addEventListener('touchcancel', stopViewOriginal);

/* ============================================================
   ACCURACY LENS MAP (phase 12)
   ============================================================
   buildHeatmapCanvas() pre-computes a radial gradient canvas
   the same size as the photo. The gradient runs continuously
   from green at the image centre to red at the corners, with
   yellow passing through the 70% safe-zone radius. It is built
   once per photo load and cached in state.heatmapCanvas.

   The overlay is drawn in redraw() only while state.viewingHeatmap
   is true — i.e. while the user holds the button — using
   globalAlpha so the photo remains visible underneath.
   It is never drawn in exportMode.
   ============================================================ */
function buildHeatmapCanvas() {
  const w = canvas.width;
  const h = canvas.height;
  const offscreen = document.createElement('canvas');
  offscreen.width  = w;
  offscreen.height = h;
  const octx = offscreen.getContext('2d');

  /* Centre of the image — this is where the optical axis of the
     camera points, so it is the point of least lens distortion. */
  const cx = w / 2;
  const cy = h / 2;

  /* The gradient radius must reach AT LEAST the farthest corner
     of the image (the semi-diagonal), so no corner is left
     uncoloured. */
  const semiDiag = Math.hypot(cx, cy);

  /* The 70% safe-zone radius — not a circle but a fraction of the
     semi-diagonal, which matches how the error model is documented:
     error grows from centre outward regardless of direction. */
  const safeRadius = semiDiag * SAFE_ZONE_RATIO;

  const grad = octx.createRadialGradient(cx, cy, 0, cx, cy, semiDiag);

  /* Stop positions are fractions of semiDiag (0 = centre, 1 = corner).
     The three colours carry their own alpha so the photo shows through
     even before globalAlpha is applied in redraw(). */
  grad.addColorStop(0,                              'rgba(0, 200, 80, 0.55)');   // green  — centre
  grad.addColorStop(safeRadius / semiDiag,          'rgba(255, 220, 0, 0.55)'); // yellow — 70% boundary
  grad.addColorStop(1,                              'rgba(220, 30, 30, 0.65)'); // red    — corners

  octx.fillStyle = grad;
  octx.fillRect(0, 0, w, h);

  state.heatmapCanvas = offscreen;
}

function startViewHeatmap() {
  if (!state.photo) return;
  if (!state.heatmapCanvas) buildHeatmapCanvas();
  state.viewingHeatmap = true;
  redraw();
}
function stopViewHeatmap() {
  if (!state.viewingHeatmap) return;
  state.viewingHeatmap = false;
  redraw();
}

const fabHeatmap = document.getElementById('fab-heatmap');
fabHeatmap.addEventListener('mousedown',   startViewHeatmap);
fabHeatmap.addEventListener('mouseup',     stopViewHeatmap);
fabHeatmap.addEventListener('mouseleave',  stopViewHeatmap);
fabHeatmap.addEventListener('touchstart',
  (e) => { e.preventDefault(); startViewHeatmap(); }, { passive: false });
fabHeatmap.addEventListener('touchend',    stopViewHeatmap);
fabHeatmap.addEventListener('touchcancel', stopViewHeatmap);

/* ============================================================
   ONBOARDING
   ============================================================ */
document.getElementById('onboard-ok').addEventListener('click', () => {
  modalOnboard.classList.remove('show');
});
document.getElementById('scale-set-ok').addEventListener('click', () => {
  modalScaleSet.classList.remove('show');
});


/* ============================================================
   CALIBRATION
   ============================================================ */
function openCalibModal(forEditing = false) {
  state.editingReference = forEditing;
  document.getElementById('calib-modal-title').textContent =
    forEditing ? 'Edit reference value' : 'Reference distance';

  if (forEditing && state.mmPerPixel) {
    const [a, b] = state.calibPoints;
    const pixels = Math.hypot(b.x - a.x, b.y - a.y);
    mmInput.value = (pixels * state.mmPerPixel).toFixed(2);
  } else {
    mmInput.value = '';
  }
  modalCalib.classList.add('show');
  setTimeout(() => { mmInput.focus(); mmInput.select(); }, 100);
}

function confirmCalibration() {
  const mm = parseFloat(mmInput.value);
  if (!mm || mm <= 0) { alert('Enter a valid number in mm'); return; }

  const [a, b] = state.calibPoints;
  const pixels = Math.hypot(b.x - a.x, b.y - a.y);
  const newMmPerPixel = mm / pixels;

  if (state.editingReference && state.dimensions.length > 0) {
    state.dimensions.forEach(d => {
      const px = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y);
      d.mm = px * newMmPerPixel;
    });
    renderPanelList();
  }

  state.mmPerPixel = newMmPerPixel;
  modalCalib.classList.remove('show');

  if (state.editingReference) {
    state.editingReference = false;
    setPhase('measure-idle');
  } else {
    setPhase('measure-idle');
    document.getElementById('scale-set-text').textContent =
      `Scale: ${state.mmPerPixel.toFixed(3)} mm/pixel.`;
    modalScaleSet.classList.add('show');
    /* Phase 21: run ONNX detection after manual calibration too.
       The inspector may not have a marker but still wants to know
       what type of damage is in the photo. */
    if (ONNX_ENABLED) runOnnxDetection();
  }
}


/* ============================================================
   EDIT REFERENCE
   ============================================================ */
badge.addEventListener('click', () => {
  if (state.mmPerPixel) modalEditRef.classList.add('show');
});
document.getElementById('edit-ref-value').addEventListener('click', () => {
  modalEditRef.classList.remove('show');
  openCalibModal(true);
});
document.getElementById('edit-ref-points').addEventListener('click', () => {
  modalEditRef.classList.remove('show');
  state.calibPoints = [];
  state.editingReference = true;
  setPhase('calib-1');
});
document.getElementById('edit-ref-cancel').addEventListener('click', () => {
  modalEditRef.classList.remove('show');
});


/* ============================================================
   START NEW
   ============================================================ */
btnNewProject.addEventListener('click', () => {
  modalNewProject.classList.add('show');
});
document.getElementById('new-cancel').addEventListener('click', () => {
  modalNewProject.classList.remove('show');
});
document.getElementById('new-confirm').addEventListener('click', () => {
  modalNewProject.classList.remove('show');
  state.photo = null;
  state.originalPhoto = null;
  state.calibPoints = [];
  state.dimensions = [];
  state.mmPerPixel = null;
  state.calibTilted = false;
  state.calibMarkerId = null;
  state.calibMarkerCorners = null;
  state.allDetectedMarkers = [];
  state.pendingA = null;
  state.pendingB = null;
  state.dimCounter = 0;
  state.editingReference = false;
  resetZoom();
  setPhase('init');
});


/* ============================================================
   TILTED PHOTO MODAL — handlers (Edición B)
   ============================================================
   Two paths out of the modal:

   - Retake: discard the photo entirely and go back to the
     welcome screen. The user picks a new photo and the auto-
     calibration runs again from scratch.

   - Continue under my responsibility: apply the detected
     marker as the scale anyway, passing tilted=true so the
     badge turns red with a ⚠ as a persistent reminder that
     measurements may be off.

   In both cases we clear state.pendingMarker — it has done
   its job carrying the marker across the modal interaction.
   ============================================================ */
document.getElementById('tilted-retake').addEventListener('click', () => {
  document.getElementById('modal-tilted').classList.remove('show');
  state.pendingMarker = null;
  state.photo = null;
  resetZoom();
  setPhase('init');
});

document.getElementById('tilted-continue').addEventListener('click', () => {
  document.getElementById('modal-tilted').classList.remove('show');
  const marker = state.pendingMarker;
  state.pendingMarker = null;
  if (marker) applyAutoCalibration(marker, true);
});

/* ============================================================
   DIMENSION EDITOR
   ============================================================
   Opens the rename modal pre-filled with the dimension's current
   name. The delete button is always shown. Rename-ok updates the
   name in place; delete removes the dimension entirely.
   Same interaction pattern as the text stamp editor.
   ============================================================ */
function openDimEditor(dim) {
  state.renamingId = dim.id;
  renameInput.value = dim.name;
  document.getElementById('modal-rename').classList.add('show');
  setTimeout(() => { renameInput.focus(); renameInput.select(); }, 100);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ============================================================
   SAVE / SHARE
   ============================================================ */
function exportImage(callback) {
  const savedScale = state.scale, savedOffX = state.offsetX, savedOffY = state.offsetY;
  /* Switch to "image-proportional" sizing while exporting, so the
     saved JPEG has nicely visible marks regardless of resolution.
     Then we switch back to screen-proportional for interactive use. */
  exportMode = true;
  resetZoom(); redraw(); callback();
  exportMode = false;
  state.scale = savedScale; state.offsetX = savedOffX; state.offsetY = savedOffY;
  updateFabFit(); redraw();
}

/* ============================================================
   PHASE MACHINE
   ============================================================ */
function setPhase(newPhase) {
  state.phase = newPhase;
  canvas.removeEventListener('touchstart', onTouchStart);
  canvas.removeEventListener('touchmove',  onTouchMove);
  canvas.removeEventListener('touchend',   onTouchEnd);
  canvas.removeEventListener('mousedown',  onMouseDown);
  canvas.removeEventListener('mousemove',  onMouseMove);
  canvas.removeEventListener('mouseup',    onMouseUp);
  canvas.removeEventListener('wheel',      onWheel);

  if (newPhase !== 'init') {
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove',  onTouchMove,  { passive: false });
    canvas.addEventListener('touchend',   onTouchEnd,   { passive: false });
    canvas.addEventListener('mousedown',  onMouseDown);
    canvas.addEventListener('mousemove',  onMouseMove);
    canvas.addEventListener('mouseup',    onMouseUp);
    canvas.addEventListener('wheel',      onWheel, { passive: false });
  }

  welcome.style.display = (newPhase === 'init') ? 'block' : 'none';
  canvas.style.display  = (newPhase === 'init') ? 'none'  : 'block';
  hint.style.display    = (newPhase === 'init') ? 'none'  : 'block';
  controls.style.display= (newPhase === 'init') ? 'none'  : 'flex';

  /* Auto-open the left panel the first time a photo reaches
     measure-idle so the user sees tools and instructions without
     having to find the tab. Only fires once (no dimensions yet).
     On init, make sure the panel is always closed. */
  if (newPhase === 'init') {
    leftPanel.classList.remove('show');
    panelBackdrop.classList.remove('show');
  }

  if (state.mmPerPixel) {
    badge.style.display = 'inline-flex';
    /* Build badge text. Three pieces of state combine here:
       - state.calibMarkerId: which ArUco marker was used (null if manual)
       - state.calibTilted:   user accepted a tilted-marker calibration
       - state.mmPerPixel:    the scale itself
       We show the ID only when it exists (i.e. came from auto detection).
       We prefix a ⚠ and switch to red when the calibration was tilted. */
    const idPart    = (state.calibMarkerId != null) ? `ID ${state.calibMarkerId} — ` : '';
    const tiltedPart = state.calibTilted ? '⚠ ' : '';
    badge.textContent = `${tiltedPart}${idPart}${state.mmPerPixel.toFixed(3)} mm/px`;
    badge.style.background = state.calibTilted
      ? 'rgba(231, 76, 60, 0.95)'
      : 'rgba(255, 235, 59, 0.9)';
    badge.style.color = state.calibTilted ? '#fff' : '#000';
  } else {
    badge.style.display = 'none';
  }

  updateButtons();
  updateHint();
  if (newPhase !== 'init') redraw();
}

function updateButtons() {
  /* Toolbar buttons */
  [btnNewProject, btnConfirmPoint, btnConfirmMeas,
   btnCancelMeas, btnAutoDetect, btnAddDim]
    .forEach(b => b.style.display = 'none');

  /* Left-panel secondary buttons */
  [btnCleanPanel, btnSavePanel, btnSharePanel, btnReportPanel]
    .forEach(b => b.style.display = 'none');

  /* Floating view-original button */
  fabViewOriginal.style.display = 'none';

  /* Show annotation tools section whenever a photo is loaded */
  const annTools = document.getElementById('annotation-tools');
  if (annTools) annTools.style.display = (state.phase === 'init') ? 'none' : 'block';

  if (state.phase === 'init') return;

  btnNewProject.style.display  = 'block';
  btnReportPanel.style.display = 'block';

  if (state.phase === 'calib-1-set' || state.phase === 'calib-2-set') {
    btnConfirmPoint.style.display = 'block';
  }
  else if (state.phase === 'measure-idle') {
    btnAutoDetect.style.display      = state.calibMarkerId != null ? 'block' : 'none';
    btnAddDim.style.display          = 'block';
    btnCleanPanel.style.display      = 'block';
    btnSavePanel.style.display       = 'block';
    btnSharePanel.style.display      = 'block';
    btnReportPanel.style.display     = 'block';
    if (state.originalPhoto) fabViewOriginal.style.display = 'block';
    fabHeatmap.style.display = 'block';
  }
  else if (state.phase === 'detect-tap') {
    btnCancelMeas.style.display = 'block';
  }
  else if (state.phase === 'measure-1-empty') {
    btnCancelMeas.style.display = 'block';
  }
  else if (state.phase === 'measure-1') {
    btnConfirmPoint.style.display = 'block';
    btnCancelMeas.style.display   = 'block';
  }
  else if (state.phase === 'measure-2-empty') {
    btnCancelMeas.style.display = 'block';
  }
  else if (state.phase === 'measure-2') {
    btnConfirmMeas.style.display = 'block';
    btnCancelMeas.style.display  = 'block';
  }
}

function updateHint() {
  /* hint-action class: green border + text, used for phases
     that require an active gesture from the inspector. */
  const isAction = (
    state.phase === 'detect-tap'      ||
    state.phase === 'measure-1-empty' ||
    state.phase === 'measure-1'       ||
    state.phase === 'measure-2-empty' ||
    state.phase === 'measure-2'       ||
    state.phase === 'calib-1'         ||
    state.phase === 'calib-1-set'     ||
    state.phase === 'calib-2'         ||
    state.phase === 'calib-2-set'
  );
  hint.classList.toggle('hint-action', isAction);

  if (state.phase === 'calib-1') {
    hint.textContent = state.editingReference
      ? 'Re-picking reference. Tap the first reference point.'
      : 'Tap the first reference point. Pinch / wheel to zoom for accuracy.';
  } else if (state.phase === 'calib-1-set') {
    hint.textContent = 'Tap to reposition, or confirm the first point.';
  } else if (state.phase === 'calib-2') {
    hint.textContent = 'Tap the second reference point.';
  } else if (state.phase === 'calib-2-set') {
    hint.textContent = 'Tap to reposition, or confirm to set the scale.';
  } else if (state.phase === 'measure-idle') {
    const visible = state.dimensions.filter(m => !m.hidden).length;
    const total = state.dimensions.length;
    if (total === 0) hint.textContent = 'Scale is set. Use 🎯 Auto-detect or ➕ Add manual dim to measure.';
    else if (visible === total) hint.textContent = `${total} dimension${total > 1 ? 's' : ''} placed.`;
    else hint.textContent = `${visible}/${total} visible.`;
  } else if (state.phase === 'detect-tap') {
    hint.textContent = '🎯 Draw a rectangle over the object to measure — tap and drag without lifting.';
  } else if (state.phase === 'measure-1-empty') {
    hint.textContent = 'Tap the first endpoint of the dimension.';
  } else if (state.phase === 'measure-1') {
    hint.textContent = 'Tap to reposition the first endpoint, or confirm.';
  } else if (state.phase === 'measure-2-empty') {
    hint.textContent = 'Tap the second endpoint.';
  } else if (state.phase === 'measure-2') {
    hint.textContent = 'Tap to reposition the second endpoint, or close the dimension.';
  }
}


/* ============================================================
   ADD DIMENSION + CONFIRMATIONS
   ============================================================ */

/* ============================================================
   COMMIT RECTANGLE DIMENSIONS (phase 15)
   ============================================================
   Called when the inspector releases the drag in detect-tap
   mode. Creates two dimensions from the rectangle: one for
   the horizontal extent (Width) and one for the vertical
   extent (Height). Both are added directly to state.dimensions
   without going through the measure-1/2 flow.

   The dimension lines are offset outward from the rectangle
   edges so they don't overlap the object:
   - Width dimension: offset upward (negative Y direction)
   - Height dimension: offset to the right (positive X direction)

   If the rectangle is degenerate (either side < 1 px), the
   function does nothing and returns to measure-idle silently.
   ============================================================ */
function commitRectDimensions() {
  const a = state.rectStart;
  const b = state.rectEnd;
  state.rectStart = null;
  state.rectEnd   = null;

  if (!a || !b) { setPhase('measure-idle'); return; }

  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x, b.x);
  const y2 = Math.max(a.y, b.y);

  if ((x2 - x1) < 1 || (y2 - y1) < 1) { setPhase('measure-idle'); return; }

  const proposal = suggestDamageEndpointsInRect(x1, y1, x2, y2);

  if (proposal) {
    /* Store proposal for the modal handlers and open the modal.
       We stay in detect-tap phase until the user picks an option. */
    state.pendingRectProposal = proposal;
    document.getElementById('modal-rect-measure').classList.add('show');
    return;
  }

  /* Canny found nothing inside the rectangle — return to idle
     without creating any dimension. The inspector can retry with
     a different rectangle or switch to manual flow. */
  console.log('Rect auto-detect found nothing — returning to idle.');
  setPhase('measure-idle');
}

/* Creates W and H dimensions from a raw rectangle.
   Used as fallback when Canny finds nothing inside the rect. */
function addRectFallbackDimensions(x1, y1, x2, y2) {
  const w = x2 - x1;
  const h = y2 - y1;

  state.dimCounter++;
  state.dimensions.push({
    id: Date.now() + Math.random(),
    name: `W${state.dimCounter}`,
    a: { x: x1, y: y2 },
    b: { x: x2, y: y2 },
    mm: w * state.mmPerPixel,
    hidden: false,
    dimOffset: -Math.round(h * 0.18 + 40)
  });

  state.dimCounter++;
  state.dimensions.push({
    id: Date.now() + Math.random(),
    name: `H${state.dimCounter}`,
    a: { x: x2, y: y1 },
    b: { x: x2, y: y2 },
    mm: h * state.mmPerPixel,
    hidden: false,
    dimOffset: Math.round(w * 0.18 + 40)
  });

  setPhase('measure-idle');
}

/* ============================================================
   RECT-MEASURE MODAL HANDLERS
   ============================================================ */
function closeRectMeasureModal() {
  document.getElementById('modal-rect-measure').classList.remove('show');
  state.pendingRectProposal = null;
  setPhase('measure-idle');
}

document.getElementById('rect-measure-width').addEventListener('click', () => {
  const p = state.pendingRectProposal;
  document.getElementById('modal-rect-measure').classList.remove('show');
  state.pendingRectProposal = null;
  if (!p) { setPhase('measure-idle'); return; }

  const rr = p.rotatedRect;
  state.dimCounter++;
  state.dimensions.push({
    id: Date.now() + Math.random(),
    name: `W${state.dimCounter}`,
    a: rr.vertices[0],   // TL of object
    b: rr.vertices[1],   // TR of object
    mm: rr.widthMm,
    hidden: false,
    dimOffset: -Math.round(rr.heightMm / state.mmPerPixel * 0.18 + 40)
  });
  setPhase('measure-idle');
});

document.getElementById('rect-measure-height').addEventListener('click', () => {
  const p = state.pendingRectProposal;
  document.getElementById('modal-rect-measure').classList.remove('show');
  state.pendingRectProposal = null;
  if (!p) { setPhase('measure-idle'); return; }

  const rr = p.rotatedRect;
  state.dimCounter++;
  state.dimensions.push({
    id: Date.now() + Math.random(),
    name: `H${state.dimCounter}`,
    a: rr.vertices[1],   // TR of object
    b: rr.vertices[2],   // BR of object
    mm: rr.heightMm,
    hidden: false,
    dimOffset: Math.round(rr.widthMm / state.mmPerPixel * 0.18 + 40)
  });
  setPhase('measure-idle');
});

document.getElementById('rect-measure-both').addEventListener('click', () => {
  const p = state.pendingRectProposal;
  document.getElementById('modal-rect-measure').classList.remove('show');
  state.pendingRectProposal = null;
  if (!p) { setPhase('measure-idle'); return; }

  const rr = p.rotatedRect;

  state.dimCounter++;
  state.dimensions.push({
    id: Date.now() + Math.random(),
    name: `W${state.dimCounter}`,
    a: rr.vertices[0],   // TL of object
    b: rr.vertices[1],   // TR of object
    mm: rr.widthMm,
    hidden: false,
    dimOffset: -Math.round(rr.heightMm / state.mmPerPixel * 0.18 + 40)
  });

  state.dimCounter++;
  state.dimensions.push({
    id: Date.now() + Math.random(),
    name: `H${state.dimCounter}`,
    a: rr.vertices[1],   // TR of object
    b: rr.vertices[2],   // BR of object
    mm: rr.heightMm,
    hidden: false,
    dimOffset: Math.round(rr.widthMm / state.mmPerPixel * 0.18 + 40)
  });

  setPhase('measure-idle');
});

document.getElementById('rect-measure-diagonal').addEventListener('click', () => {
  const p = state.pendingRectProposal;
  document.getElementById('modal-rect-measure').classList.remove('show');
  state.pendingRectProposal = null;
  if (!p || !p.diagonal) { setPhase('measure-idle'); return; }

  const pixels = Math.hypot(
    p.diagonal.b.x - p.diagonal.a.x,
    p.diagonal.b.y - p.diagonal.a.y
  );
  state.dimCounter++;
  state.dimensions.push({
    id: Date.now() + Math.random(),
    name: `Diag ${state.dimCounter}`,
    a: p.diagonal.a,
    b: p.diagonal.b,
    mm: pixels * state.mmPerPixel,
    hidden: false,
    dimOffset: DIM_OFFSET_DEFAULT
  });
  setPhase('measure-idle');
});

document.getElementById('rect-measure-cancel').addEventListener('click', closeRectMeasureModal);

  

   btnAutoDetect.addEventListener('click', () => {
  state.pendingA = null; state.pendingB = null;
  setPhase('detect-tap');
});

btnAddDim.addEventListener('click', () => {
  state.pendingA = null; state.pendingB = null;
  setPhase('measure-1-empty');
});

btnConfirmPoint.addEventListener('click', () => {
  if (state.phase === 'calib-1-set') setPhase('calib-2');
  else if (state.phase === 'calib-2-set') openCalibModal(state.editingReference);
  else if (state.phase === 'measure-1') setPhase('measure-2-empty');
});

btnConfirmMeas.addEventListener('click', () => {
  if (!state.pendingA || !state.pendingB) return;
  const a = state.pendingA, b = state.pendingB;
  const pixels = Math.hypot(b.x - a.x, b.y - a.y);
  const mm = pixels * state.mmPerPixel;
  state.dimCounter++;
  state.dimensions.push({
    id: Date.now() + Math.random(),
    name: `Dim ${state.dimCounter}`,
    a, b, mm,
    hidden: false,
    dimOffset: DIM_OFFSET_DEFAULT   // perpendicular offset of the dimension line, in image px
  });
  state.pendingA = null; state.pendingB = null;
  setPhase('measure-idle');
});

btnCancelMeas.addEventListener('click', () => {
  state.pendingA = null; state.pendingB = null;
  setPhase('measure-idle');
});


/* ============================================================
   MODALS
   ============================================================ */
document.getElementById('calib-ok').addEventListener('click', confirmCalibration);
document.getElementById('calib-cancel').addEventListener('click', () => {
  modalCalib.classList.remove('show');
  state.editingReference = false;
});

document.getElementById('rename-ok').addEventListener('click', () => {
  const newName = renameInput.value.trim();
  if (!newName) { alert('Name cannot be empty'); return; }
  const m = state.dimensions.find(x => x.id === state.renamingId);
  if (m) m.name = newName;
  modalRename.classList.remove('show');
  state.renamingId = null;
  redraw();
});
document.getElementById('rename-cancel').addEventListener('click', () => {
  modalRename.classList.remove('show');
  state.renamingId = null;
});
document.getElementById('rename-delete').addEventListener('click', () => {
  if (state.renamingId == null) return;
  state.dimensions = state.dimensions.filter(x => x.id !== state.renamingId);
  modalRename.classList.remove('show');
  state.renamingId = null;
  redraw(); updateHint();
});

renameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('rename-ok').click();
});
mmInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('calib-ok').click();
});

/* Opens the text stamp modal in edit mode for an existing annotation,
   or in create mode when ann is null (called from handleTap). */
function openTextStampEditor(ann) {
  state.editingTextAnn = ann;
  const input = document.getElementById('text-stamp-input');
  input.value = ann ? ann.label : '';
  /* Show the delete button only when editing an existing stamp. */
  document.getElementById('text-stamp-delete').hidden = !ann;
  document.getElementById('modal-text-stamp').classList.add('show');
  setTimeout(() => { input.focus(); input.select(); }, 100);
}

function closeTextStampModal() {
  state.pendingTextPoint = null;
  state.editingTextAnn = null;
  document.getElementById('modal-text-stamp').classList.remove('show');
}

function deleteEditingTextStamp() {
  if (!state.editingTextAnn) return;
  pushAnnotationHistory();
  state.annotations = state.annotations.filter(a => a.id !== state.editingTextAnn.id);
  closeTextStampModal();
  redraw();
}

document.getElementById('text-stamp-ok').addEventListener('click', () => {
  const label = document.getElementById('text-stamp-input').value.trim();
  if (state.editingTextAnn && !label) {
    /* Empty text while editing = delete the stamp. */
    deleteEditingTextStamp();
    return;
  }
  if (!label) { document.getElementById('text-stamp-input').focus(); return; }
  pushAnnotationHistory();
  if (state.editingTextAnn) {
    /* Edit mode: update the existing annotation in place. */
    state.editingTextAnn.label = label;
    state.editingTextAnn = null;
  } else {
    /* Create mode: add a new annotation at the tapped point. */
    state.annotations.push({
      type: 'text',
      id: String(Date.now() + Math.random()),
      x: state.pendingTextPoint.x,
      y: state.pendingTextPoint.y,
      label,
      color: state.penColor,
      size: state.textSize
    });
    state.pendingTextPoint = null;
  }
  document.getElementById('modal-text-stamp').classList.remove('show');
  redraw();
});
document.getElementById('text-stamp-delete').addEventListener('click', deleteEditingTextStamp);
document.getElementById('text-stamp-cancel').addEventListener('click', closeTextStampModal);
document.getElementById('text-stamp-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('text-stamp-ok').click();
});

/* ============================================================
   LEFT PANEL — open / close + secondary action buttons
   ============================================================ */

function openLeftPanel() {
  leftPanel.classList.add('show');
  panelBackdrop.classList.add('show');
  document.getElementById('left-panel-tab').style.display = 'none';
}
function closeLeftPanel() {
  leftPanel.classList.remove('show');
  document.getElementById('left-panel-tab').style.display = '';
  panelBackdrop.classList.remove('show');
}

leftPanelClose.addEventListener('click', closeLeftPanel);
document.getElementById('left-panel-tab').addEventListener('click', openLeftPanel);

/* Reuse the existing backdrop to close whichever panel is open */
panelBackdrop.addEventListener('click', () => {
  closeLeftPanel();
});

/* Secondary buttons inside the left panel — same logic as the
   original toolbar buttons they replace */

btnCleanPanel.addEventListener('click', () => {
  closeLeftPanel();
  document.body.classList.add('clean');
  redraw();
});

btnSavePanel.addEventListener('click', () => {
  closeLeftPanel();
  exportImage(() => {
    const link = document.createElement('a');
    link.download = `dimensions-${Date.now()}.jpg`;
    link.href = canvas.toDataURL('image/jpeg', 0.92);
    link.click();
  });
});
btnSharePanel.addEventListener('click', () => {
  closeLeftPanel();
  exportImage(() => {
    canvas.toBlob(async (blob) => {
      const filename = `dimensions-${Date.now()}.jpg`;
      const file = new File([blob], filename, { type: 'image/jpeg' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Dimensions', text: 'Damage documentation' }); }
        catch (err) { /* cancelled */ }
      } else {
        const link = document.createElement('a');
        link.download = filename;
        link.href = URL.createObjectURL(blob);
        link.click();
        URL.revokeObjectURL(link.href);
      }
    }, 'image/jpeg', 0.92);
  });
});

/* ============================================================
   STEREO MODULE — PHASE 18
   ============================================================
   Experimental depth / height estimation from 2–4 photos.
   Entirely self-contained: opens its own overlay, manages its
   own photo loading, and closes cleanly without touching the
   main measurement state.
   ============================================================ */

/* ---------- constants ---------- */
/* Minimum baseline as a fraction of the estimated camera-to-
   surface distance. Below this the triangulation is too noisy. */
const STEREO_MIN_BASELINE_RATIO = 0.05;
/* Maximum photos allowed in one stereo session. */
const STEREO_MAX_PHOTOS = 4;
/* localStorage key for "don't show instructions again" flag. */
const STEREO_HIDE_KEY = 'stereoHideInstructions';

/* ---------- module state ---------- */
/* stereoPhotos: array of objects, one per loaded photo.
   Each entry: { img, marker }
     img    — HTMLImageElement or HTMLCanvasElement (after undistort)
     marker — result.best from detectArucoMarker (corners, mmPerPixel…)
*/
let stereoPhotos = [];
let stereoRoiRect = null;   // {x, y, w, h} in image-space pixels of photo 1

/* ---------- entry point ---------- */
document.getElementById('btn-stereo-panel').addEventListener('click', () => {
  closeLeftPanel();
  stereoPhotos = [];

  const hide = localStorage.getItem(STEREO_HIDE_KEY) === '1';
  if (hide) {
    openStereoOverlay();
  } else {
    document.getElementById('modal-stereo-instructions').classList.add('show');
  }
});

/* Instructions modal — OK */
document.getElementById('stereo-instructions-ok').addEventListener('click', () => {
  if (document.getElementById('stereo-hide-instructions').checked) {
    localStorage.setItem(STEREO_HIDE_KEY, '1');
  }
  document.getElementById('modal-stereo-instructions').classList.remove('show');
  openStereoOverlay();
});

/* Instructions modal — Cancel */
document.getElementById('stereo-instructions-cancel').addEventListener('click', () => {
  document.getElementById('modal-stereo-instructions').classList.remove('show');
});

/* Close button inside the overlay */
document.getElementById('stereo-close').addEventListener('click', closeStereoOverlay);

/* ---------- overlay open / close ---------- */
function openStereoOverlay() {
  stereoPhotos = [];
  document.getElementById('stereo-overlay').style.display = 'flex';
  renderStereoSlots();
}

function closeStereoOverlay() {
  document.getElementById('stereo-overlay').style.display = 'none';
  document.getElementById('stereo-step-area').innerHTML = '';
  document.getElementById('stereo-photos-status').textContent = '';
  document.getElementById('stereo-action-buttons').style.display = 'none';
  document.getElementById('stereo-roi-section').style.display = 'none';
  stereoPhotos  = [];
  stereoRoiRect = null;
}

/* ---------- slot rendering ---------- */
/* Rebuilds the stereo-step-area to show one card per loaded photo
   plus one "load next" card if fewer than STEREO_MAX_PHOTOS. */
function renderStereoSlots() {
  const area = document.getElementById('stereo-step-area');
  area.innerHTML = '';

  /* Cards for photos already loaded */
  stereoPhotos.forEach((p, idx) => {
    const slot = document.createElement('div');
    slot.className = 'stereo-photo-slot';
    slot.innerHTML = `
      <div class="slot-label">Photo ${idx + 1}</div>
      <div class="slot-status ok">✓ Marker ID ${p.marker.id} detected
        — ${p.marker.mmPerPixel.toFixed(3)} mm/px</div>
    `;
    area.appendChild(slot);
  });

  /* "Load next photo" card — only if below the maximum */
  if (stereoPhotos.length < STEREO_MAX_PHOTOS) {
    const nextIdx = stereoPhotos.length + 1;
    const slot = document.createElement('div');
    slot.className = 'stereo-photo-slot';

    /* Instruction text varies by position */
    let instruction = '';
    if (nextIdx === 1) {
      instruction = 'Take the photo from your initial position. Keep the marker and damage in the central 70% of the frame.';
    } else {
      instruction = `Move <strong>3–6 cm sideways</strong> without rotating the phone, then load photo ${nextIdx}.`;
    }

    slot.innerHTML = `
      <div class="slot-label">Photo ${nextIdx}</div>
      <div class="slot-status" style="line-height:1.5">${instruction}</div>
      <div class="slot-status" id="stereo-slot-status-${nextIdx}" style="min-height:16px;"></div>
      <button id="btn-stereo-load-${nextIdx}" class="secondary">
        📷 Load photo ${nextIdx}
      </button>
    `;
    area.appendChild(slot);

    /* Wire up the load button */
    document.getElementById(`btn-stereo-load-${nextIdx}`)
      .addEventListener('click', () => triggerStereoFilePick(nextIdx));
  }

  /* Status line and action buttons */
  updateStereoStatusLine();
}

/* ---------- status line ---------- */
const STEREO_PRECISION_LABELS = [
  '',                                        // 0 photos
  '',                                        // 1 photo
  '2 photos loaded — basic precision',       // 2
  '3 photos loaded — improved precision',    // 3
  '4 photos loaded — maximum precision'      // 4
];

function updateStereoStatusLine() {
  const n = stereoPhotos.length;
  document.getElementById('stereo-photos-status').textContent =
    STEREO_PRECISION_LABELS[n] || '';

  const actionDiv = document.getElementById('stereo-action-buttons');
  if (n >= 2) {
    actionDiv.style.display = 'flex';
  } else {
    actionDiv.style.display = 'none';
  }
  /* Hide the ROI section whenever photo count changes (e.g. user
     loads a third photo after already opening the ROI step) */
  document.getElementById('stereo-roi-section').style.display = 'none';
  stereoRoiRect = null;
}

/* ---------- file picking ---------- */
/* We create a fresh <input type="file"> each time so the browser
   always fires the change event, even if the user picks the same
   file twice in a row. */
function triggerStereoFilePick(slotIdx) {
  const input = document.createElement('input');
  input.type   = 'file';
  input.accept = 'image/*';
  input.style.display = 'none';
  document.body.appendChild(input);

  input.addEventListener('change', async () => {
    const file = input.files[0];
    document.body.removeChild(input);
    if (!file) return;

    const statusEl = document.getElementById(`stereo-slot-status-${slotIdx}`);
    const loadBtn  = document.getElementById(`btn-stereo-load-${slotIdx}`);
    if (statusEl) statusEl.textContent = 'Loading…';
    if (loadBtn)  loadBtn.disabled = true;

    /* Phase 17: read EXIF model before any conversion */
    const model = await readExifModel(file);

    /* HEIC conversion if needed */
    const isHeic = /image\/hei[cf]/i.test(file.type || '') ||
                   /\.(heic|heif)$/i.test(file.name || '');
    let blob = file;
    if (isHeic) {
      try {
        const converted = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
        blob = Array.isArray(converted) ? converted[0] : converted;
      } catch (e) {
        if (statusEl) { statusEl.textContent = 'HEIC conversion failed.'; statusEl.className = 'slot-status error'; }
        if (loadBtn)  loadBtn.disabled = false;
        return;
      }
    }

    /* Load into an Image element */
    const img = await loadImageFromBlob(blob);

    /* Phase 17: apply lens undistortion if profile exists */
    const savedLens = state.lensModel;
    state.lensModel = model || null;
    const undistorted = undistortPhoto(img);
    state.lensModel = savedLens;   // restore main-app lens state

    /* Detect ArUco marker */
    const result = detectArucoMarker(undistorted);
    if (!result.best) {
      if (statusEl) { statusEl.textContent = '✗ No known marker detected. Try another photo.'; statusEl.className = 'slot-status error'; }
      if (loadBtn)  loadBtn.disabled = false;
      return;
    }

    /* Baseline check for photo 2+ */
    if (stereoPhotos.length >= 1) {
      const baseline = estimateStereoBaseline(stereoPhotos[0].marker, result.best);
      const distEst  = estimateCameraDistance(result.best);
      const minBase  = distEst * STEREO_MIN_BASELINE_RATIO;
      if (baseline < minBase) {
        if (statusEl) {
          statusEl.textContent =
            `✗ Baseline too small (≈${baseline.toFixed(0)} mm, min ≈${minBase.toFixed(0)} mm). ` +
            `Move further sideways and retry.`;
          statusEl.className = 'slot-status error';
        }
        if (loadBtn) loadBtn.disabled = false;
        return;
      }
    }

    /* All checks passed — store photo */
    stereoPhotos.push({ img: undistorted, marker: result.best, lensModel: model || null });
    renderStereoSlots();
  });

  input.click();
}

/* ---------- helper: load Blob into Image ---------- */
function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/* ---------- baseline estimation ---------- */
/* Estimates the lateral displacement between two camera positions
   by comparing the centres of their respective detected markers.
   Both markers must be the same physical marker (same ID), so the
   shift in its projected centre corresponds directly to camera
   movement. Returns the displacement in mm. */
function estimateStereoBaseline(markerA, markerB) {
  const cxA = (markerA.corners[0].x + markerA.corners[1].x +
               markerA.corners[2].x + markerA.corners[3].x) / 4;
  const cyA = (markerA.corners[0].y + markerA.corners[1].y +
               markerA.corners[2].y + markerA.corners[3].y) / 4;
  const cxB = (markerB.corners[0].x + markerB.corners[1].x +
               markerB.corners[2].x + markerB.corners[3].x) / 4;
  const cyB = (markerB.corners[0].y + markerB.corners[1].y +
               markerB.corners[2].y + markerB.corners[3].y) / 4;

  /* Average scale from both photos for the conversion px → mm */
  const mmPerPx = (markerA.mmPerPixel + markerB.mmPerPixel) / 2;
  return Math.hypot(cxB - cxA, cyB - cyA) * mmPerPx;
}

/* Estimates the camera-to-surface distance in mm from the apparent
   size of the marker. Uses the focal length from LENS_PROFILES if
   the device is calibrated; otherwise falls back to a typical
   smartphone focal length (3500 px at full resolution). */
function estimateCameraDistance(marker) {
  const profile = state.lensModel ? LENS_PROFILES[state.lensModel] : null;
  const focalPx = profile
    ? (profile.cameraMatrix[0][0] + profile.cameraMatrix[1][1]) / 2
    : 3500;
  /* distance = focal * real_size / projected_size */
  return focalPx * marker.sizeMm / marker.avgSidePx;
}

/* ---------- depth calculation ---------- */

/* "Select region & calculate" button — shows the ROI section
   with photo 1 so the inspector can draw the rectangle. */
document.getElementById('btn-stereo-show-roi').addEventListener('click', () => {
  if (stereoPhotos.length < 2) return;
  showStereoRoiSection();
});

/* "Calculate" button — only enabled after a valid rectangle is drawn. */
document.getElementById('btn-stereo-calculate').addEventListener('click', () => {
  if (!stereoRoiRect || stereoPhotos.length < 2) return;
  calculateStereoDepth();
});

/* "Clear" button — resets the rectangle drawn on the ROI canvas. */
document.getElementById('btn-stereo-roi-clear').addEventListener('click', () => {
  stereoRoiRect = null;
  drawRoiCanvas(null);
  document.getElementById('btn-stereo-calculate').disabled = true;
  document.getElementById('stereo-roi-hint').textContent = 'Tap and drag to draw the rectangle';
});

/* ---------- ROI canvas setup ---------- */
/* Renders photo 1 inside #stereo-roi-canvas and lets the inspector
   drag a rectangle over the object. The rectangle is stored in
   stereoRoiRect in image-space coordinates (not canvas-space). */

let roiDragStart = null;   // canvas-space {x, y} where the drag started

function showStereoRoiSection() {
  stereoRoiRect = null;
  roiDragStart  = null;
  document.getElementById('btn-stereo-calculate').disabled = true;
  document.getElementById('stereo-roi-hint').textContent = 'Tap and drag to draw the rectangle';

  /* Show the ROI section, hide the "show roi" button */
  document.getElementById('stereo-action-buttons').style.display = 'none';
  const roiSection = document.getElementById('stereo-roi-section');
  roiSection.style.display = 'flex';

  /* Draw photo 1 onto the ROI canvas */
  drawRoiCanvas(null);
  wireRoiCanvas();
}

/* Draws photo 1 on the ROI canvas, optionally overlaying a rectangle.
   rect is {x, y, w, h} in IMAGE-space pixels, or null for no rect. */
function drawRoiCanvas(rect) {
  const img = stereoPhotos[0].img;
  const canvas = document.getElementById('stereo-roi-canvas');

  /* Size the canvas to the image's natural aspect ratio.
     The canvas is displayed at 100% CSS width via the wrap div;
     we set the internal resolution to a capped value so drawing
     stays fast even on a 12MP photo. */
  const MAX_W = 800;
  const scale = Math.min(1, MAX_W / (img.naturalWidth || img.width));
  canvas.width  = Math.round((img.naturalWidth  || img.width)  * scale);
  canvas.height = Math.round((img.naturalHeight || img.height) * scale);

  const ctx2 = canvas.getContext('2d');
  ctx2.drawImage(img, 0, 0, canvas.width, canvas.height);

  if (rect) {
    /* rect is in image-space; convert to canvas-space for drawing */
    const sx = canvas.width  / (img.naturalWidth  || img.width);
    const sy = canvas.height / (img.naturalHeight || img.height);
    ctx2.strokeStyle = '#2a6fdb';
    ctx2.lineWidth   = 2;
    ctx2.setLineDash([6, 3]);
    ctx2.strokeRect(rect.x * sx, rect.y * sy, rect.w * sx, rect.h * sy);
    ctx2.fillStyle = 'rgba(42, 111, 219, 0.12)';
    ctx2.fillRect(rect.x * sx, rect.y * sy, rect.w * sx, rect.h * sy);
    ctx2.setLineDash([]);
  }
}

/* Wires touch + mouse listeners onto the ROI canvas for drag-to-draw.
   Called once per ROI session (each time showStereoRoiSection runs). */
function wireRoiCanvas() {
  const canvas = document.getElementById('stereo-roi-canvas');

  /* Remove any previous listeners by cloning the node */
  const fresh = canvas.cloneNode(false);   // shallow clone, no children
  canvas.parentNode.replaceChild(fresh, canvas);
  fresh.id = 'stereo-roi-canvas';

  /* Helper: get position relative to the canvas in IMAGE-space */
  function imgPos(clientX, clientY) {
    const rect = fresh.getBoundingClientRect();
    const cx   = (clientX - rect.left)  * (fresh.width  / rect.width);
    const cy   = (clientY - rect.top)   * (fresh.height / rect.height);
    const img  = stereoPhotos[0].img;
    const sx   = (img.naturalWidth  || img.width)  / fresh.width;
    const sy   = (img.naturalHeight || img.height) / fresh.height;
    return { x: cx * sx, y: cy * sy };
  }

  /* Draw an in-progress rectangle during drag, in canvas-space */
  function drawLive(startCS, endCS) {
    const img = stereoPhotos[0].img;
    /* Redraw photo */
    const ctx2 = fresh.getContext('2d');
    ctx2.drawImage(img, 0, 0, fresh.width, fresh.height);
    /* Live rectangle in canvas-space */
    const rx = Math.min(startCS.x, endCS.x);
    const ry = Math.min(startCS.y, endCS.y);
    const rw = Math.abs(endCS.x - startCS.x);
    const rh = Math.abs(endCS.y - startCS.y);
    ctx2.strokeStyle = '#2a6fdb';
    ctx2.lineWidth   = 2;
    ctx2.setLineDash([6, 3]);
    ctx2.strokeRect(rx, ry, rw, rh);
    ctx2.fillStyle   = 'rgba(42, 111, 219, 0.12)';
    ctx2.fillRect(rx, ry, rw, rh);
    ctx2.setLineDash([]);
  }

  /* ---- Mouse ---- */
  let mouseDown = false;
  let startCS   = null;

  fresh.addEventListener('mousedown', (e) => {
    e.preventDefault();
    mouseDown = true;
    const rect = fresh.getBoundingClientRect();
    startCS = {
      x: (e.clientX - rect.left) * (fresh.width  / rect.width),
      y: (e.clientY - rect.top)  * (fresh.height / rect.height)
    };
  });

  fresh.addEventListener('mousemove', (e) => {
    if (!mouseDown || !startCS) return;
    e.preventDefault();
    const rect = fresh.getBoundingClientRect();
    const endCS = {
      x: (e.clientX - rect.left) * (fresh.width  / rect.width),
      y: (e.clientY - rect.top)  * (fresh.height / rect.height)
    };
    drawLive(startCS, endCS);
  });

  fresh.addEventListener('mouseup', (e) => {
    if (!mouseDown || !startCS) return;
    mouseDown = false;
    e.preventDefault();
    const rect = fresh.getBoundingClientRect();
    const endCS = {
      x: (e.clientX - rect.left) * (fresh.width  / rect.width),
      y: (e.clientY - rect.top)  * (fresh.height / rect.height)
    };
    commitRoi(startCS, endCS, fresh);
    startCS = null;
  });

  /* ---- Touch ---- */
  let touchStart = null;

  fresh.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.touches[0];
    const rect = fresh.getBoundingClientRect();
    touchStart = {
      x: (t.clientX - rect.left) * (fresh.width  / rect.width),
      y: (t.clientY - rect.top)  * (fresh.height / rect.height)
    };
  }, { passive: false });

  fresh.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (!touchStart) return;
    const t = e.touches[0];
    const rect = fresh.getBoundingClientRect();
    const endCS = {
      x: (t.clientX - rect.left) * (fresh.width  / rect.width),
      y: (t.clientY - rect.top)  * (fresh.height / rect.height)
    };
    drawLive(touchStart, endCS);
  }, { passive: false });

  fresh.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const rect = fresh.getBoundingClientRect();
    const endCS = {
      x: (t.clientX - rect.left) * (fresh.width  / rect.width),
      y: (t.clientY - rect.top)  * (fresh.height / rect.height)
    };
    commitRoi(touchStart, endCS, fresh);
    touchStart = null;
  }, { passive: false });

  /* Re-draw the photo onto the cloned canvas (no rectangle yet) */
  const img = stereoPhotos[0].img;
  const ctx2 = fresh.getContext('2d');
  /* Carry over dimensions from the original canvas that was replaced */
  const orig = document.getElementById('stereo-roi-canvas');
  fresh.width  = fresh.width  || img.naturalWidth  || img.width;
  fresh.height = fresh.height || img.naturalHeight || img.height;
  ctx2.drawImage(img, 0, 0, fresh.width, fresh.height);
}

/* Converts a canvas-space drag into image-space stereoRoiRect and
   enables the Calculate button if the rectangle is large enough. */
function commitRoi(startCS, endCS, canvas) {
  const img = stereoPhotos[0].img;
  const sx  = (img.naturalWidth  || img.width)  / canvas.width;
  const sy  = (img.naturalHeight || img.height) / canvas.height;

  const ix = Math.min(startCS.x, endCS.x) * sx;
  const iy = Math.min(startCS.y, endCS.y) * sy;
  const iw = Math.abs(endCS.x - startCS.x) * sx;
  const ih = Math.abs(endCS.y - startCS.y) * sy;

  /* Minimum 20×20 image pixels to be meaningful */
  if (iw < 20 || ih < 20) {
    document.getElementById('stereo-roi-hint').textContent =
      'Rectangle too small — drag a larger area';
    return;
  }

  stereoRoiRect = { x: ix, y: iy, w: iw, h: ih };
  drawRoiCanvas(stereoRoiRect);   /* redraw with final rectangle */

  document.getElementById('btn-stereo-calculate').disabled = false;
  document.getElementById('stereo-roi-hint').textContent =
    `Region selected (${Math.round(iw * stereoPhotos[0].marker.mmPerPixel)} × ` +
    `${Math.round(ih * stereoPhotos[0].marker.mmPerPixel)} mm) — tap Calculate`;
}

function calculateStereoDepth() {
  let maxDepthMm = null;

  for (let i = 0; i < stereoPhotos.length - 1; i++) {
    const depthMm = triangulateDepthPair(
      stereoPhotos[i],
      stereoPhotos[i + 1],
      stereoRoiRect
    );
    if (depthMm !== null) {
      if (maxDepthMm === null || Math.abs(depthMm) > Math.abs(maxDepthMm)) {
        maxDepthMm = depthMm;
      }
    }
  }

  showStereoResult(maxDepthMm);
}

/* Triangulates depth from a pair of stereo photos using
   cv.matchTemplate on the inspector-selected ROI.
   roiRect is {x, y, w, h} in photo-1 image-space pixels.
   Returns depth in mm (negative = inward dent, positive = outward
   bulge), or null if matching fails. */
function triangulateDepthPair(photoA, photoB, roiRect) {
  if (!roiRect) return null;

  const srcA  = cv.imread(photoA.img);
  const srcB  = cv.imread(photoB.img);
  const grayA = new cv.Mat();
  const grayB = new cv.Mat();
  const tmpl  = new cv.Mat();
  const result= new cv.Mat();

  try {
    /* ---- Baseline and geometry (unchanged from phase 18.1) ---- */
    const cxA = (photoA.marker.corners[0].x + photoA.marker.corners[1].x +
                 photoA.marker.corners[2].x + photoA.marker.corners[3].x) / 4;
    const cyA = (photoA.marker.corners[0].y + photoA.marker.corners[1].y +
                 photoA.marker.corners[2].y + photoA.marker.corners[3].y) / 4;
    const cxB = (photoB.marker.corners[0].x + photoB.marker.corners[1].x +
                 photoB.marker.corners[2].x + photoB.marker.corners[3].x) / 4;
    const cyB = (photoB.marker.corners[0].y + photoB.marker.corners[1].y +
                 photoB.marker.corners[2].y + photoB.marker.corners[3].y) / 4;

    const baselinePx = Math.hypot(cxB - cxA, cyB - cyA);
    const baselineMm = baselinePx * photoA.marker.mmPerPixel;

    if (baselineMm < 1) return null;

    /* Use the calibration profile of photo A's camera if available.
       stereoPhotos entries carry their lens model so we don't depend
       on state.lensModel, which belongs to the main measurement flow. */
    const stereoModel = photoA.lensModel || null;
    const profile    = stereoModel ? LENS_PROFILES[stereoModel] : null;
    const focalPx    = profile
      ? (profile.cameraMatrix[0][0] + profile.cameraMatrix[1][1]) / 2
      : 3500;
    const distanceMm = focalPx * photoA.marker.sizeMm / photoA.marker.avgSidePx;

    const moveDx = baselinePx > 0 ? (cxB - cxA) / baselinePx : 1;
    const moveDy = baselinePx > 0 ? (cyB - cyA) / baselinePx : 0;

    /* Object centre in photo A (from inspector-drawn ROI rectangle) */
    const tplCxA = roiRect.x + roiRect.w / 2;
    const tplCyA = roiRect.y + roiRect.h / 2;

    /* Object centre in photo B via template matching restricted to
       a ±120 px window around the expected position.
       Expected position = photo-A centre shifted by the marker
       displacement (A→B). This eliminates false matches from
       reflections or similar background regions. */
    cv.cvtColor(srcA, grayA, cv.COLOR_RGBA2GRAY);
    cv.cvtColor(srcB, grayB, cv.COLOR_RGBA2GRAY);

    const rx = Math.max(0, Math.round(roiRect.x));
    const ry = Math.max(0, Math.round(roiRect.y));
    const rw = Math.min(grayA.cols - rx, Math.round(roiRect.w));
    const rh = Math.min(grayA.rows - ry, Math.round(roiRect.h));
    if (rw < 5 || rh < 5) return null;

    const roiA = grayA.roi(new cv.Rect(rx, ry, rw, rh));
    roiA.copyTo(tmpl);
    roiA.delete();

    const expectedCxB = tplCxA + (cxB - cxA);
    const expectedCyB = tplCyA + (cyB - cyA);

    const margin = 120;
    const swX = Math.max(0, Math.round(expectedCxB - rw / 2 - margin));
    const swY = Math.max(0, Math.round(expectedCyB - rh / 2 - margin));
    const swW = Math.min(grayB.cols - swX, rw + margin * 2);
    const swH = Math.min(grayB.rows - swY, rh + margin * 2);
    if (swW < rw || swH < rh) return null;

    const searchRoi = grayB.roi(new cv.Rect(swX, swY, swW, swH));
    cv.matchTemplate(searchRoi, tmpl, result, cv.TM_CCOEFF_NORMED);
    searchRoi.delete();

    const minMax = cv.minMaxLoc(result);
    if (minMax.maxVal < 0.4) {
      console.warn(`Stereo: match score too low (${minMax.maxVal.toFixed(2)})`);
      return null;
    }

    let tplCxB = swX + minMax.maxLoc.x + rw / 2;
    let tplCyB = swY + minMax.maxLoc.y + rh / 2;

    /* Residual parallax — both shifts in A→B convention:
       marker:  cxB - cxA
       object:  tplCxB - tplCxA
       residual = object_shift - marker_shift */
    const objShiftX    = tplCxB - tplCxA;
    const objShiftY    = tplCyB - tplCyA;
    const markerShiftX = cxB - cxA;
    const markerShiftY = cyB - cyA;
    const residualX    = objShiftX - markerShiftX;
    const residualY    = objShiftY - markerShiftY;
    const disparity    = residualX * moveDx + residualY * moveDy;

    if (Math.abs(disparity) < 0.5) {
      console.warn('Stereo: residual too small — object appears flat.');
      return null;
    }

    /* deltaZ = disparity * distanceMm / baselinePx
       This is the correct thin-lens stereo formula when disparity
       is measured relative to the marker (baseline reference).
       Positive disparity = object shifted more than marker = outward.
       Negative = inward (dent). */
    const deltaZ = (disparity * distanceMm) / baselinePx;

    if (Math.abs(deltaZ) > distanceMm * 0.40) {
      console.warn(`Stereo: deltaZ out of range (${deltaZ.toFixed(1)} mm)`);
      return null;
    }

    return deltaZ;

  } catch (err) {
    console.warn('Stereo triangulation failed:', err);
    return null;
  } finally {
    srcA.delete(); srcB.delete();
    grayA.delete(); grayB.delete();
    tmpl.delete(); result.delete();
  }
}

/* ---------- result modal ---------- */
function showStereoResult(depthMm) {
  const valueEl  = document.getElementById('stereo-result-value');
  const detailEl = document.getElementById('stereo-result-detail');
  const resCanvas= document.getElementById('stereo-result-canvas');

  /* Draw photo 1 with the selected ROI and a depth annotation */
  if (stereoPhotos.length >= 1 && stereoRoiRect) {
    const img = stereoPhotos[0].img;
    const MAX_W = 700;
    const scale = Math.min(1, MAX_W / (img.naturalWidth || img.width));
    resCanvas.width  = Math.round((img.naturalWidth  || img.width)  * scale);
    resCanvas.height = Math.round((img.naturalHeight || img.height) * scale);

    const rc = resCanvas.getContext('2d');
    rc.drawImage(img, 0, 0, resCanvas.width, resCanvas.height);

    const sx = resCanvas.width  / (img.naturalWidth  || img.width);
    const sy = resCanvas.height / (img.naturalHeight || img.height);
    const rx = stereoRoiRect.x * sx;
    const ry = stereoRoiRect.y * sy;
    const rw = stereoRoiRect.w * sx;
    const rh = stereoRoiRect.h * sy;

    /* Draw the ROI rectangle */
    rc.strokeStyle = depthMm === null ? '#e74c3c'
                   : depthMm < 0      ? '#7ab3ff'
                   : '#f39c12';
    rc.lineWidth   = Math.max(2, resCanvas.width * 0.003);
    rc.strokeRect(rx, ry, rw, rh);

    /* Depth annotation above the rectangle */
    if (depthMm !== null) {
      const sign  = depthMm < 0 ? '−' : '+';
      const label = `${sign}${Math.abs(depthMm).toFixed(1)} mm`;
      const fSize = Math.max(14, resCanvas.width * 0.025);
      rc.font      = `bold ${fSize}px sans-serif`;
      const tw     = rc.measureText(label).width;
      const pad    = fSize * 0.4;
      const bx     = rx + rw / 2 - tw / 2 - pad;
      const by     = ry - fSize - pad * 2;
      rc.fillStyle = 'rgba(0,0,0,0.75)';
      rc.fillRect(bx, Math.max(2, by), tw + pad * 2, fSize + pad * 2);
      rc.fillStyle   = rc.strokeStyle;
      rc.textBaseline= 'top';
      rc.fillText(label, bx + pad, Math.max(2, by) + pad);
      rc.textBaseline= 'alphabetic';
    }

    resCanvas.style.display = 'block';
  } else {
    resCanvas.style.display = 'none';
  }

  if (depthMm === null) {
    valueEl.textContent  = 'Calculation failed';
    valueEl.style.color  = '#e74c3c';
    detailEl.textContent = 'Template match score too low. Try a region with more visible texture, or check that both photos show the same object.';
  } else {
    state.lastStereoDepthMm = depthMm;   // phase 24: pre-fill report depth field
    const sign    = depthMm < 0 ? '−' : '+';
    const absVal  = Math.abs(depthMm).toFixed(1);
    const label   = depthMm < 0 ? 'inward (depth)' : 'outward (height)';
    valueEl.textContent = `${sign}${absVal} mm`;
    valueEl.style.color = depthMm < 0 ? '#7ab3ff' : '#f39c12';

    const calibrated = state.lensModel && LENS_PROFILES[state.lensModel];
    detailEl.textContent = calibrated
      ? `${label} · calibrated lens (${state.lensModel})`
      : `${label} · uncalibrated lens — error may be higher`;
  }

  closeStereoOverlay();
  document.getElementById('modal-stereo-result').classList.add('show');
}

/* Copy result to clipboard */
document.getElementById('stereo-result-share').addEventListener('click', () => {
  const text = document.getElementById('stereo-result-value').textContent;
  const detail = document.getElementById('stereo-result-detail').textContent;
  const full = `Depth/Height estimate: ${text} (${detail}) — experimental, ±1–3 mm error`;
  navigator.clipboard && navigator.clipboard.writeText(full).catch(() => {});
});

/* Close result modal */
document.getElementById('stereo-result-close').addEventListener('click', () => {
  document.getElementById('modal-stereo-result').classList.remove('show');
});

/* ============================================================
   END OF STEREO MODULE — PHASE 18
   ============================================================ */

/* ============================================================
   LIST BUTTON + STARTUP
   ============================================================ */

/* On window resize (e.g. desktop user resizes the browser, or
   mobile user rotates), the canvas's screen size changes but its
   internal resolution doesn't. We redraw so cross sizes recalculate
   for the new screen-to-image ratio. */

/* ============================================================
   ANNOTATION TOOL CONTROLS (phase 11)
   ============================================================
   Wire up all the annotation panel controls to state:
   tool toggles, colour picker, stroke width, text size,
   undo and clear-all.
   ============================================================ */

/* Helper: activate one tool and deactivate the other two.
   tool is 'pen' | 'eraser' | 'text' | null (deactivate all). */
function setActiveTool(tool) {
  state.penActive    = (tool === 'pen');
  state.eraserActive = (tool === 'eraser');
  state.textActive   = (tool === 'text');

  document.getElementById('btn-tool-pen')
    .classList.toggle('ann-active', state.penActive);
  document.getElementById('btn-tool-eraser')
    .classList.toggle('ann-active', state.eraserActive);
  document.getElementById('btn-tool-text')
    .classList.toggle('ann-active', state.textActive);
    /* Close the left panel so the backdrop doesn't intercept
     canvas events while a drawing tool is active. */
  if (tool) closeLeftPanel();
}

/* Tool toggles: clicking an active tool deactivates it (toggle off). */
document.getElementById('btn-tool-pen').addEventListener('click', () => {
  setActiveTool(state.penActive ? null : 'pen');
});
document.getElementById('btn-tool-eraser').addEventListener('click', () => {
  setActiveTool(state.eraserActive ? null : 'eraser');
});
document.getElementById('btn-tool-text').addEventListener('click', () => {
  setActiveTool(state.textActive ? null : 'text');
});

/* Colour picker */
document.getElementById('ann-color-select').addEventListener('change', (e) => {
  state.penColor = e.target.value;
});

/* Stroke width buttons */
document.querySelectorAll('.ann-width').forEach(btn => {
  btn.addEventListener('click', () => {
    state.penWidth = parseInt(btn.dataset.width, 10);
    document.querySelectorAll('.ann-width').forEach(b =>
      b.classList.toggle('ann-width-sel', b === btn)
    );
  });
});

/* Text size buttons */
document.querySelectorAll('.ann-tsize').forEach(btn => {
  btn.addEventListener('click', () => {
    state.textSize = btn.dataset.tsize;
    document.querySelectorAll('.ann-tsize').forEach(b =>
      b.classList.toggle('ann-tsize-sel', b === btn)
    );
  });
});

/* Undo and Clear all */
document.getElementById('btn-ann-undo').addEventListener('click', undoAnnotation);
document.getElementById('btn-ann-clear').addEventListener('click', clearAnnotations);

window.addEventListener('resize', () => {
  if (state.photo) redraw();
});

/* ============================================================
   AUTO-DETECT DAMAGE ENDPOINTS (Phase 15)
   ============================================================
   suggestDamageEndpoints(tapPoint) takes a single image-space
   point (where the inspector tapped) and returns the two
   endpoints of the most prominent contour found in a window
   around that point, or null if nothing convincing is found.

   Algorithm:
   1. Convert the window region to grayscale.
   2. Apply Gaussian blur to reduce noise before Canny.
   3. Run Canny edge detection.
   4. Find contours inside the window.
   5. Discard contours that are too small (likely noise) or
      that touch the window boundary (likely the object extends
      beyond the window — the inspector should retap closer).
   6. Pick the contour with the largest arc length (perimeter).
   7. Return the two points of that contour that are farthest
      apart — the "diameter" of the contour, which corresponds
      to the maximum extent of the damage.

   All coordinates returned are in full-image space (not window
   space), so pendingA/pendingB plug directly into the existing
   measurement flow.

   Memory: every cv.Mat is freed in finally{}, same pattern as
   detectArucoMarker. Returns null on any OpenCV failure.
   ============================================================ */
function suggestDamageEndpoints(tapPoint) {
  if (!state.mmPerPixel) return null;

  /* Convert the window size from mm to pixels using the current
     scale. Half-side in each direction from the tap centre. */
  const halfPx = Math.round((AUTO_DETECT_WINDOW_MM / 2) / state.mmPerPixel);

  /* Window bounds, clamped to image dimensions */
  const iw = state.photo.width;
  const ih = state.photo.height;
  const wx = Math.max(0, Math.round(tapPoint.x) - halfPx);
  const wy = Math.max(0, Math.round(tapPoint.y) - halfPx);
  const ww = Math.min(iw - wx, halfPx * 2);
  const wh = Math.min(ih - wy, halfPx * 2);

  /* Window must be at least 20×20 px to be meaningful */
  if (ww < 20 || wh < 20) return null;

  const src      = cv.imread(state.photo);
  const roi      = src.roi(new cv.Rect(wx, wy, ww, wh));
  const gray     = new cv.Mat();
  const blurred  = new cv.Mat();
  const edges    = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy= new cv.Mat();

  try {
    cv.cvtColor(roi, gray, cv.COLOR_RGBA2GRAY);

    /* Gaussian blur reduces noise that would otherwise produce
       many spurious short edges and fragment real contours. */
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

    /* Canny thresholds: lower=50, upper=150 are standard
       defaults that work well on medium-contrast surfaces.
       These could become configurable constants in the future. */
    cv.Canny(blurred, edges, 50, 150);

    cv.findContours(edges, contours, hierarchy,
                    cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    /* Minimum contour perimeter: 8% of the window perimeter.
       Filters out single-pixel noise specks. */
    const minPerimeter = 0.08 * 2 * (ww + wh);

    let bestContour = null;
    let bestLen     = 0;

    for (let i = 0; i < contours.size(); i++) {
      const c   = contours.get(i);
      const len = cv.arcLength(c, false);

      if (len < minPerimeter) { c.delete(); continue; }

      /* Discard contours that touch the window edge — they are
         likely part of a larger object extending beyond the
         window. The inspector should tap closer to the centre. */
      const rect = cv.boundingRect(c);
      const touchesEdge = (rect.x <= 1) || (rect.y <= 1) ||
                          (rect.x + rect.width  >= ww - 1) ||
                          (rect.y + rect.height >= wh - 1);
      if (touchesEdge) { c.delete(); continue; }

      if (len > bestLen) {
        if (bestContour) bestContour.delete();
        bestContour = c;
        bestLen = len;
      } else {
        c.delete();
      }
    }

    if (!bestContour) return null;

    /* Find the two points of the contour that are farthest apart.
       For small contours (< 200 points) we do an exact O(n²)
       search. For larger ones we sub-sample to keep it fast. */
    const pts  = bestContour.data32S;   // flat [x0,y0, x1,y1, ...]
    const nPts = pts.length / 2;
    bestContour.delete();

    /* Sub-sample: at most 100 points for the diameter search */
    const step  = Math.max(1, Math.floor(nPts / 100));
    let maxDist = 0;
    let ptA = null, ptB = null;

    for (let i = 0; i < nPts; i += step) {
      for (let j = i + 1; j < nPts; j += step) {
        const dx = pts[i * 2] - pts[j * 2];
        const dy = pts[i * 2 + 1] - pts[j * 2 + 1];
        const d  = dx * dx + dy * dy;
        if (d > maxDist) {
          maxDist = d;
          ptA = { x: pts[i * 2] + wx, y: pts[i * 2 + 1] + wy };
          ptB = { x: pts[j * 2] + wx, y: pts[j * 2 + 1] + wy };
        }
      }
    }

    return (ptA && ptB) ? { a: ptA, b: ptB } : null;

  } catch (err) {
    console.warn('suggestDamageEndpoints failed:', err);
    return null;
  } finally {
    roi.delete();
    src.delete();
    gray.delete();
    blurred.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();
  }
}

/* ============================================================
   SUGGEST DAMAGE ENDPOINTS FROM A DRAWN RECTANGLE (Phase 15)
   ============================================================
   Returns an object with three pieces of geometry derived from
   the most prominent contour found inside the rectangle:

   - bbox: { x1, y1, x2, y2 } — axis-aligned bounding box of
     the contour in full-image coordinates. Used to create the
     Width and Height dimensions.
   - diagonal: { a, b } — the two contour points farthest apart,
     for the "longest diagonal" option.

   Returns null if no convincing contour is found.
   ============================================================ */
function suggestDamageEndpointsInRect(x1, y1, x2, y2) {
  if (!state.mmPerPixel) return null;

  const iw = state.photo.width;
  const ih = state.photo.height;

  const wx  = Math.max(0, Math.round(x1));
  const wy  = Math.max(0, Math.round(y1));
  const wx2 = Math.min(iw, Math.round(x2));
  const wy2 = Math.min(ih, Math.round(y2));
  const ww  = wx2 - wx;
  const wh  = wy2 - wy;

  if (ww < 20 || wh < 20) return null;

  const src      = cv.imread(state.photo);
  const roi      = src.roi(new cv.Rect(wx, wy, ww, wh));
  const gray     = new cv.Mat();
  const blurred  = new cv.Mat();
  const edges    = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy= new cv.Mat();

  try {
    cv.cvtColor(roi, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 50, 150);
    cv.findContours(edges, contours, hierarchy,
                    cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const minPerimeter = 0.05 * 2 * (ww + wh);

    let bestContour = null;
    let bestArea    = 0;

    for (let i = 0; i < contours.size(); i++) {
      const c   = contours.get(i);
      const len = cv.arcLength(c, false);

      if (len < minPerimeter) { c.delete(); continue; }

      const rect = cv.boundingRect(c);
      const area = rect.width * rect.height;

      if (area > bestArea) {
        if (bestContour) bestContour.delete();
        bestContour = c;
        bestArea    = area;
      } else {
        c.delete();
      }
    }

    if (!bestContour) return null;

    /* Minimum area rotated rectangle — gives correct width and
       height along the object's own axes, regardless of rotation.
       cv.minAreaRect returns { center, size, angle }. We compute
       the 4 vertices from those values and offset them back from
       ROI space to full-image space. */
    const mar    = cv.minAreaRect(bestContour);
    const cx_mar = mar.center.x + wx;
    const cy_mar = mar.center.y + wy;
    /* minAreaRect may return width < height or vice versa depending
       on angle; we normalise so widthPx is always the longer side. */
    let widthPx  = mar.size.width;
    let heightPx = mar.size.height;
    let angleDeg = mar.angle;
    /* OpenCV convention: angle is in [-90, 0). If width < height,
       the rectangle is considered rotated 90° and angle shifts.
       We always want the "width" axis to be the longer one so that
       W and H labels are consistent with visual expectation. */
    if (widthPx < heightPx) {
      [widthPx, heightPx] = [heightPx, widthPx];
      angleDeg += 90;
    }
    const angleRad = angleDeg * Math.PI / 180;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    const hw = widthPx  / 2;
    const hh = heightPx / 2;
    /* 4 vertices of the rotated rectangle in full-image space,
       in order: TL → TR → BR → BL (relative to the object's axes,
       not the canvas axes). */
    const rotatedRect = {
      widthMm:  widthPx  * state.mmPerPixel,
      heightMm: heightPx * state.mmPerPixel,
      vertices: [
        { x: cx_mar - hw * cos + hh * sin, y: cy_mar - hw * sin - hh * cos }, // TL
        { x: cx_mar + hw * cos + hh * sin, y: cy_mar + hw * sin - hh * cos }, // TR
        { x: cx_mar + hw * cos - hh * sin, y: cy_mar + hw * sin + hh * cos }, // BR
        { x: cx_mar - hw * cos - hh * sin, y: cy_mar - hw * sin + hh * cos }  // BL
      ]
    };

    /* Diameter search for the diagonal option */
    const pts  = bestContour.data32S;
    const nPts = pts.length / 2;
    bestContour.delete();

    const step  = Math.max(1, Math.floor(nPts / 100));
    let maxDist = 0;
    let ptA = null, ptB = null;

    for (let i = 0; i < nPts; i += step) {
      for (let j = i + 1; j < nPts; j += step) {
        const dx = pts[i * 2] - pts[j * 2];
        const dy = pts[i * 2 + 1] - pts[j * 2 + 1];
        const d  = dx * dx + dy * dy;
        if (d > maxDist) {
          maxDist = d;
          ptA = { x: pts[i * 2] + wx, y: pts[i * 2 + 1] + wy };
          ptB = { x: pts[j * 2] + wx, y: pts[j * 2 + 1] + wy };
        }
      }
    }

    return {
      rotatedRect,
      diagonal: (ptA && ptB) ? { a: ptA, b: ptB } : null
    };

  } catch (err) {
    console.warn('suggestDamageEndpointsInRect failed:', err);
    return null;
  } finally {
    roi.delete();
    src.delete();
    gray.delete();
    blurred.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();
  }
}

/* ============================================================
   AUTO-DETECT ORCHESTRATOR
   ============================================================
   Called by handleTap when phase is 'detect-tap'. Runs the
   suggestion, places the proposed points, and transitions to
   the appropriate phase:

   - If a proposal is found → pendingA + pendingB set,
     phase becomes 'measure-2' so the inspector can confirm
     or drag-adjust the endpoints normally.

   - If nothing found → fall back silently to 'measure-1-empty'
     (the standard manual flow). The hint will guide the
     inspector from there.
   ============================================================ */
function runAutoDetect(tapPoint) {
  const proposal = suggestDamageEndpoints(tapPoint);

  if (proposal) {
    console.log('Auto-detect proposal:', proposal);
    state.pendingA = proposal.a;
    state.pendingB = proposal.b;
    setPhase('measure-2');
  } else {
    console.log('Auto-detect found nothing — falling back to manual flow.');
    state.pendingA = null;
    state.pendingB = null;
    setPhase('measure-1-empty');
  }
}

/* ============================================================
   ARUCO MARKER DETECTION
   ============================================================
   detectArucoMarker(img) runs ArUco detection on a loaded
   HTMLImageElement and returns information about every known
   marker it found, plus a `best` shortcut pointing to the
   largest one (most pixels per side = most precise scale).

   Memory management:
   OpenCV.js runs in WebAssembly, which has its own heap that
   the browser does not garbage-collect. Every cv.Mat we create
   must be `.delete()`-ed. The try/finally block guarantees
   that even if detection throws, we still release the memory.

   Return value structure:
   {
     markers: [ { id, sizeMm, corners, sideLengthsPx,
                  avgSidePx, mmPerPixel, sideVariance } ... ],
     best:   <one of the items in markers, or null>,
     errorMessage: <string explaining failure, or null>
   }

   `corners` is an array of 4 {x, y} points in image coordinates,
   in the order the OpenCV detector returned them (top-left,
   top-right, bottom-right, bottom-left when the marker is
   roughly aligned with the image).

   `sideVariance` is the relative spread of the four side
   lengths: max(side) / min(side). A perfectly flat, head-on
   marker gives ~1.00. Values > 1.15 suggest noticeable
   perspective distortion and the scale will be only approximate.
   ============================================================ */
function detectArucoMarker(img) {
  /* Pull the picked dictionary name from config and translate
     it into the numeric constant OpenCV expects. */
  const dictConstant = cv[ARUCO_DICTIONARY];
  if (typeof dictConstant === 'undefined') {
    return { markers: [], best: null,
      errorMessage: `Unknown dictionary: ${ARUCO_DICTIONARY}` };
  }

  /* Allocate all OpenCV resources up front, so the finally
     block has a single, predictable list to clean up. */
  const src           = cv.imread(img);
  const gray          = new cv.Mat();
  const markerIds     = new cv.Mat();
  const markerCorners = new cv.MatVector();
  const rejected      = new cv.MatVector();
  const dictionary    = cv.getPredefinedDictionary(dictConstant);
  const params        = new cv.aruco_DetectorParameters();
  const refineParams  = new cv.aruco_RefineParameters(10, 3, true);
  const detector      = new cv.aruco_ArucoDetector(dictionary, params, refineParams);

  try {
    /* ArUco detection runs on a single-channel grayscale image.
       Converting explicitly is faster and more predictable than
       letting the detector do it internally. */
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    detector.detectMarkers(gray, markerCorners, markerIds, rejected);

    const found = [];
    const count = markerIds.rows;

    for (let i = 0; i < count; i++) {
      const id = markerIds.data32S[i];

      /* Only report markers whose physical size we know.
         An unknown ID is not an error — the user might have
         other markers in the scene from another project. */
      if (!(id in ARUCO_MARKER_SIZES_MM)) continue;

      /* markerCorners.get(i) returns a 1x4 Mat of CV_32FC2:
         four points, each with two float32 coordinates. */
      const cornersMat = markerCorners.get(i);
      const d = cornersMat.data32F;
      const corners = [
        { x: d[0], y: d[1] },
        { x: d[2], y: d[3] },
        { x: d[4], y: d[5] },
        { x: d[6], y: d[7] }
      ];
      cornersMat.delete();

      const sideLengthsPx = [
        Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y),
        Math.hypot(corners[2].x - corners[1].x, corners[2].y - corners[1].y),
        Math.hypot(corners[3].x - corners[2].x, corners[3].y - corners[2].y),
        Math.hypot(corners[0].x - corners[3].x, corners[0].y - corners[3].y)
      ];
      const avgSidePx    = sideLengthsPx.reduce((a, b) => a + b, 0) / 4;
      const sizeMm       = ARUCO_MARKER_SIZES_MM[id];
      const mmPerPixel   = sizeMm / avgSidePx;
      const sideVariance = Math.max(...sideLengthsPx) / Math.min(...sideLengthsPx);

      found.push({ id, sizeMm, corners, sideLengthsPx,
                   avgSidePx, mmPerPixel, sideVariance });
    }

    /* Pick the marker with the most pixels per side as `best`:
       larger marker in the image → more precise scale. */
    let best = null;
    for (const m of found) {
      if (!best || m.avgSidePx > best.avgSidePx) best = m;
    }

    return { markers: found, best, errorMessage: null };
  } catch (err) {
    return { markers: [], best: null,
      errorMessage: `Detection failed: ${err.message || err}` };
  } finally {
    src.delete();
    gray.delete();
    markerIds.delete();
    markerCorners.delete();
    rejected.delete();
    dictionary.delete();
    params.delete();
    refineParams.delete();
    detector.delete();
  }
}

/* ============================================================
   PERSPECTIVE RECTIFICATION (Phase 6)
   ============================================================
   rectifyImageWithMarker(img, markerCorners, markerSizeMm)
   takes the photo and the four corners of the detected ArUco
   marker, and returns a "rectified" version of the image where
   the plane of the marker is seen orthogonally (from directly
   above). On the rectified image, mm/pixel is constant
   everywhere — which is the whole point of this phase.

   How it works:

   1. We compute the centroid of the detected marker corners
      and the average side length in pixels. These give us
      "where the marker is" and "how big it is" in pixel terms.

   2. We construct an IDEAL square (perfect right angles, all
      sides equal) centred on the same centroid, with the same
      average side length. This is where we want the marker to
      end up in the rectified image.

   3. We ask OpenCV for the perspective transform that maps the
      4 detected (deformed) corners to the 4 ideal corners.

   4. We apply that transform to the whole image with
      warpPerspective. The output has the same dimensions as
      the input (decision C1).

   Why we centre the ideal marker on the original centroid
   instead of placing it at a fixed location:
   The rectified image stays visually similar to the original —
   the marker doesn't jump to a different region. This matters
   for the upcoming "view original" button (phase 6, step 3),
   where the user compares the two side by side.

   Memory: every cv.Mat created here is freed in finally{},
   same pattern as detectArucoMarker.

   Returns:
   {
     image:                  HTMLCanvasElement (rectified photo),
     markerCornersRectified: [{x,y} x 4] in rectified coords,
     mmPerPixelRectified:    Number (constant across image)
   }

   Throws on OpenCV failure; caller is responsible for catching.
   ============================================================ */
function rectifyImageWithMarker(img, markerCorners, markerSizeMm) {
  /* ----------------------------------------------------------
     CORNER REORDERING (canonical / canvas-aligned)
     ----------------------------------------------------------
     OpenCV does NOT guarantee a fixed canvas-aligned ordering
     for the four corners it returns. The order it gives is
     relative to the marker's own orientation (which way the
     marker is "facing"), not relative to the image canvas.
     So if the marker is photographed upside-down or sideways,
     index [0] is NOT the top-left of the image — it's the
     top-left of the marker, which may be anywhere on screen.

     This caused a real bug in our first attempt at this phase:
     a photo with the marker rotated ~180 deg produced a
     rectified image that was also rotated and severely cropped,
     because we paired OpenCV's corners with our "ideal" square
     under a wrong assumption about ordering.

     The fix is to reorder the corners ourselves into a fixed
     canvas-aligned order BEFORE matching them with the ideal
     square. Standard trick:

       TL: corner with min(x + y)   (top-left of canvas)
       BR: corner with max(x + y)   (bottom-right)
       TR: corner with max(x - y)   (top-right)
       BL: corner with min(x - y)   (bottom-left)

     This works because (x+y) and (x-y) are monotonic across
     the diagonals of the canvas, independently of how the
     marker is rotated, as long as the marker is not tilted
     more than 45 deg (which would already trigger our tilt
     warning anyway).
     ---------------------------------------------------------- */
  const sortCornersCanonical = (corners) => {
    const sums  = corners.map(c => c.x + c.y);
    const diffs = corners.map(c => c.x - c.y);
    const idxMin = (arr) => arr.indexOf(Math.min(...arr));
    const idxMax = (arr) => arr.indexOf(Math.max(...arr));
    return [
      corners[idxMin(sums)],   // TL
      corners[idxMax(diffs)],  // TR
      corners[idxMax(sums)],   // BR
      corners[idxMin(diffs)]   // BL
    ];
  };
  const c = sortCornersCanonical(markerCorners);

  /* Geometry of the ideal target square. Centre it on the
     centroid of the (reordered) marker so the rectified image
     looks like the original "straightened in place". */
  const cx = (c[0].x + c[1].x + c[2].x + c[3].x) / 4;
  const cy = (c[0].y + c[1].y + c[2].y + c[3].y) / 4;

  const sideLengthsPx = [
    Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y), // TL -> TR
    Math.hypot(c[2].x - c[1].x, c[2].y - c[1].y), // TR -> BR
    Math.hypot(c[3].x - c[2].x, c[3].y - c[2].y), // BR -> BL
    Math.hypot(c[0].x - c[3].x, c[0].y - c[3].y)  // BL -> TL
  ];
  const avgSidePx = sideLengthsPx.reduce((a, b) => a + b, 0) / 4;
  const half      = avgSidePx / 2;

  /* Ideal square corners in canonical order TL, TR, BR, BL,
     matching the reordered detected corners by index. */
  const ideal = [
    { x: cx - half, y: cy - half }, // TL
    { x: cx + half, y: cy - half }, // TR
    { x: cx + half, y: cy + half }, // BR
    { x: cx - half, y: cy + half }  // BL
  ];

  /* OpenCV expects the points as a 4x1 matrix of CV_32FC2
     (4 points, 2 channels each). cv.matFromArray builds it
     from a flat array of 8 floats. */
  const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    c[0].x, c[0].y,
    c[1].x, c[1].y,
    c[2].x, c[2].y,
    c[3].x, c[3].y
  ]);
  const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    ideal[0].x, ideal[0].y,
    ideal[1].x, ideal[1].y,
    ideal[2].x, ideal[2].y,
    ideal[3].x, ideal[3].y
  ]);

  const src       = cv.imread(img);
  const dst       = new cv.Mat();
  const M         = cv.getPerspectiveTransform(srcPts, dstPts);
  const dsize     = new cv.Size(img.naturalWidth, img.naturalHeight);
  const fillBlack = new cv.Scalar(0, 0, 0, 255);

  try {
    /* ----------------------------------------------------------
       SANITY CHECK
       ----------------------------------------------------------
       Before applying M to the whole image (which is slow), use
       cv.perspectiveTransform to map JUST the 4 detected corners
       through M and verify that each one lands within 1 px of
       its ideal target. If not, M is degenerate / corner order
       is somehow still wrong, and warpPerspective would produce
       garbage.

       cv.perspectiveTransform requires a 1xN matrix of CV_32FC2
       (same layout as the corners we already passed to
       getPerspectiveTransform), and writes the result to another
       matrix of the same shape.
       ---------------------------------------------------------- */
    const checkSrc = cv.matFromArray(4, 1, cv.CV_32FC2, [
      c[0].x, c[0].y,
      c[1].x, c[1].y,
      c[2].x, c[2].y,
      c[3].x, c[3].y
    ]);
    const checkDst = new cv.Mat();
    try {
      cv.perspectiveTransform(checkSrc, checkDst, M);
      const out = checkDst.data32F;
      const errors = [
        Math.hypot(out[0] - ideal[0].x, out[1] - ideal[0].y),
        Math.hypot(out[2] - ideal[1].x, out[3] - ideal[1].y),
        Math.hypot(out[4] - ideal[2].x, out[5] - ideal[2].y),
        Math.hypot(out[6] - ideal[3].x, out[7] - ideal[3].y)
      ];
      const maxError = Math.max(...errors);
      if (maxError > 1.0) {
        throw new Error(
          `Perspective sanity check failed: max corner error = ` +
          `${maxError.toFixed(3)} px (limit 1.0). ` +
          `Per-corner errors: [${errors.map(e => e.toFixed(2)).join(', ')}]`
        );
      }
      console.log(`Perspective sanity OK (max corner error = ` +
                  `${maxError.toFixed(3)} px).`);
    } finally {
      checkSrc.delete();
      checkDst.delete();
    }

    cv.warpPerspective(src, dst, M, dsize,
                       cv.INTER_LINEAR, cv.BORDER_CONSTANT, fillBlack);

    /* Render the result into a regular <canvas>. cv.imshow takes
       a canvas element (or its id) and writes the contents of a
       cv.Mat into it. Despite the name "imshow", this is the
       standard way in OpenCV.js to move pixels from the WASM
       heap back to the DOM. The canvas we create here is
       offscreen (never appended to the DOM); the caller will
       assign it to state.photo and the rest of the app will
       drawImage from it just like any other image element. */
    const outCanvas = document.createElement('canvas');
    outCanvas.width  = img.naturalWidth;
    outCanvas.height = img.naturalHeight;
    cv.imshow(outCanvas, dst);

    /* Extract the 9 homography coefficients before M is deleted
       in finally{}. The caller uses them to transform secondary
       marker corners into rectified space (phase 13) without
       needing to keep a cv.Mat alive outside this function. */
    const homography = Array.from(M.data64F);   // 9 floats, row-major

    return {
      image: outCanvas,
      markerCornersRectified: ideal,
      mmPerPixelRectified: markerSizeMm / avgSidePx,
      homography
    };
  } finally {
    srcPts.delete();
    dstPts.delete();
    src.delete();
    dst.delete();
    M.delete();
  }
}

/* ============================================================
   MULTI-MARKER RECTIFICATION (Phase 16)
   ============================================================
   rectifyImageWithMultipleMarkers(img, markers) takes the photo
   and an array of ≥2 detected marker objects (same structure as
   returned by detectArucoMarker) and computes a robust homography
   using ALL corners of ALL markers via cv.findHomography (least
   squares). This is more accurate than a single-marker homography
   because the larger point set constrains the transform better.

   How the ideal (destination) points are built:
   1. The scale is fixed by the marker with the most pixels per side
      (same rule as phase 6 — more pixels = more precise).
   2. The centroid of all marker centres is computed. This is the
      "anchor" of the rectified image — the image stays visually
      centred on the same region.
   3. For each marker, its ideal centre position is computed by
      taking its real distance from the global centroid (in mm,
      using the global scale) and projecting it onto the image plane
      as if seen orthogonally.
   4. The four ideal corners of each marker are placed as a perfect
      square around its ideal centre, with side = sizeMm / mmPerPx.

   Memory: every cv.Mat created here is freed in finally{}, same
   pattern as rectifyImageWithMarker. Throws on failure; caller
   catches and falls back to single-marker flow.

   Returns the same object shape as rectifyImageWithMarker so the
   caller (applyAutoCalibration) needs no changes.
   ============================================================ */
function rectifyImageWithMultipleMarkers(img, markers) {
  /* Deduplicate by ID: if the same marker ID appears more than once
     (e.g. a print sheet with multiple copies of the same marker),
     keep only the instance with the largest avgSidePx — closest to
     the camera, most pixels per side, most precise scale.
     The multi-marker homography only makes sense when each ID
     represents a physically distinct reference point. */
  const seenIds = new Map();
  markers.forEach(m => {
    const existing = seenIds.get(m.id);
    if (!existing || m.avgSidePx > existing.avgSidePx) {
      seenIds.set(m.id, m);
    }
  });
  markers = Array.from(seenIds.values());
  /* Scale: use the marker with the most pixels per side. */
  const primary = markers.reduce((best, m) =>
    m.avgSidePx > best.avgSidePx ? m : best
  );
  const mmPerPx = primary.sizeMm / primary.avgSidePx;

  /* Compute each marker's centre in detected (distorted) image space. */
  const centres = markers.map(m => ({
    x: (m.corners[0].x + m.corners[1].x + m.corners[2].x + m.corners[3].x) / 4,
    y: (m.corners[0].y + m.corners[1].y + m.corners[2].y + m.corners[3].y) / 4
  }));
  const primaryIdx = markers.indexOf(primary);
  const primaryDetectedCx = centres[primaryIdx].x;
  const primaryDetectedCy = centres[primaryIdx].y;

  /* Ideal position of the primary marker in the rectified image.
     We anchor the primary exactly as phase 6 would: its centre stays
     at its detected centroid, and its four corners form a perfect square
     with side = sizeMm / mmPerPx. This guarantees that phase 16 with
     coplanar markers produces an identical result to phase 6 alone. */
  const primaryHalf = (primary.sizeMm / mmPerPx) / 2;
  const primaryIdealCx = primaryDetectedCx;
  const primaryIdealCy = primaryDetectedCy;

  /* For each marker: build 4 source points (detected corners,
     reordered TL/TR/BR/BL) and 4 destination points (ideal square
     centred on the marker's ideal position). */
  const sortCornersCanonical = (corners) => {
    const sums  = corners.map(c => c.x + c.y);
    const diffs = corners.map(c => c.x - c.y);
    const idxMin = (arr) => arr.indexOf(Math.min(...arr));
    const idxMax = (arr) => arr.indexOf(Math.max(...arr));
    return [
      corners[idxMin(sums)],   // TL
      corners[idxMax(diffs)],  // TR
      corners[idxMax(sums)],   // BR
      corners[idxMin(diffs)]   // BL
    ];
  };

  const srcFlat = [];
  const dstFlat = [];
  let   primaryIdealResult = null;

  markers.forEach((m, idx) => {
    const c    = sortCornersCanonical(m.corners);
    const half = m.avgSidePx / 2;

    /* Ideal centre: displacement from primary's detected centre,
       converted to mm and back to px using the global scale.
       This places each secondary in an orthogonal coordinate system
       anchored on the primary, correcting the perspective distortion
       that was baked into the raw pixel offsets. */
    const offsetXpx = centres[idx].x - primaryDetectedCx;
    const offsetYpx = centres[idx].y - primaryDetectedCy;
    const offsetXmm = offsetXpx * mmPerPx;
    const offsetYmm = offsetYpx * mmPerPx;
    const idealCx = primaryIdealCx + offsetXmm / mmPerPx;
    const idealCy = primaryIdealCy + offsetYmm / mmPerPx;

    /* Ideal corners as a perfect square (TL, TR, BR, BL). */
    const ideal = [
      { x: idealCx - half, y: idealCy - half }, // TL
      { x: idealCx + half, y: idealCy - half }, // TR
      { x: idealCx + half, y: idealCy + half }, // BR
      { x: idealCx - half, y: idealCy + half }  // BL
    ];

    c.forEach((pt, i) => {
      srcFlat.push(pt.x, pt.y);
      dstFlat.push(ideal[i].x, ideal[i].y);
    });

    /* Save the ideal corners of the primary marker so we can
       return markerCornersRectified (same contract as phase 6). */
    if (m === primary) {
      primaryIdealResult = ideal;
    }
  });

  const nPts   = markers.length * 4;   // 4 corners per marker
  const srcMat = cv.matFromArray(nPts, 1, cv.CV_32FC2, srcFlat);
  const dstMat = cv.matFromArray(nPts, 1, cv.CV_32FC2, dstFlat);

  const src       = cv.imread(img);
  const dst       = new cv.Mat();
  /* cv.findHomography: least-squares fit over all N point pairs.
     Method 0 = standard least squares (no outlier rejection).
     We don't use RANSAC here because all points come from
     well-detected ArUco markers — there are no outliers. */
  const M         = cv.findHomography(srcMat, dstMat, 0);
  const dsize     = new cv.Size(img.naturalWidth, img.naturalHeight);
  const fillBlack = new cv.Scalar(0, 0, 0, 255);

  try {
    /* Sanity check: map all source points through M and verify
       each one lands within 2 px of its destination. The tolerance
       is 2 px (vs 1 px in phase 6) because findHomography is a
       least-squares fit — individual points don't land exactly on
       their targets by design. */
    const checkDst = new cv.Mat();
    try {
      cv.perspectiveTransform(srcMat, checkDst, M);
      const out = checkDst.data32F;
      let maxError = 0;
      for (let i = 0; i < nPts; i++) {
        const err = Math.hypot(
          out[i * 2]     - dstFlat[i * 2],
          out[i * 2 + 1] - dstFlat[i * 2 + 1]
        );
        if (err > maxError) maxError = err;
      }
      /* Threshold: if the least-squares fit leaves more than 2.0 px
         of residual error on any point, the markers are likely on
         different planes or have conflicting perspective. Fall back
         to single-marker rectification, which is more accurate in
         that scenario. */
      if (maxError > 15.0) {
        throw new Error(
          `Multi-marker homography rejected: max point error = ` +
          `${maxError.toFixed(2)} px exceeds 15.0 px limit. ` +
          `Falling back to single-marker.`
        );
      }
      console.log(`Multi-marker homography sanity OK (max point error = ` +
                  `${maxError.toFixed(2)} px, ${nPts} points).`);
    } finally {
      checkDst.delete();
    }

    cv.warpPerspective(src, dst, M, dsize,
                       cv.INTER_LINEAR, cv.BORDER_CONSTANT, fillBlack);

    const outCanvas = document.createElement('canvas');
    outCanvas.width  = img.naturalWidth;
    outCanvas.height = img.naturalHeight;
    cv.imshow(outCanvas, dst);

    const homography = Array.from(M.data64F);

    return {
      image:                  outCanvas,
      markerCornersRectified: primaryIdealResult,
      mmPerPixelRectified:    mmPerPx,
      homography
    };
  } finally {
    srcMat.delete();
    dstMat.delete();
    src.delete();
    dst.delete();
    M.delete();
  }
}

/* ============================================================
   TEST HELPER FOR RECTIFICATION — call from browser console
   ============================================================
   Companion to testDetection(). Once you have loaded a photo
   with a visible ArUco marker, type in the console:

       testRectification()

   It detects the best marker, calls rectifyImageWithMarker on
   the original photo (state.originalPhoto if present, otherwise
   the current state.photo), and opens the resulting rectified
   image in a new browser tab so you can inspect it at full
   resolution. The app's view is not modified.

   Used during phase 6 step 1 to validate the rectification
   visually before wiring it into the main flow.

   Note: state.originalPhoto will be introduced in step 2; in
   step 1 it does not exist yet and we fall back to state.photo.
   Both branches keep this helper working without changes.
   ============================================================ */
window.testRectification = function () {
  if (!state.photo) {
    console.log('No photo loaded. Pick a photo first.');
    return;
  }
  const source = state.originalPhoto || state.photo;
  const result = detectArucoMarker(source);
  if (!result.best) {
    console.log('No known marker detected -- cannot rectify.');
    return;
  }
  const m = result.best;
  console.log(`Rectifying with marker ID ${m.id}, ${m.sizeMm} mm...`);

  try {
    const r = rectifyImageWithMarker(source, m.corners, m.sizeMm);
    console.log('Rectification done. New scale: ' +
                `${r.mmPerPixelRectified.toFixed(4)} mm/px (constant).`);
    /* Open the rectified canvas as an image in a new tab so the
       user can inspect it without disturbing the app's canvas. */
    r.image.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    }, 'image/png');
  } catch (err) {
    console.error('Rectification failed:', err);
  }
};


/* ============================================================
   TEST HELPER — call from browser console
   ============================================================
   While we are still in the testing phase (the detection is
   not yet wired into the photo-load flow), this helper lets
   you verify the detector works on the currently-loaded photo.

   Usage: load a photo as you normally would, then in the
   console type:    testDetection()

   It logs the full result to the console and, if a marker was
   found, the implied scale in mm/pixel.
   ============================================================ */
window.testDetection = function () {
  if (!state.photo) {
    console.log('No photo loaded. Pick a photo first.');
    return;
  }
  const result = detectArucoMarker(state.photo);
  console.log('Detection result:', result);
  if (result.best) {
    console.log(`Best marker: ID ${result.best.id}, ` +
                `${result.best.sizeMm} mm, ` +
                `scale = ${result.best.mmPerPixel.toFixed(4)} mm/px, ` +
                `side variance = ${result.best.sideVariance.toFixed(3)}`);
  }
};


/* ============================================================
   WORD REPORT WIZARD — PHASE 24
   ============================================================
   Three-step overlay (same visual pattern as the stereo module):
     Step 1 — Overview photo: fresh pick, ArUco detection informational
     Step 2 — Detail photo: defaults to current canvas, or fresh pick
     Step 3 — Metadata form → renders .docx and triggers download
   Libraries required (local, no network at runtime):
     lib/pizzip.min.js              → window.PizZip
     lib/docxtemplater.min.js       → window.docxtemplater
     lib/docxtemplater-image.min.js → window.ImageModule
       (verify the exact global name after downloading the file)
   Template: templates/inspection_report.docx
     Text markers: {tag}   Image markers: {%tag}
   ============================================================ */

let reportPhotoOverview = null;  // {dataUrl, hasMarker, width, height} or null
let reportPhotoDetail   = null;  // {dataUrl, hasMarker, isCanvas, width, height} or null

/* ---------- entry point ---------- */
document.getElementById('btn-report-panel').addEventListener('click', () => {
  closeLeftPanel();
  openReportWizard();
});
document.getElementById('report-close').addEventListener('click', closeReportWizard);

function openReportWizard() {
  reportPhotoOverview = null;
  reportPhotoDetail   = null;

  /* Reset step 1 UI */
  document.getElementById('report-overview-status').textContent    = '';
  document.getElementById('report-overview-status').className      = 'slot-status';
  document.getElementById('report-overview-preview').style.display = 'none';
  document.getElementById('btn-report-step1-next').disabled        = true;
  document.getElementById('btn-report-load-overview').textContent  = '📷 Load overview photo';

  /* Step 2: pre-populate with the current canvas if a photo is loaded */
  const canvasOpt = document.getElementById('report-detail-canvas-option');
  const sepEl     = document.getElementById('report-detail-sep');
  if (state.photo) {
    /* Export canvas synchronously (exportImage is synchronous) */
    let dataUrl = '';
    exportImage(() => { dataUrl = canvas.toDataURL('image/jpeg', 0.92); });
    document.getElementById('report-detail-canvas-thumb').src = dataUrl;
    reportPhotoDetail = {
      dataUrl, hasMarker: true, isCanvas: true,
      width: canvas.width, height: canvas.height
    };
    canvasOpt.style.display = 'block';
    sepEl.style.display     = 'block';
    document.getElementById('btn-report-step2-next').disabled   = false;
    document.getElementById('report-detail-status').textContent = '';
  } else {
    canvasOpt.style.display = 'none';
    sepEl.style.display     = 'none';
    document.getElementById('btn-report-step2-next').disabled   = true;
    document.getElementById('report-detail-status').textContent = '';
  }

  /* Reset alternative-photo thumbnail */
  document.getElementById('report-detail-alt-preview').style.display = 'none';

  /* Step 3: pre-fill measurements from current session */
  prefillReportForm();

  /* Wire up damage type → direction / other field visibility */
  const dmgTypeSel = document.getElementById('report-damage-type');
  function updateDamageTypeUI() {
    const val = dmgTypeSel.value;
    document.getElementById('report-direction-wrap').style.display =
      (val === 'Dent') ? 'block' : 'none';
    document.getElementById('report-other-wrap').style.display =
      (val === 'Other') ? 'block' : 'none';
  }
  dmgTypeSel.removeEventListener('change', updateDamageTypeUI);
  dmgTypeSel.addEventListener('change', updateDamageTypeUI);
  updateDamageTypeUI();   // apply on open

  showReportStep(1);
  document.getElementById('report-overlay').style.display = 'flex';
}

function closeReportWizard() {
  document.getElementById('report-overlay').style.display = 'none';
  reportPhotoOverview = null;
  reportPhotoDetail   = null;
}

/* ---------- step navigation ---------- */
function showReportStep(n) {
  [1, 2, 3].forEach(i => {
    document.getElementById(`report-step-${i}`).style.display =
      (i === n) ? 'block' : 'none';
  });
  document.getElementById('report-step-label').textContent =
    `📄 Inspection report — Step ${n}/3`;
}

document.getElementById('btn-report-step1-next').addEventListener('click',
  () => showReportStep(2));
document.getElementById('btn-report-step2-back').addEventListener('click',
  () => showReportStep(1));
document.getElementById('btn-report-step2-next').addEventListener('click',
  () => showReportStep(3));
document.getElementById('btn-report-step3-back').addEventListener('click',
  () => showReportStep(2));

/* "Use canvas" button: re-selects the canvas export as the active
   detail photo, e.g. after the inspector loaded an alternative. */
document.getElementById('btn-report-use-canvas').addEventListener('click', () => {
  if (!state.photo) return;
  let dataUrl = '';
  exportImage(() => { dataUrl = canvas.toDataURL('image/jpeg', 0.92); });
  document.getElementById('report-detail-canvas-thumb').src = dataUrl;
  reportPhotoDetail = {
    dataUrl, hasMarker: true, isCanvas: true,
    width: canvas.width, height: canvas.height
  };
  document.getElementById('report-detail-alt-preview').style.display  = 'none';
  document.getElementById('report-detail-status').textContent         = '';
  document.getElementById('btn-report-step2-next').disabled           = false;
});

/* ---------- photo loading ---------- */
function triggerReportFilePick(role) {
  const input = document.createElement('input');
  input.type          = 'file';
  input.accept        = 'image/*';
  input.style.display = 'none';
  document.body.appendChild(input);

  input.addEventListener('change', async () => {
    const file = input.files[0];
    document.body.removeChild(input);
    if (!file) return;

    const statusEl = document.getElementById(
      role === 'overview' ? 'report-overview-status' : 'report-detail-status'
    );
    statusEl.textContent = 'Loading…';
    statusEl.className   = 'slot-status';

    /* HEIC conversion — same pattern as the stereo module */
    const isHeic = /image\/hei[cf]/i.test(file.type || '') ||
                   /\.(heic|heif)$/i.test(file.name || '');
    let blob = file;
    if (isHeic) {
      try {
        const converted = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
        blob = Array.isArray(converted) ? converted[0] : converted;
      } catch (e) {
        statusEl.textContent = '✗ HEIC conversion failed. Try a JPEG.';
        statusEl.className   = 'slot-status error';
        return;
      }
    }

    /* Load into Image element — loadImageFromBlob is defined in the stereo module */
    let img;
    try {
      img = await loadImageFromBlob(blob);
    } catch (e) {
      statusEl.textContent = '✗ Could not read image file.';
      statusEl.className   = 'slot-status error';
      return;
    }

    /* Informational ArUco check — does not block progress */
    const markerResult = detectArucoMarker(img);
    const hasMarker    = !!(markerResult && markerResult.best);

    /* Rasterise to an offscreen canvas to get a clean JPEG dataUrl
       and the image dimensions we need for the Word layout. */
    const off    = document.createElement('canvas');
    off.width    = img.naturalWidth  || img.width;
    off.height   = img.naturalHeight || img.height;
    off.getContext('2d').drawImage(img, 0, 0);
    const dataUrl = off.toDataURL('image/jpeg', 0.90);

    const photoData = {
      dataUrl, hasMarker, isCanvas: false,
      width: off.width, height: off.height
    };

    if (role === 'overview') {
      reportPhotoOverview = photoData;
      document.getElementById('report-overview-thumb').src             = dataUrl;
      document.getElementById('report-overview-preview').style.display = 'block';
      statusEl.textContent = hasMarker
        ? `✓ Marker ID ${markerResult.best.id} detected`
        : 'ℹ No marker detected — you can still continue';
      statusEl.className = hasMarker ? 'slot-status ok' : 'slot-status';
      document.getElementById('btn-report-step1-next').disabled           = false;
      document.getElementById('btn-report-load-overview').textContent     = '📷 Change overview photo';
    } else {
      reportPhotoDetail = photoData;
      document.getElementById('report-detail-alt-thumb').src              = dataUrl;
      document.getElementById('report-detail-alt-preview').style.display  = 'block';
      statusEl.textContent = hasMarker
        ? `✓ Marker ID ${markerResult.best.id} detected`
        : 'ℹ No marker detected — you can still continue';
      statusEl.className = hasMarker ? 'slot-status ok' : 'slot-status';
      document.getElementById('btn-report-step2-next').disabled = false;
    }
  });

  input.click();
}

document.getElementById('btn-report-load-overview').addEventListener('click',
  () => triggerReportFilePick('overview'));
document.getElementById('btn-report-load-detail').addEventListener('click',
  () => triggerReportFilePick('detail'));

/* ---------- form pre-fill ---------- */
function prefillReportForm() {
  /* Damage type: top ONNX detection (labels are lowercase, options Capitalised) */
  if (state.onnxDetections && state.onnxDetections.length > 0) {
    const label = state.onnxDetections[0].label;
    const cap   = label.charAt(0).toUpperCase() + label.slice(1);
    const sel   = document.getElementById('report-damage-type');
    const opt   = Array.from(sel.options).find(o => o.value === cap);
    if (opt) sel.value = cap;
  }

  /* Dimensions: look for measurements named "Length" / "Width" */
  document.getElementById('report-length').value = getDimValueByName('length');
  document.getElementById('report-width').value  = getDimValueByName('width');

  /* Reset direction/other visibility after pre-fill */
  const sel = document.getElementById('report-damage-type');
  if (sel) {
    document.getElementById('report-direction-wrap').style.display =
      sel.value === 'Dent' ? 'block' : 'none';
    document.getElementById('report-other-wrap').style.display = 'none';
  }

  /* Depth: last stereo result if available */
  document.getElementById('report-depth').value =
    state.lastStereoDepthMm !== null ? state.lastStereoDepthMm.toFixed(2) : '';
}

/* Returns the pre-computed mm value (1 dp, as string) of the first
   dimension whose name matches the argument (case-insensitive).
   Uses dim.mm which is set at dimension creation time. */
function getDimValueByName(name) {
  const lc  = name.toLowerCase();
  const dim = state.dimensions.find(d => d.name.toLowerCase() === lc);
  return dim ? dim.mm.toFixed(1) : '';
}

/* ---------- .docx generation ---------- */
document.getElementById('btn-report-generate').addEventListener('click', generateWordReport);

async function generateWordReport() {
  const btn = document.getElementById('btn-report-generate');
  btn.disabled    = true;
  btn.textContent = 'Generating…';

  try {
    /* 1. Collect form values */
    const msn       = document.getElementById('report-msn').value.trim()        || '—';
    const ref       = document.getElementById('report-ref').value.trim()        || '—';
    const location  = document.getElementById('report-location').value.trim()   || '—';
    const inspector = document.getElementById('report-inspector').value.trim()  || '—';
    const dmgTypeRaw = document.getElementById('report-damage-type').value;
    const dmgOther   = document.getElementById('report-damage-other').value.trim();
    const dmgType    = (dmgTypeRaw === 'Other' && dmgOther) ? dmgOther : dmgTypeRaw;
    const dmgDir     = (dmgTypeRaw === 'Dent')
      ? document.getElementById('report-damage-direction').value
      : '';
    const length    = document.getElementById('report-length').value            || '—';
    const width     = document.getElementById('report-width').value             || '—';
    const depth     = document.getElementById('report-depth').value             || '—';
    const frameFrom      = document.getElementById('report-frame-from').value.trim()    || '—';
    const frameTo        = document.getElementById('report-frame-to').value.trim()      || '—';
    const stringerFrom   = document.getElementById('report-stringer-from').value.trim() || '—';
    const stringerTo     = document.getElementById('report-stringer-to').value.trim()   || '—';
    const posFrame    = document.getElementById('report-pos-frame').value    || '—';
    const posStringer = document.getElementById('report-pos-stringer').value || '—';

    /* 2. Build data object (text markers + image dataUrls) */
    const dateStr   = new Date().toLocaleDateString('en-GB');   // DD/MM/YYYY
    const scaleInfo = state.mmPerPixel
      ? `ArUco ID ${state.calibMarkerId ?? 'manual'} — ${state.mmPerPixel.toFixed(3)} mm/px`
      : 'Manual calibration';

    const data = {
      msn, ref, location, inspector,
      damage_type:      dmgType,
      damage_direction: dmgDir,
      damage_label:     dmgDir ? `${dmgType.toLowerCase()} (${dmgDir})` : dmgType.toLowerCase(),
      length, width, depth,
      frame_from: frameFrom, frame_to: frameTo,
      stringer_from: stringerFrom, stringer_to: stringerTo,
      pos_distance_frame: posFrame, pos_distance_stringer: posStringer,
      date: dateStr, scale_info: scaleInfo, tool_version: 'DMT v1.6',
      /* Images disabled until compatible module found — inspector adds manually */
    };

    /* 3. Load template */
    const response = await fetch('./templates/inspection_report.docx');
    if (!response.ok) throw new Error(
      `Template not found (HTTP ${response.status}). ` +
      `Make sure templates/inspection_report.docx exists in the repo root.`
    );
    const arrayBuffer = await response.arrayBuffer();

    /* 4. Initialise docxtemplater with image module.
       IMPORTANT: verify that window.ImageModule is the correct global
       name exposed by lib/docxtemplater-image.min.js after you download
       it. If the file exposes a different name, update the line below. */
    if (!window.PizZip || !window.docxtemplater) {
      throw new Error(
        'Report libraries not loaded. Ensure pizzip.min.js and ' +
        'docxtemplater.min.js are present in lib/.'
      );
    }

    /* Image module disabled: docxtemplater-image-module-free is incompatible
       with modern browsers (namespaceURI is read-only). Photos are embedded
       as text placeholders for now — inspector adds them manually in Word.
       Re-enable once a compatible image module is found. */
    const zip = new window.PizZip(arrayBuffer);
    const doc = new window.docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks:    true,
    });

    /* 5. Render all markers */
    doc.render(data);

    /* 6. Generate blob and trigger download */
    const blob = doc.getZip().generate({
      type:        'blob',
      mimeType:    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      compression: 'DEFLATE',
    });

    const safeMsn  = msn.replace(/[^a-zA-Z0-9_-]/g, '');
    const safeDate = dateStr.replace(/\//g, '-');
    const link     = document.createElement('a');
    link.href      = URL.createObjectURL(blob);
    link.download  = `DMT_${safeMsn}_${safeDate}.docx`;
    link.click();
    URL.revokeObjectURL(link.href);

    closeReportWizard();

  } catch (err) {
    console.error('Phase 24 — report generation failed:', err);
    alert(`Report generation failed:\n${err.message}\n\nSee F12 console for details.`);
  } finally {
    btn.disabled    = false;
    btn.textContent = '📄 Generate .docx';
  }
}

/* Converts a data:image/jpeg;base64,... string to Uint8Array.
   Required by the docxtemplater image module. */
function dataUrlToUint8Array(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  if (!base64) return new Uint8Array(0);
  const binary = atob(base64);
  const arr    = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}

/* ============================================================
   END OF WORD REPORT WIZARD — PHASE 24
   ============================================================ */

setPhase('init');

/* Phase 21: start loading the ONNX model in the background.
   By the time the inspector picks a photo, the model will
   likely already be ready. */
initOnnxModel();

} /* end of initApp() */  
/* ============================================================
   SERVICE WORKER REGISTRATION
   ============================================================
   Registers sw.js so the browser can install it and enable
   offline support. Only runs if the browser supports service
   workers (all modern browsers do; this check is just a safe
   guard for very old ones).
   The 'load' event is used deliberately: we wait until the
   page has fully loaded before registering, so the SW
   installation download does not compete with opencv.js
   loading on the first visit.
   ============================================================ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => console.log('Service worker registered, scope:', reg.scope))
      .catch((err) => console.warn('Service worker registration failed:', err));
  });
}
