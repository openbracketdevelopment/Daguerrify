# Implementation plan

## Milestone 1 — this task

1. Document product, architecture and exact color/alpha pipeline.
2. Scaffold Svelte/TypeScript/Vite; verify official APIs and compatible packages.
3. Implement typed settings, original preset data, validation, gesture history.
4. Build guarded JPEG/PNG loader and independent WebGL2 renderer/export.
5. Connect accessible responsive workspace, view controls, comparison and export.
6. Add generated fixtures, unit/GPU browser tests, developer README and CI.
7. Run strict checking, tests, build, manual browser inspection and safety checks.

## Later milestones — not implemented

- **2:** crop, rotate, resize, refined highlights/shadows, curves, vignette, grain.
- **3:** IndexedDB sessions, versioned editing recipes, custom presets, LUTs.
- **4:** measured worker/OffscreenCanvas work, tiled large-image export,
  comprehensive color management, optional benchmark-justified WebGPU backend.
- **5:** optional ByteDown integration, specialized WebAssembly codecs,
  actual camera RAW as a separately scoped project.

Layers, masks, brushes, healing/content-aware tools, AI services, accounts and
cloud storage are outside this initial application. Do not imply these exist.
