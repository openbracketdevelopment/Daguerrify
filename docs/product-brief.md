# Daguerrify

**A new take on the digital darkroom.**

A focused browser photo editor: open a local photograph, make five photographic
adjustments, explore five original looks, compare, and download a new image.
No accounts, server processing, analytics, remote fonts, or third-party scripts.
The original file remains unchanged throughout the session.

## Milestone 1

Static JPEG/PNG import; fit, zoom and pan; exposure, contrast, relative temperature,
tint and saturation; Amber Hour, Faded Summer, Midnight Blue, Silver Study and
Soft Light with intensity; before/after; bounded settings-based undo/redo;
individual and global reset; original-resolution JPEG/PNG export.

Dark neutral surfaces, warm accent, system typography, a photo-first workspace,
keyboard-accessible controls, mobile stacking and explicit busy/error states.
This is original software and styling, not an Adobe interface or compatible
implementation of another editor's processing.

## Constraints and success

20 MiB files, 16 million decoded pixels, and GPU-dependent dimension limits are
conservative configurable ceilings, not a promise that every device can edit
every accepted photo. Animated, corrupt and unsupported images are rejected.
Exports use the same original and algorithms as previews, never a screenshot,
and never silently downscale. PNG retains alpha; JPEG visibly flattens on white.

Success means the complete import/edit/compare/export loop works on desktop and
small screens, failures preserve the current photo, tests describe actual
behavior, and the production build succeeds.
