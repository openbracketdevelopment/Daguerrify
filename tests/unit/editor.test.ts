import { describe, expect, it } from 'vitest'
import { EditHistory } from '../../src/editor/history/history.js'
import { PRESETS, getPreset, validatePreset, type Preset } from '../../src/editor/presets/presets.js'
import { createDocument, NEUTRAL, validateAdjustments, validateDocument, type EditDocument } from '../../src/editor/state/document.js'

const exposed = (exposure: number): EditDocument => ({
  ...createDocument(), adjustments: { ...NEUTRAL, exposure },
})

describe('edit document', () => {
  it('starts neutral with a version and no preset', () => {
    expect(createDocument()).toEqual({
      pipelineVersion: 1, adjustments: NEUTRAL, presetId: null, presetIntensity: 100,
    })
  })
  it('clamps finite parameters and replaces nonfinite values', () => {
    expect(validateAdjustments({
      exposure: 20, contrast: -200, temperature: Infinity, tint: NaN, saturation: 400,
    })).toEqual({ exposure: 2, contrast: -100, temperature: 0, tint: 0, saturation: 100 })
    expect(validateAdjustments({ exposure: -30 })).toEqual({ ...NEUTRAL, exposure: -2 })
  })
  it('clamps preset intensity and rejects unsupported state', () => {
    expect(validateDocument({ ...createDocument(), presetIntensity: -1 }).presetIntensity).toBe(0)
    expect(validateDocument({ ...createDocument(), presetIntensity: 101 }).presetIntensity).toBe(100)
    expect(() => validateDocument({ ...createDocument(), pipelineVersion: 2 } as unknown as EditDocument)).toThrow('version')
    expect(() => validateDocument({ ...createDocument(), presetId: 'foreign-preset' } as unknown as EditDocument)).toThrow('preset')
  })
  it('returns independent neutral documents', () => {
    const document = createDocument()
    document.adjustments.exposure = 1
    expect(createDocument().adjustments.exposure).toBe(0)
  })
})

describe('original presets', () => {
  it('contains five unique supported, versioned definitions', () => {
    expect(PRESETS.map(preset => preset.name)).toEqual([
      'Amber Hour', 'Faded Summer', 'Midnight Blue', 'Silver Study', 'Soft Light',
    ])
    expect(new Set(PRESETS.map(preset => preset.id)).size).toBe(5)
    for (const preset of PRESETS) {
      expect(validatePreset(preset)).toEqual(preset)
      expect(Object.keys(preset.adjustments).sort()).toEqual(Object.keys(NEUTRAL).sort())
      expect(getPreset(preset.id)).toBe(preset)
    }
    expect(getPreset(null)).toBeUndefined()
  })
  it('rejects unknown preset versions', () => {
    expect(() => validatePreset({ ...PRESETS[0], version: 99 } as unknown as Preset)).toThrow()
  })
})

describe('settings history', () => {
  it('groups continuous slider updates into one action', () => {
    const history = new EditHistory(createDocument())
    history.begin()
    history.update(exposed(.2))
    history.update(exposed(.8))
    history.update(exposed(1.2))
    history.end()
    expect(history.undo()).toEqual(createDocument())
    expect(history.canUndo).toBe(false)
    expect(history.redo()).toEqual(exposed(1.2))
  })
  it('records separate keyboard/button changes', () => {
    const history = new EditHistory(createDocument())
    history.update(exposed(.1))
    history.update(exposed(.2))
    expect(history.undo()).toEqual(exposed(.1))
    expect(history.undo()).toEqual(createDocument())
  })
  it('clears a redo branch on a new edit', () => {
    const history = new EditHistory(createDocument())
    history.update(exposed(1))
    history.update(exposed(2))
    history.undo()
    expect(history.canRedo).toBe(true)
    history.update(exposed(-1))
    expect(history.canRedo).toBe(false)
    expect(history.redo()).toEqual(exposed(-1))
  })
  it('makes all-edit reset undoable, including presets', () => {
    const edited: EditDocument = { ...exposed(1), presetId: 'amber-hour', presetIntensity: 42 }
    const history = new EditHistory(edited)
    history.update(createDocument())
    expect(history.undo()).toEqual(edited)
    expect(history.redo()).toEqual(createDocument())
  })
  it('makes per-control reset undoable without changing other controls', () => {
    const edited = exposed(1)
    edited.adjustments.tint = 40
    const history = new EditHistory(edited)
    history.update({ ...edited, adjustments: { ...edited.adjustments, exposure: 0 } })
    expect(history.value.adjustments.tint).toBe(40)
    expect(history.undo()).toEqual(edited)
  })
  it('bounds snapshots and does not record no-ops', () => {
    const history = new EditHistory(createDocument(), 2)
    history.update(exposed(.1))
    history.update(exposed(.2))
    history.update(exposed(.3))
    history.begin()
    history.update(exposed(.3))
    history.end()
    expect(history.undo()).toEqual(exposed(.2))
    expect(history.undo()).toEqual(exposed(.1))
    expect(history.canUndo).toBe(false)
  })
  it('finalizes an in-progress gesture on undo', () => {
    const history = new EditHistory(createDocument())
    history.begin()
    history.update(exposed(1))
    expect(history.undo()).toEqual(createDocument())
    expect(history.redo()).toEqual(exposed(1))
  })
  it('does not expose mutable snapshots or retain caller objects', () => {
    const initial = createDocument()
    const history = new EditHistory(initial)
    initial.adjustments.exposure = 2
    const value = history.value
    value.adjustments.exposure = -2
    expect(history.value).toEqual(createDocument())
    const next = exposed(1)
    history.update(next)
    next.adjustments.exposure = 2
    expect(history.undo()).toEqual(createDocument())
    expect(history.redo()).toEqual(exposed(1))
  })
})
