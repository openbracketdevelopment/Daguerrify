# Daguerrify

**A new take on the digital darkroom.**

A local-only browser photo editor built with Svelte, strict TypeScript, Vite,
WebGL2 and original GLSL algorithms. Open a photo, adjust exposure, contrast,
relative temperature, tint and saturation, explore five original presets,
compare before/after, undo/redo, and download a new JPEG or PNG.

## Run

Node **22.12 or newer** is required; Node 24 LTS is recommended.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Production:

```sh
npm run build
npm run preview
```

Deploy `dist/` to a static web host. No backend or environment variables needed.

## Verify

```sh
npm run check
npm test
npx playwright install --with-deps chromium
npm run test:browser
npm run build
```

Vitest covers edit validation, neutral values, presets, history, color math and
dimension limits. Playwright exercises real Chromium WebGL2 with software GPU
support for deterministic CI, input handling, editing and downloads. GPU color
comparisons use tolerances rather than byte-identical files. Generated fixtures
are original illustrative drawings, not third-party photographs.
`tests/browser/fixtures.ts` generates the chart/gray ramp, transparent edges,
textured landscape and a quadrant JPEG with EXIF orientation 6, plus intentionally
invalid/animated samples. The fixtures are redistributable under this repository's
license. Encoded bytes can vary with browser versions.
GitHub Actions runs checks, both test suites, and the production build.

## Formats, device limits and privacy

- Static JPEG/JPG and PNG only. Actual signatures, header information and decoded
  content are validated. Animated inputs (including APNG), unsupported files and
  corrupt images are rejected with an explanation.
- Configurable initial limits: **20 MiB per file, 16 million decoded pixels**,
  **8192 pixels per dimension**, a **256 MiB estimated working-memory ceiling**,
  and detected texture, renderbuffer and viewport limits.
  These are ceilings, not a guarantee that a device can process every accepted
  image. Original-resolution export needs additional readback/encoding memory
  and may be refused even when a photo fits the import limit. Replacing a large
  photo also temporarily needs both sources in memory. Allocation failures are
  reported. Limits are defined in `src/engine/image.ts`; callers can lower them.
- A current browser with **WebGL2** is required. Context loss preserves the
  original and settings and attempts recovery; no silently unedited exports.
- Images, names, metadata and settings are never uploaded. No analytics, remote
  fonts or runtime third-party scripts. Network is only needed to fetch the
  application assets initially.
- Keep the original unchanged in memory during the session; export creates a
  separate file. Nothing persists after closing/reloading the page.

## Editing model

Every render comes from the normalized original plus a versioned edit document.
Changing presets does not accumulate processing. Amber Hour, Faded Summer,
Midnight Blue, Silver Study and Soft Light are original parameter-based looks.
Preset intensity blends in linear RGB, then manual adjustments apply.
They do not contain grain, curves, LUTs or proprietary processing.

Slider gestures form one history action. Reset actions are undoable.
Zoom, pan and before/after are separate view state, not edits.
Keyboard sliders use arrow keys; undo uses Ctrl/Cmd+Z, redo Ctrl/Cmd+Shift+Z
or Ctrl/Cmd+Y. Use visible controls for fit, zoom and comparison.

## Preview, color and export

Previews use a reduced buffer, capped device-pixel ratio and viewport fitting.
Exports render the original normalized dimensions with exactly the same shader,
not a preview or screenshot. Unsafe original-size exports are refused;
there is no silent downscaling or tiled export.

PNG preserves transparency. JPEG visibly flattens on **white** and offers quality
control. Downloads use sanitized names such as `photo-daguerrify.jpg`.
The original file is not overwritten.

The v1 pipeline targets ordinary SDR sRGB: explicit linear-light exposure and
balance, contrast about linear .18, luminance-based saturation, final sRGB
encoding. Temperature is relative cool/warm, not calibrated Kelvin.
EXIF orientation is applied once by browser decoding.
Browser profile conversion/encoding behavior varies: this is **not** comprehensive
ICC-managed or HDR editing. No guaranteed metadata removal or ICC/profile
preservation is claimed. Nearest source sampling avoids transparent interpolation
halos but reduced previews can alias fine detail.
Automated graphics coverage targets Chromium with software WebGL; hardware-GPU
and other-browser color/encoding behavior still needs device-specific testing.

See [image pipeline](docs/image-pipeline.md), [architecture](docs/architecture.md),
[product brief](docs/product-brief.md), and [implementation plan](docs/implementation-plan.md).

## Dependency note

Dependencies are pinned with a committed lockfile. At implementation time,
`npm audit --omit=dev` reports no production vulnerabilities. The Svelte Vite
plugin depends on `deepmerge`, for which npm reports the low-severity
[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)
prototype-poisoning advisory with no patched release. Here it merges only
trusted local build configuration, never photos or user settings, and is not
included as a runtime image-processing dependency. Recheck advisories when
updating the build toolchain.

## Roadmap

1. **Implemented:** local JPEG/PNG editing, five controls/presets, history,
   comparison, zoom/pan, export, responsive accessibility.
2. Crop/rotate/resize, highlights/shadows, curves, vignette, grain.
3. IndexedDB sessions, versioned recipes, custom presets, LUTs.
4. Profile-driven workers/OffscreenCanvas, tiled export, broader color management,
   and optional benchmark-justified WebGPU.
5. Optional ByteDown and specialized WebAssembly codecs; actual camera RAW
   support as a separately scoped project.

No layers, masks, brushes, healing, RAW processing, accounts, database or cloud
storage are included in Milestone 1.
