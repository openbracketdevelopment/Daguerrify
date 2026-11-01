# Redistributable generated image fixtures

All artwork in this directory is original procedural illustration, not a
photograph of a real place or a third-party asset. These fixtures are dedicated
to the public domain under CC0-1.0 and may be redistributed.

The generator uses browser canvas encoding only; encoded bytes can vary across
browser versions. Regenerate using the existing installed Playwright Chromium:

```sh
node --input-type=module -e "import {chromium} from '@playwright/test'; import {generateFixtures} from './tests/browser/fixtures.ts'; const browser=await chromium.launch(); await generateFixtures(await browser.newPage()); await browser.close();"
```

- `chart-ramp.png`: 256 × 96 neutral gray ramp and eight color patches.
- `transparent-edges.png`: 96 × 64 transparent border, half-alpha colored area,
  and opaque blue center.
- `illustrative-landscape.png` / `.jpg`: 160 × 96 synthetic textured landscape.
- `orientation-6.jpg`: 80 × 48 encoded quadrants with a proper APP1 Exif
  little-endian TIFF orientation 6; normalized dimensions are 48 × 80.
- `animated.png`: one-frame APNG with CRC-valid `acTL` and `fcTL` animation chunks,
  deliberately unsupported by the static-image importer.
- `corrupt.png`: intentionally truncated PNG.
- `corrupt-payload.png`: valid PNG framing and CRCs with invalid compressed image
  data, exercising decoder failure rather than header rejection.
- `unsupported.svg`: valid SVG, deliberately outside the accepted formats.

Tests compare decoded pixels with tolerances, never encoded-byte identity.
