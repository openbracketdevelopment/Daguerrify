/// <reference lib="dom" />
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { fixturePath } from './fixtures.ts'

test.beforeEach(async ({ page }) => { await page.goto('/') })

for (const filename of ['chart-ramp.png', 'illustrative-landscape.png', 'illustrative-landscape.jpg', 'orientation-6.jpg']) {
  test(`neutral GPU preview and PNG export preserve normalized ${filename}`, async ({ page }) => {
    const bytes = Array.from(await readFile(fixturePath(filename)))
    const result = await page.evaluate(async ({ bytes, filename }) => {
      const imagePath = '/src/engine/image.ts'
      const rendererPath = '/src/engine/rendering/renderer.ts'
      const { loadImage } = await import(imagePath)
      const { ImageRenderer } = await import(rendererPath)
      const loaded = await loadImage(new File([new Uint8Array(bytes)], filename))
      const canvas = document.createElement('canvas')
      document.body.append(canvas)
      const renderer = new ImageRenderer(canvas)
      const normalized = document.createElement('canvas')
      normalized.width = loaded.width
      normalized.height = loaded.height
      const context = normalized.getContext('2d')!
      context.drawImage(loaded.bitmap, 0, 0)
      const original = Array.from(context.getImageData(0, 0, loaded.width, loaded.height).data)
      renderer.setSource(loaded)
      renderer.setPreviewSize(loaded.width, loaded.height)
      const preview = await new Promise<number[]>(resolve => requestAnimationFrame(() => {
        const gl = canvas.getContext('webgl2')!
        const pixels = new Uint8Array(loaded.width * loaded.height * 4)
        gl.readPixels(0, 0, loaded.width, loaded.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
        // WebGL readback origin is bottom left; browser-normalized images are top left.
        const flipped: number[] = []
        for (let y = loaded.height - 1; y >= 0; y--) flipped.push(...pixels.subarray(y * loaded.width * 4, (y + 1) * loaded.width * 4))
        resolve(flipped)
      }))
      const blob: Blob = await renderer.export('image/png')
      const bitmap = await createImageBitmap(blob)
      context.clearRect(0, 0, normalized.width, normalized.height)
      context.drawImage(bitmap, 0, 0)
      const output = Array.from(context.getImageData(0, 0, bitmap.width, bitmap.height).data)
      const signature = Array.from(new Uint8Array(await blob.arrayBuffer()).slice(0, 8))
      const dimensions = [loaded.width, loaded.height]
      const decodedDimensions = [bitmap.width, bitmap.height]
      renderer.dispose()
      loaded.dispose()
      loaded.dispose()
      bitmap.close()
      canvas.remove()
      return { original, preview, output, signature, dimensions, decodedDimensions }
    }, { bytes, filename })
    expect(result.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(result.decodedDimensions).toEqual(result.dimensions)
    if (filename === 'orientation-6.jpg') {
      expect(result.dimensions).toEqual([48, 80])
      // Orientation 6 rotates clockwise: blue/red occupy the normalized upper half.
      const at = (x: number, y: number) => result.output.slice((y * 48 + x) * 4, (y * 48 + x) * 4 + 3)
      expect(at(8, 8)[2]).toBeGreaterThan(180)
      expect(at(40, 8)[0]).toBeGreaterThan(180)
      expect(at(8, 70)[0]).toBeGreaterThan(180)
      expect(at(40, 70)[1]).toBeGreaterThan(160)
    }
    for (const output of [result.preview, result.output]) {
      expect(output.length).toBe(result.original.length)
      expect(Math.max(...output.map((value, index) => Math.abs(value - result.original[index]!)))).toBeLessThanOrEqual(3)
    }
    expect(Math.max(...result.preview.map((value, index) => Math.abs(value - result.output[index]!)))).toBeLessThanOrEqual(3)
  })
}

test('GPU matches reference math across presets, endpoints, manual controls and before comparison', async ({ page }) => {
  const bytes = Array.from(await readFile(fixturePath('chart-ramp.png')))
  const result = await page.evaluate(async bytes => {
    const imagePath = '/src/engine/image.ts'
    const rendererPath = '/src/engine/rendering/renderer.ts'
    const documentPath = '/src/editor/state/document.ts'
    const presetPath = '/src/editor/presets/presets.ts'
    const colorPath = '/src/engine/color.ts'
    const { loadImage } = await import(imagePath)
    const { ImageRenderer } = await import(rendererPath)
    const { createDocument } = await import(documentPath)
    const { PRESETS } = await import(presetPath)
    const { processPixel } = await import(colorPath)
    const loaded = await loadImage(new File([new Uint8Array(bytes)], 'chart.png'))
    const canvas = document.createElement('canvas')
    const renderer = new ImageRenderer(canvas)
    renderer.setSource(loaded)
    renderer.setPreviewSize(loaded.width, loaded.height)
    const scratch = document.createElement('canvas')
    scratch.width = loaded.width
    scratch.height = loaded.height
    const ctx = scratch.getContext('2d')!
    ctx.drawImage(loaded.bitmap, 0, 0)
    const original = ctx.getImageData(0, 0, loaded.width, loaded.height).data
    const errors: number[] = []
    const outputs: number[][] = []
    const docs = [createDocument()]
    for (const preset of PRESETS) for (const intensity of [0, 35, 100]) {
      docs.push({ ...createDocument(), presetId: preset.id, presetIntensity: intensity })
    }
    for (const key of ['exposure', 'contrast', 'temperature', 'tint', 'saturation']) {
      for (const value of (key === 'exposure' ? [-2, 1, 2] : [-100, 45, 100])) {
        const doc = createDocument()
        doc.adjustments[key] = value
        docs.push(doc)
      }
    }
    const combined = { ...createDocument(), presetId: 'amber-hour', presetIntensity: 63 }
    combined.adjustments = { exposure: .4, contrast: -20, temperature: -35, tint: 25, saturation: -50 }
    docs.push(combined)
    for (const doc of docs) {
      renderer.setDocument(doc)
      const blob: Blob = await renderer.export('image/png')
      const bitmap = await createImageBitmap(blob)
      ctx.drawImage(bitmap, 0, 0)
      const output = Array.from(ctx.getImageData(0, 0, loaded.width, loaded.height).data)
      let error = 0
      for (let i = 0; i < original.length; i += 4) {
        const expected: number[] = processPixel([original[i]! / 255, original[i + 1]! / 255, original[i + 2]! / 255], original[i + 3]! / 255, doc)
        for (let c = 0; c < 4; c++) error = Math.max(error, Math.abs(output[i + c]! - Math.round(expected[c]! * 255)))
      }
      errors.push(error)
      outputs.push(output)
      bitmap.close()
    }
    renderer.render(true)
    const beforeError = await new Promise<number>(resolve => requestAnimationFrame(() => {
      const gl = canvas.getContext('webgl2')!
      const pixels = new Uint8Array(original.length)
      gl.readPixels(0, 0, loaded.width, loaded.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      let error = 0
      for (let y = 0; y < loaded.height; y++) for (let x = 0; x < loaded.width * 4; x++) {
        error = Math.max(error, Math.abs(pixels[(loaded.height - y - 1) * loaded.width * 4 + x]! - original[y * loaded.width * 4 + x]!))
      }
      resolve(error)
    }))
    // Switching back to a previously selected preset must not compound it.
    renderer.setDocument(docs[3])
    const repeated: Blob = await renderer.export('image/png')
    const repeatBitmap = await createImageBitmap(repeated)
    ctx.drawImage(repeatBitmap, 0, 0)
    const repeat = Array.from(ctx.getImageData(0, 0, loaded.width, loaded.height).data)
    repeatBitmap.close()
    renderer.dispose()
    loaded.dispose()
    return { errors, beforeError, repeat, first: outputs[3], neutral: outputs[0], zeroIntensity: outputs[1] }
  }, bytes)
  expect(Math.max(...result.errors)).toBeLessThanOrEqual(3)
  expect(result.beforeError).toBeLessThanOrEqual(3)
  expect(result.repeat).toEqual(result.first)
  expect(result.zeroIntensity).toEqual(result.neutral)
})

test('PNG retains alpha; JPEG flattens graded linear color over white', async ({ page }) => {
  const bytes = Array.from(await readFile(fixturePath('transparent-edges.png')))
  const result = await page.evaluate(async bytes => {
    const imagePath = '/src/engine/image.ts'
    const rendererPath = '/src/engine/rendering/renderer.ts'
    const documentPath = '/src/editor/state/document.ts'
    const colorPath = '/src/engine/color.ts'
    const { loadImage } = await import(imagePath)
    const { ImageRenderer } = await import(rendererPath)
    const { createDocument } = await import(documentPath)
    const { processPixel } = await import(colorPath)
    const source = await loadImage(new File([new Uint8Array(bytes)], 'alpha.png'))
    const renderer = new ImageRenderer(document.createElement('canvas'))
    renderer.setSource(source)
    const doc = createDocument()
    doc.adjustments.exposure = .7
    renderer.setDocument(doc)
    const canvas = document.createElement('canvas')
    canvas.width = source.width
    canvas.height = source.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(source.bitmap, 0, 0)
    const sample = Array.from(ctx.getImageData(24, 20, 1, 1).data)
    const expected: number[] = processPixel(sample.slice(0, 3).map(c => c / 255), sample[3]! / 255, doc, true).map((c: number) => Math.round(c * 255))
    const results: { format: string; signature: number[]; dimensions: number[]; edge: number[]; half: number[]; alpha: number[] }[] = []
    for (const format of ['image/png', 'image/jpeg']) {
      const blob: Blob = await renderer.export(format, .98)
      const bitmap = await createImageBitmap(blob)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(bitmap, 0, 0)
      results.push({
        format, signature: Array.from(new Uint8Array(await blob.arrayBuffer()).slice(0, 8)),
        dimensions: [bitmap.width, bitmap.height],
        edge: Array.from(ctx.getImageData(2, 2, 1, 1).data),
        half: Array.from(ctx.getImageData(24, 20, 1, 1).data),
        alpha: Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data).filter((_, i) => i % 4 === 3),
      })
      bitmap.close()
    }
    renderer.dispose()
    source.dispose()
    return { results, expected }
  }, bytes)
  const [png, jpeg] = result.results
  expect(png!.dimensions).toEqual([96, 64])
  expect(png!.signature).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(png!.edge[3]).toBe(0)
  expect(png!.half[3]).toBe(128)
  expect(jpeg!.signature.slice(0, 2)).toEqual([255, 216])
  expect(jpeg!.dimensions).toEqual([96, 64])
  expect(jpeg!.edge).toEqual([255, 255, 255, 255])
  expect(jpeg!.alpha.every(alpha => alpha === 255)).toBe(true)
  for (let c = 0; c < 3; c++) expect(Math.abs(jpeg!.half[c]! - result.expected[c]!)).toBeLessThanOrEqual(5)
})

test('loader rejects corrupt, unsupported, animated and unsafe dimensions', async ({ page }) => {
  const fixtures = await Promise.all(['corrupt.png', 'unsupported.svg', 'animated.png', 'corrupt-payload.png'].map(async name => ({ name, bytes: Array.from(await readFile(fixturePath(name))) })))
  const errors = await page.evaluate(async fixtures => {
    const imagePath = '/src/engine/image.ts'
    const { loadImage } = await import(imagePath)
    const errors: string[] = []
    for (const fixture of fixtures) {
      try { await loadImage(new File([new Uint8Array(fixture.bytes)], fixture.name)); errors.push('ACCEPTED') }
      catch (error) { errors.push(String(error)) }
    }
    const canvas = document.createElement('canvas')
    canvas.width = 20
    canvas.height = 20
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!)))
    try { await loadImage(new File([blob], 'limited.png'), { maxPixels: 100 }); errors.push('ACCEPTED') }
    catch (error) { errors.push(String(error)) }
    return errors
  }, fixtures)
  expect(errors[0]).toMatch(/truncated|incomplete|corrupt/i)
  expect(errors[1]).toMatch(/JPEG and PNG/i)
  expect(errors[2]).toMatch(/animated/i)
  expect(errors[3]).toMatch(/corrupt|decoded/i)
  expect(errors[4]).toMatch(/pixel/i)
})

