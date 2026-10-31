# Image pipeline v1

## Input and color assumptions

Accept only static JPEG and PNG. Inspect signatures, PNG chunks (reject `acTL`)
and JPEG dimensions before decoding. Limit files to 20 MiB, decoded pixels to
16,000,000, and each dimension to 8192 or the detected texture/renderbuffer/viewport
limit, whichever is smaller. Estimate working allocations against a 256 MiB
ceiling (not a browser memory measurement). Export and atomic source replacement
need more memory than preview, so some accepted photos cannot be exported or
replaced together at full size. Callers can lower the defaults in
`src/engine/image.ts`. Validate decoded dimensions as well. Browser decoding must
succeed. Retain the original File unchanged.

Use browser decoding with EXIF orientation applied by the decoder **once**;
never apply a second manual rotation. Store normalized dimensions separately
from reduced preview dimensions. Decode color conversion is browser-default.
We target ordinary SDR sRGB; wide-gamut/ICC normalization can vary by browser,
and comprehensive ICC accuracy, HDR, profile preservation and guaranteed
metadata stripping are not claimed.

## Pointwise processing

One high-precision fragment pass; no per-adjustment 8-bit intermediate textures.
Sample normalized sRGB, transform each channel into linear RGB:

`c <= .04045 ? c / 12.92 : ((c + .055) / 1.055)^2.4`.

An adjustment stage, in order:

1. Exposure: `rgb *= 2^EV`, EV in [-2, 2], neutral 0.
2. Relative temperature and tint: diagonal linear RGB gains
   `2^(0.25*T + 0.125*M)`, `2^(-0.25*M)`,
   `2^(-0.25*T + 0.125*M)` for R, G, B, with T/M in [-1, 1].
   This is a relative balance, **not Kelvin**.
3. Contrast: `rgb = .18 + (rgb - .18) * 2^C`, C in [-1, 1].
4. Saturation: `rgb = mix(vec3(dot(rgb, [.2126,.7152,.0722])), rgb, 1+S)`,
   S in [-1, 1]. Neutral contrast, balance and saturation controls are 0.

The user-facing contrast/temperature/tint/saturation values are divided by 100.
Preset stage uses these same operations, then blends neutral linear RGB with
preset linear RGB at intensity / 100. Manual adjustments follow the blend.
Intensity zero is exactly neutral; switching presets never compounds edits.

Clamp RGB only at the final output to [0,1], then encode sRGB:
`c <= .0031308 ? 12.92*c : 1.055*c^(1/2.4)-.055`.
All parameters are finite and clamped; unknown pipeline/preset versions fail.
CPU reference math is unit-tested against the same definitions.

## Alpha, preview and export

Upload straight alpha without premultiplication. Avoid interpolation halos by
sampling source texels deliberately (nearest for initial pointwise rendering);
the browser composites the display canvas over a checkerboard. Grade RGB only,
never alpha. Transparent PNG output keeps source alpha. JPEG flattens graded
linear RGB over a clearly displayed white background before sRGB encoding.
No hidden black flattening or silently unedited fallback.

Reduced preview dimensions are bounded by viewport, DPR capped at 2 and a
configurable longest-side cap. View zoom/pan is CSS/display state, not processing.
Export renders the full normalized source through the same shader into a
separate buffer, then browser canvas encodes PNG or quality-controlled JPEG.
Check texture, renderbuffer, pixel and conservative memory ceilings before
allocation. Refuse unsafe full-size exports; no tiled or smaller export yet.

Neutral output should match browser-normalized pixels within approximately
2–3/255 per RGB channel at equal resolution (GPU rounding varies).
Encoded bytes are not expected to match. Downsampled previews may differ in
fine spatial detail; equivalent-size preview/export tests compare pixel colors.
Resource allocation can still fail below ceilings and must report an error.
