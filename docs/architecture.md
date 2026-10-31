# Architecture

One deployable static Svelte + strict TypeScript + Vite application.

- `src/components`: accessible UI controls.
- `src/editor/state`: validated, versioned edit documents and original presets.
- `src/editor/history`: bounded edit snapshots, gesture grouping and branching.
- `src/engine`: browser image validation/loading and Svelte-independent WebGL2
  renderer, GLSL shaders, reference color math, and export limits.
- `src/styles`: plain CSS design tokens and responsive layout.
- `tests`: Vitest and Playwright. Fixtures are generated from original drawings.

The source reference (File and normalized decoded image) is separate from
editing settings. View zoom/pan and comparison are not edit history. A renderer
accepts source, settings, preview dimensions and render requests, and exposes
export and disposal. It never imports Svelte. Workers/OffscreenCanvas can later
be introduced at this boundary, only after profiling.

Imports use generation tokens: obsolete asynchronous loads are disposed, and
validation or GPU failures do not replace the current source. Upload a new
texture only on source change. Coalesce preview edits with requestAnimationFrame;
do not run an idle render loop. ResizeObserver and capped DPR control buffers.
Generate small preset thumbnails in deferred tasks, using the same shader,
and discard stale work.

WebGL2 context loss suspends processing with an explanatory message; restoration
rebuilds shader/texture resources from retained source and settings. Disposal
cancels scheduled work, closes decoded bitmaps and deletes GPU resources.
Downloads use temporary object URLs that are revoked after use.

No backend, persistence, API keys, `.env`, or runtime network services are needed.
Test/build CI and a committed npm lockfile make development reproducible.

## Verified API references

Dependency selection follows the stable package registry releases and official
documentation (retrieved through the projects' GitHub sources when the sites
were unavailable):

- [Svelte overview](https://svelte.dev/docs/svelte/overview) and
  [`$state`](https://svelte.dev/docs/svelte/$state): Svelte 5 mount/reactivity.
- [Vite guide](https://vite.dev/guide/): `create-vite --template svelte-ts`,
  development, production build and static preview.
- [Vitest guide](https://vitest.dev/guide/): `vitest run` and configuration.
- [Playwright CLI](https://playwright.dev/docs/test-cli): Chromium installation,
  test execution and browser configuration.
- [createImageBitmap](https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap):
  EXIF `from-image`, straight alpha and implementation-specific color conversion.
- [setup-node](https://github.com/actions/setup-node) and
  [checkout](https://github.com/actions/checkout): Node 24, lockfile caching,
  read-only permissions and disabled persisted credentials.

Use Node 24 LTS for development/CI. No additional application-level image,
scene-graph, UI or color-processing dependencies are introduced.