test('context loss pauses exports and restoration retains source and settings', async ({ page }) => {
  const bytes = Array.from(await readFile(fixturePath('chart-ramp.png')))
  const result = await page.evaluate(async bytes => {
    const imagePath = '/src/engine/image.ts'
    const rendererPath = '/src/engine/rendering/renderer.ts'
    const documentPath = '/src/editor/state/document.ts'
    const { loadImage } = await import(imagePath)
    const { ImageRenderer } = await import(rendererPath)
    const { createDocument } = await import(documentPath)
    const loaded = await loadImage(new File([new Uint8Array(bytes)], 'chart.png'))
    const canvas = document.createElement('canvas')
    document.body.append(canvas)
    const statuses: { message: string; unavailable: boolean }[] = []
    const renderer = new ImageRenderer(canvas, (message: string, unavailable: boolean) => statuses.push({ message, unavailable }))
    renderer.setSource(loaded)
    const doc = createDocument()
    doc.adjustments.exposure = 1
    renderer.setDocument(doc)
    const decode = async (blob: Blob) => {
      const bitmap = await createImageBitmap(blob)
      const scratch = document.createElement('canvas')
      scratch.width = bitmap.width
      scratch.height = bitmap.height
      const ctx = scratch.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const pixels = Array.from(ctx.getImageData(0, 0, bitmap.width, bitmap.height).data)
      bitmap.close()
      return pixels
    }
    const prior = await decode(await renderer.export('image/png'))
    const gl = canvas.getContext('webgl2')!
    const extension = gl.getExtension('WEBGL_lose_context')
    if (!extension) throw new Error('Software WebGL lacks WEBGL_lose_context')
    const lost = new Promise<void>(resolve => canvas.addEventListener('webglcontextlost', () => resolve(), { once: true }))
    extension.loseContext()
    await lost
    let error = ''
    try { await renderer.export('image/png') } catch (caught) { error = String(caught) }
    await new Promise(resolve => setTimeout(resolve, 100))
    const restored = new Promise<void>(resolve => canvas.addEventListener('webglcontextrestored', () => resolve(), { once: true }))
    extension.restoreContext()
    await restored
    const after = await decode(await renderer.export('image/png'))
    renderer.dispose()
    canvas.remove()
    return { error, statuses, prior, after }
  }, bytes)
  expect(result.error).toMatch(/unavailable|recovery/i)
  expect(result.statuses.some(status => status.unavailable && /lost/i.test(status.message))).toBe(true)
  expect(result.statuses.some(status => !status.unavailable && /restored/i.test(status.message))).toBe(true)
  expect(result.after).toEqual(result.prior)
})

