export const PIPELINE_VERSION = 1 as const
export const ADJUSTMENT_KEYS = ['exposure', 'contrast', 'temperature', 'tint', 'saturation'] as const
export type AdjustmentKey = typeof ADJUSTMENT_KEYS[number]
export type Adjustments = Record<AdjustmentKey, number>
export type PresetId = 'amber-hour' | 'faded-summer' | 'midnight-blue' | 'silver-study' | 'soft-light'
export interface EditDocument {
  pipelineVersion: typeof PIPELINE_VERSION
  adjustments: Adjustments
  presetId: PresetId | null
  presetIntensity: number
}
export const PRESET_IDS: readonly PresetId[] = ['amber-hour', 'faded-summer', 'midnight-blue', 'silver-study', 'soft-light']
export const NEUTRAL: Readonly<Adjustments> = Object.freeze({
  exposure: 0, contrast: 0, temperature: 0, tint: 0, saturation: 0,
})
export const CONTROL_LABELS: Record<AdjustmentKey, string> = {
  exposure: 'Exposure', contrast: 'Contrast', temperature: 'Temperature', tint: 'Tint', saturation: 'Saturation',
}

export function clampValue(value: unknown, min: number, max: number, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

export function validateAdjustments(value: Partial<Adjustments> = {}): Adjustments {
  return Object.fromEntries(ADJUSTMENT_KEYS.map(key => [
    key, clampValue(value[key], key === 'exposure' ? -2 : -100, key === 'exposure' ? 2 : 100),
  ])) as Adjustments
}

export function createDocument(): EditDocument {
  return { pipelineVersion: PIPELINE_VERSION, adjustments: { ...NEUTRAL }, presetId: null, presetIntensity: 100 }
}

export function validateDocument(value: EditDocument): EditDocument {
  if (value.pipelineVersion !== PIPELINE_VERSION) throw new Error('Unsupported editing pipeline version.')
  if (value.presetId !== null && !PRESET_IDS.includes(value.presetId)) throw new Error('Unknown preset.')
  return {
    pipelineVersion: PIPELINE_VERSION,
    adjustments: validateAdjustments(value.adjustments),
    presetId: value.presetId,
    presetIntensity: clampValue(value.presetIntensity, 0, 100, 100),
  }
}

export function cloneDocument(value: EditDocument): EditDocument {
  return { ...value, adjustments: { ...value.adjustments } }
}

export function documentsEqual(a: EditDocument, b: EditDocument): boolean {
  return a.pipelineVersion === b.pipelineVersion && a.presetId === b.presetId &&
    a.presetIntensity === b.presetIntensity && ADJUSTMENT_KEYS.every(key => a.adjustments[key] === b.adjustments[key])
}
