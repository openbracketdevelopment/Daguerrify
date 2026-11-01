import { validateDocument, validateAdjustments, type Adjustments, type EditDocument } from '../editor/state/document.js'
import { getPreset, validatePreset } from '../editor/presets/presets.js'

export type RGB = [number, number, number]
export function srgbToLinear(value: number): number {
  return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
}
export function linearToSrgb(value: number): number {
  const c = Math.min(1, Math.max(0, value))
  return c <= .0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - .055
}
export function applyAdjustments(rgb: RGB, values: Adjustments): RGB {
  const a = validateAdjustments(values)
  const t = a.temperature / 100
  const m = a.tint / 100
  const gains = [2 ** (.25 * t + .125 * m), 2 ** (-.25 * m), 2 ** (-.25 * t + .125 * m)]
  const balanced = rgb.map((c, i) => .18 + (c * 2 ** a.exposure * gains[i]! - .18) * 2 ** (a.contrast / 100)) as RGB
  const luma = balanced[0] * .2126 + balanced[1] * .7152 + balanced[2] * .0722
  return balanced.map(c => luma + (c - luma) * (1 + a.saturation / 100)) as RGB
}
export function pipelineParameters(value: EditDocument): { manual: Adjustments; preset: Adjustments | undefined; intensity: number } {
  const document = validateDocument(value)
  const preset = getPreset(document.presetId)
  if (document.presetId && !preset) throw new Error('Unknown preset.')
  return { manual: document.adjustments, preset: preset ? validatePreset(preset).adjustments : undefined, intensity: document.presetIntensity / 100 }
}
export function processPixel(rgb: RGB, alpha: number, document: EditDocument, flattenWhite = false): [number, number, number, number] {
  const params = pipelineParameters(document)
  const neutral = rgb.map(srgbToLinear) as RGB
  const preset = params.preset ? applyAdjustments(neutral, params.preset) : neutral
  const mixed = neutral.map((c, i) => c + (preset[i]! - c) * params.intensity) as RGB
  let graded = applyAdjustments(mixed, params.manual)
  if (flattenWhite) graded = graded.map(c => c * alpha + 1 - alpha) as RGB
  return [...graded.map(linearToSrgb) as RGB, flattenWhite ? 1 : alpha]
}