test('renderer guards allocation, thumbnails and disposal without silently losing current source', async ({ page }) => {
  const bytes = Array.from(await readFile(fixturePath('illustrative-landscape.png')))
  const result = await page.evaluate(async bytes => {
    const imagePath = '/src/engine/image.ts'
    const rendererPath = '/src/engine/rendering/renderer.ts'
    const documentPath = '/src/editor/state/document.ts'
    const { loadImage } = await import(imagePath)
    const { ImageRenderer } = await import(rendererPath)
    const { createDocument } = await import(documentPath)
    const loaded = await loadImage(new File([new Uint8Array(bytes)], 'landscape.png'))
    const canvas = document.createElement('canvas')
    const renderer = new ImageRenderer(canvas)
    renderer.setSource(loaded)
    const doc = createDocument()
    doc.presetId = 'midnight-blue'
    renderer.setDocument(doc)
    const thumbnail: string = await renderer.thumbnail(createDocument(), 80)
    const thumbnailBitmap = await createImageBitmap(await (await fetch(thumbnail)).blob())
    const thumbnailDimensions = [thumbnailBitmap.width, thumbnailBitmap.height]
    thumbnailBitmap.close()
    const errors: string[] = []
    try { renderer.setPreviewSize(9000, 9000) } catch (error) { errors.push(String(error)) }
    try { await renderer.thumbnail(doc, 513) } catch (error) { errors.push(String(error)) }
    try { renderer.setDocument({ ...doc, pipelineVersion: 9 }) } catch (error) { errors.push(String(error)) }
    try { await renderer.export('image/jpeg', Number.NaN) } catch (error) { errors.push(String(error)) }
    const replacement = await loadImage(new File([new Uint8Array(bytes)], 'replacement.png'))
    replacement.dispose()
    try { renderer.setSource(replacement) } catch (error) { errors.push(String(error)) }
    const output: Blob = await renderer.export('image/png')
    const bitmap = await createImageBitmap(output)
    const dimensions = [bitmap.width, bitmap.height]
    bitmap.close()
    renderer.dispose()
    renderer.dispose()
    try { await renderer.export('image/png') } catch (error) { errors.push(String(error)) }
    return { thumbnail, thumbnailDimensions, dimensions, errors }
  }, bytes)
  expect(result.thumbnail).toMatch(/^data:image\/png;/)
  expect(result.thumbnailDimensions).toEqual([80, 48])
  expect(result.dimensions).toEqual([160, 96])
  expect(result.errors).toHaveLength(6)
  expect(result.errors[0]).toMatch(/limit/i)
  expect(result.errors[1]).toMatch(/512/i)
  expect(result.errors[2]).toMatch(/version/i)
  expect(result.errors[3]).toMatch(/quality/i)
  expect(result.errors[4]).toMatch(/decoded|available/i)
  expect(result.errors[5]).toMatch(/disposed/i)
})

