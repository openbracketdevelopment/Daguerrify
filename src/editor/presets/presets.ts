import { NEUTRAL, PRESET_IDS, validateAdjustments, type Adjustments, type PresetId } from '../state/document'

export interface Preset {
  id: PresetId
  name: string
  version: 1
  description: string
  adjustments: Adjustments
}

export const PRESETS: readonly Preset[] = [
  { id: 'amber-hour', name: 'Amber Hour', version: 1, description: 'Warm, luminous color', adjustments: { ...NEUTRAL, exposure: .2, temperature: 65, tint: 8, saturation: 15, contrast: 12 } },
  { id: 'faded-summer', name: 'Faded Summer', version: 1, description: 'Airy warmth, quieter color', adjustments: { ...NEUTRAL, exposure: .1, contrast: -35, temperature: 30, saturation: -20 } },
  { id: 'midnight-blue', name: 'Midnight Blue', version: 1, description: 'Cool, deep and cinematic', adjustments: { ...NEUTRAL, exposure: -.35, contrast: 28, temperature: -60, tint: 12, saturation: -15 } },
  { id: 'silver-study', name: 'Silver Study', version: 1, description: 'A crisp monochrome study', adjustments: { ...NEUTRAL, contrast: 25, saturation: -100 } },
  { id: 'soft-light', name: 'Soft Light', version: 1, description: 'Gentle contrast, subtle warmth', adjustments: { ...NEUTRAL, exposure: .15, contrast: -20, temperature: 12, tint: 6, saturation: -8 } },
]

export function validatePreset(preset: Preset): Preset {
  if (preset.version !== 1 || !PRESET_IDS.includes(preset.id)) throw new Error('Unsupported preset definition.')
  return { ...preset, adjustments: validateAdjustments(preset.adjustments) }
}

export function getPreset(id: PresetId | null): Preset | undefined {
  return PRESETS.find(preset => preset.id === id)
}