test('an asynchronous export is a stable snapshot while replacing the renderer source', async ({ page }) => {
  const fixtures = await Promise.all(['chart-ramp.png', 'transparent-edges.png'].map(async name => ({ name, bytes: Array.from(await readFile(fixturePath(name))) })))
  const result = await page.evaluate(async fixtures => {
    const imagePath = '/src/engine/image.ts'
    const rendererPath = '/src/engine/rendering/renderer.ts'
    const documentPath = '/src/editor/state/document.ts'
    const { loadImage } = await import(imagePath)
    const { ImageRenderer } = await import(rendererPath)
    const { createDocument } = await import(documentPath)
    const first = await loadImage(new File([new Uint8Array(fixtures[0]!.bytes)], fixtures[0]!.name))
    const next = await loadImage(new File([new Uint8Array(fixtures[1]!.bytes)], fixtures[1]!.name))
    const renderer = new ImageRenderer(document.createElement('canvas'))
    renderer.setSource(first)
    const toBlob = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      toBlob.call(this, blob => setTimeout(() => callback(blob), 100), type, quality)
    }
    try {
      const pending: Promise<Blob> = renderer.export('image/png')
      const errors: string[] = []
      try { await renderer.export('image/png') } catch (error) { errors.push(String(error)) }
      try { await renderer.thumbnail(createDocument()) } catch (error) { errors.push(String(error)) }
      renderer.setSource(next)
      first.dispose()
      const doc = createDocument()
      doc.adjustments.exposure = 1
      renderer.setDocument(doc)
      const snapshot = await createImageBitmap(await pending)
      const snapshotDimensions = [snapshot.width, snapshot.height]
      const scratch = document.createElement('canvas')
      scratch.width = snapshot.width
      scratch.height = snapshot.height
      const ctx = scratch.getContext('2d')!
      ctx.drawImage(snapshot, 0, 0)
      const gray = Array.from(ctx.getImageData(128, 20, 1, 1).data)
      snapshot.close()
      const replacement = await createImageBitmap(await renderer.export('image/png'))
      const replacementDimensions = [replacement.width, replacement.height]
      replacement.close()
      return { errors, snapshotDimensions, replacementDimensions, gray }
    } finally {
      HTMLCanvasElement.prototype.toBlob = toBlob
      renderer.dispose()
      next.dispose()
    }
  }, fixtures)
  expect(result.errors).toHaveLength(2)
  expect(result.errors.every(error => /already.*encoded/i.test(error))).toBe(true)
  expect(result.snapshotDimensions).toEqual([256, 96])
  expect(result.replacementDimensions).toEqual([96, 64])
  for (const channel of result.gray.slice(0, 3)) expect(Math.abs(channel - 128)).toBeLessThanOrEqual(3)
})
