import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDocument, NEUTRAL } from '../../src/editor/state/document'
import { getPreset, PRESETS } from '../../src/editor/presets/presets'
import { applyAdjustments, linearToSrgb, processPixel, srgbToLinear, type RGB } from '../../src/engine/color'
import { DEFAULT_LIMITS, loadImage, parseImageHeader, parseJpeg, parsePng, pngChunkCrc, resolveLimits, validateDimensions } from '../../src/engine/image'
import { ImageRenderer } from '../../src/engine/rendering/renderer'

function chunk(type: string, data: Uint8Array): Uint8Array {
  const result = new Uint8Array(data.length + 12)
  new DataView(result.buffer).setUint32(0, data.length)
  result.set([...type].map(c => c.charCodeAt(0)), 4)
  result.set(data, 8)
  new DataView(result.buffer).setUint32(result.length - 4, pngChunkCrc(result.subarray(4, result.length - 4)))
  return result
}
function png(width = 2, height = 3, extra: Uint8Array[] = []): Uint8Array<ArrayBuffer> {
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr.set([8, 6, 0, 0, 0], 8)
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...extra, chunk('IDAT', new Uint8Array([0])), chunk('IEND', new Uint8Array())]
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.length }
  return result
}
function jpeg(width = 2, height = 3): Uint8Array<ArrayBuffer> {
  return new Uint8Array([255, 216, 255, 224, 0, 4, 0, 0, 255, 194, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 17, 0, 255, 218, 0, 8, 1, 1, 0, 0, 63, 0, 12, 255, 217])
}

afterEach(() => vi.unstubAllGlobals())

describe('CPU color reference', () => {
  it.each([0, .003, .04045, .18, .5, 1])('round trips sRGB %s', value => {
    expect(linearToSrgb(srgbToLinear(value))).toBeCloseTo(value, 6)
  })
  it('has the specified transfer-function branches', () => {
    expect(srgbToLinear(.02)).toBeCloseTo(.02 / 12.92, 12)
    expect(srgbToLinear(.5)).toBeCloseTo(((.5 + .055) / 1.055) ** 2.4, 12)
    expect(linearToSrgb(.002)).toBeCloseTo(.002 * 12.92, 12)
    expect(linearToSrgb(.5)).toBeCloseTo(1.055 * .5 ** (1 / 2.4) - .055, 12)
  })
  it('leaves neutral color and alpha unchanged without mutating inputs', () => {
    const rgb: RGB = [.1, .5, .9]
    const document = createDocument()
    const original = structuredClone(document)
    const result = processPixel(rgb, .37, document)
    rgb.forEach((value, i) => expect(result[i]).toBeCloseTo(value, 10))
    expect(result[3]).toBe(.37)
    expect(document).toEqual(original)
    expect(rgb).toEqual([.1, .5, .9])
  })
  it('applies exposure in linear light', () => {
    expect(applyAdjustments([.1, .2, .3], { ...NEUTRAL, exposure: 1 })).toEqual(expect.arrayContaining([expect.closeTo(.2), expect.closeTo(.4), expect.closeTo(.6)]))
  })
  it('uses a .18 contrast pivot', () => {
    applyAdjustments([.18, .18, .18], { ...NEUTRAL, contrast: 100 }).forEach(c => expect(c).toBeCloseTo(.18, 12))
  })
  it('uses relative temperature/tint gains', () => {
    const result = applyAdjustments([1, 1, 1], { ...NEUTRAL, temperature: 100, tint: 100 })
    expect(result[0]).toBeCloseTo(2 ** .375, 12)
    expect(result[1]).toBeCloseTo(2 ** -.25, 12)
    expect(result[2]).toBeCloseTo(2 ** -.125, 12)
  })
  it('desaturates with Rec.709 luminance', () => {
    applyAdjustments([1, 0, 0], { ...NEUTRAL, saturation: -100 }).forEach(c => expect(c).toBeCloseTo(.2126, 12))
  })
  it('does not clamp intermediate linear values', () => {
    expect(applyAdjustments([0, 0, 0], { ...NEUTRAL, contrast: 100 })[0]).toBeLessThan(0)
    expect(applyAdjustments([1, 1, 1], { ...NEUTRAL, exposure: 2 })[0]).toBeCloseTo(4, 12)
  })
  it.each(PRESETS.map(p => p.id))('makes intensity zero neutral for %s', id => {
    const document = { ...createDocument(), presetId: id, presetIntensity: 0 }
    const pixel = processPixel([.2, .4, .6], .8, document)
    ;[.2, .4, .6, .8].forEach((c, i) => expect(pixel[i]).toBeCloseTo(c, 10))
  })
  it('applies full preset before manual adjustments, not after', () => {
    const rgb: RGB = [.3, .5, .7]
    const document = { ...createDocument(), presetId: 'amber-hour' as const, adjustments: { ...NEUTRAL, contrast: 40 } }
    const expected = applyAdjustments(applyAdjustments(rgb.map(srgbToLinear) as RGB, getPreset('amber-hour')!.adjustments), document.adjustments).map(linearToSrgb)
    processPixel(rgb, 1, document).slice(0, 3).forEach((c, i) => expect(c).toBeCloseTo(expected[i]!, 12))
  })
  it('blends intensity in linear RGB', () => {
    const rgb: RGB = [.2, .4, .6]
    const neutral = rgb.map(srgbToLinear) as RGB
    const preset = applyAdjustments(neutral, getPreset('midnight-blue')!.adjustments)
    const expected = neutral.map((c, i) => linearToSrgb((c + preset[i]!) / 2))
    const result = processPixel(rgb, 1, { ...createDocument(), presetId: 'midnight-blue', presetIntensity: 50 })
    expected.forEach((c, i) => expect(result[i]).toBeCloseTo(c, 12))
  })
  it('flattens JPEG onto white in linear light', () => {
    const result = processPixel([0, 0, 0], .5, createDocument(), true)
    expect(result[0]).toBeCloseTo(linearToSrgb(.5), 12)
    expect(result[3]).toBe(1)
    expect(processPixel([.8, .2, .5], 0, createDocument(), true)).toEqual([expect.closeTo(1), expect.closeTo(1), expect.closeTo(1), 1])
  })
  it('clamps output and sanitizes nonfinite adjustment values', () => {
    expect(linearToSrgb(-2)).toBe(0)
    expect(linearToSrgb(2)).toBeCloseTo(1, 12)
    const a = processPixel([.2, .4, .6], 1, { ...createDocument(), adjustments: { ...NEUTRAL, exposure: NaN, saturation: Infinity } })
    const b = processPixel([.2, .4, .6], 1, createDocument())
    expect(a).toEqual(b)
  })
  it('rejects unknown pipeline and preset versions', () => {
    expect(() => processPixel([0, 0, 0], 1, { ...createDocument(), pipelineVersion: 2 } as never)).toThrow(/pipeline/)
    expect(() => processPixel([0, 0, 0], 1, { ...createDocument(), presetId: 'missing' } as never)).toThrow(/preset/)
    const preset = getPreset('amber-hour')!
    const original = preset.version
    try {
      Object.assign(preset, { version: 2 })
      expect(() => processPixel([0, 0, 0], 1, { ...createDocument(), presetId: 'amber-hour' })).toThrow(/preset/)
    } finally { preset.version = original }
  })
})

describe('image preflight and limits', () => {
  it('reads PNG header dimensions', () => {
    expect(parsePng(png(24, 17))).toEqual({ width: 24, height: 17, format: 'image/png' })
  })
  it('reads progressive JPEG dimensions through ancillary segments', () => {
    expect(parseJpeg(jpeg(400, 300))).toEqual({ width: 400, height: 300, format: 'image/jpeg' })
  })
  it('sniffs bytes rather than file names or MIME labels', () => {
    expect(parseImageHeader(png()).format).toBe('image/png')
    expect(parseImageHeader(jpeg()).format).toBe('image/jpeg')
    expect(() => parseImageHeader(new Uint8Array([71, 73, 70, 56]))).toThrow(/JPEG and PNG/)
  })
  it.each(['acTL', 'fcTL', 'fdAT'])('rejects APNG %s chunks anywhere in the stream', type => {
    expect(() => parsePng(png(2, 3, [chunk(type, new Uint8Array(8))]))).toThrow(/Animated PNG/)
  })
  it('rejects truncated chunks, bad headers and missing PNG endings', () => {
    expect(() => parsePng(png().slice(0, -1))).toThrow(/Incomplete|Truncated/)
    const bad = png()
    bad[24] = 7
    new DataView(bad.buffer).setUint32(29, pngChunkCrc(bad.subarray(12, 29)))
    expect(() => parsePng(bad)).toThrow(/header/)
    const length = png()
    new DataView(length.buffer).setUint32(8, 0xffffffff)
    expect(() => parsePng(length)).toThrow(/Truncated/)
  })
  it('rejects corrupt PNG CRCs, including ancillary chunks', () => {
    const badHeader = png()
    badHeader[29]! ^= 1
    expect(() => parsePng(badHeader)).toThrow(/checksum/)
    const ancillary = chunk('tEXt', new Uint8Array([65, 0, 66]))
    ancillary[8]! ^= 1
    expect(() => parsePng(png(2, 3, [ancillary]))).toThrow(/checksum/)
    expect(pngChunkCrc(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
  it('rejects JPEG truncation, trailing concatenation and MPO metadata', () => {
    expect(() => parseJpeg(jpeg().slice(0, -2))).toThrow(/end marker/)
    const concatenated = new Uint8Array([...jpeg(), ...jpeg()])
    expect(() => parseJpeg(concatenated)).toThrow(/multi-picture/)
    const mpo = new Uint8Array([...jpeg().subarray(0, 2), 255, 226, 0, 6, 77, 80, 70, 0, ...jpeg().subarray(2)])
    expect(() => parseJpeg(mpo)).toThrow(/Multi-picture/)
  })
  it('accepts stuffed entropy bytes, restart markers and multiple progressive scans', () => {
    const encoded = jpeg()
    const extended = new Uint8Array([...encoded.subarray(0, -2), 255, 0, 42, 255, 208, 14, 255, 218, 0, 8, 1, 1, 0, 1, 63, 0, 12, 255, 217])
    expect(parseJpeg(extended)).toEqual({ width: 2, height: 3, format: 'image/jpeg' })
  })
  it('rejects malformed JPEG marker segments', () => {
    expect(() => parseJpeg(new Uint8Array([255, 216, 0]))).toThrow(/marker/)
    expect(() => parseJpeg(new Uint8Array([255, 216, 255, 224, 0, 1]))).toThrow(/Truncated/)
    expect(() => parseJpeg(new Uint8Array([255, 216, 255, 217]))).toThrow(/Incomplete/)
  })
  it('accepts boundary dimensions and rejects unsafe dimensions/pixels', () => {
    expect(() => validateDimensions(4000, 4000)).not.toThrow()
    expect(() => validateDimensions(8192, 1)).not.toThrow()
    for (const [width, height] of [[0, 1], [-1, 1], [1.5, 1], [NaN, 1], [8193, 1], [4001, 4000]]) {
      expect(() => validateDimensions(width!, height!)).toThrow()
    }
  })
  it('honors detected hardware and conservative memory limits', () => {
    expect(() => validateDimensions(2049, 10, { maxTextureSize: 2048 })).toThrow(/dimensions/)
    expect(() => validateDimensions(100, 2049, { maxRenderbufferSize: 2048 })).toThrow(/dimensions/)
    expect(() => validateDimensions(4000, 4000, {}, 24)).toThrow(/memory/)
    expect(() => validateDimensions(100, 100, { maxMemoryBytes: 120_000 }, 12, 1)).toThrow(/memory/)
    expect(() => resolveLimits({ maxPixels: Infinity })).toThrow(/limits/)
  })
  it('never increases application ceilings via overrides', () => {
    expect(resolveLimits({ maxPixels: 100_000_000 }).maxPixels).toBe(DEFAULT_LIMITS.maxPixels)
  })
  it('requires WebGL2, with a clear error rather than an unedited fallback', () => {
    expect(() => new ImageRenderer({ getContext: () => null } as unknown as HTMLCanvasElement)).toThrow(/WebGL2/)
  })
})

describe('browser image loading', () => {
  it('retains the original File and applies decode normalization exactly once', async () => {
    const close = vi.fn()
    const decode = vi.fn().mockResolvedValue({ width: 3, height: 2, close })
    vi.stubGlobal('createImageBitmap', decode)
    const file = new File([jpeg()], 'orientation.jpg', { type: 'image/jpeg' })
    const loaded = await loadImage(file)
    expect(loaded.file).toBe(file)
    expect([loaded.width, loaded.height]).toEqual([3, 2])
    expect(decode).toHaveBeenCalledExactlyOnceWith(file, { imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'default' })
    loaded.dispose()
    loaded.dispose()
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('rejects an oversized file or oversized header before decode', async () => {
    const decode = vi.fn()
    vi.stubGlobal('createImageBitmap', decode)
    await expect(loadImage(new File([png()], 'large.png'), { maxFileBytes: 1 })).rejects.toThrow(/20 MiB/)
    await expect(loadImage(new File([png(8193, 1)], 'large.png'))).rejects.toThrow(/dimensions/)
    expect(decode).not.toHaveBeenCalled()
  })
  it('reports corrupt browser decoding and missing decoding support', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode failed')))
    await expect(loadImage(new File([png()], 'bad.png'))).rejects.toThrow(/corrupt/)
    vi.stubGlobal('createImageBitmap', undefined)
    await expect(loadImage(new File([png()], 'bad.png'))).rejects.toThrow(/decoding/)
  })
  it('closes rejected decoded bitmaps, including mismatched and oversized dimensions', async () => {
    for (const [width, height] of [[8193, 1], [4, 4], [3, 2]]) {
      const close = vi.fn()
      vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width, height, close }))
      await expect(loadImage(new File([png()], 'bad.png'))).rejects.toThrow()
      expect(close).toHaveBeenCalledTimes(1)
    }
  })
})

function rendererHarness() {
  const constants = new Map<string, number>()
  const methods: Record<string, ReturnType<typeof vi.fn>> = {}
  const gl = new Proxy({}, {
    get(_target, key: string) {
      if (/^[A-Z0-9_]+$/.test(key)) {
        if (!constants.has(key)) constants.set(key, constants.size + 1)
        return constants.get(key)
      }
      return methods[key] ??= vi.fn()
    },
  }) as WebGL2RenderingContext
  let nextHandle = 0
  for (const name of ['createShader', 'createProgram', 'createVertexArray', 'createTexture', 'createFramebuffer']) {
    methods[name] = vi.fn(() => ({ id: ++nextHandle }))
  }
  methods.drawArrays = vi.fn()
  methods.getParameter = vi.fn(parameter => parameter === gl.MAX_VIEWPORT_DIMS ? new Int32Array([8192, 8192]) : 8192)
  methods.getShaderPrecisionFormat = vi.fn(() => ({ precision: 23 }))
  methods.getShaderParameter = vi.fn(() => true)
  methods.getProgramParameter = vi.fn(() => true)
  methods.getError = vi.fn(() => gl.NO_ERROR)
  methods.isContextLost = vi.fn(() => false)
  methods.checkFramebufferStatus = vi.fn(() => gl.FRAMEBUFFER_COMPLETE)
  methods.getUniformLocation = vi.fn((_program, name) => name)
  const listeners = new Map<string, EventListener>()
  const canvas = {
    width: 1, height: 1,
    getContext: vi.fn(() => gl),
    addEventListener: vi.fn((type: string, callback: EventListener) => listeners.set(type, callback)),
    removeEventListener: vi.fn((type: string) => listeners.delete(type)),
  } as unknown as HTMLCanvasElement
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)))
  const flush = () => {
    const queued = [...frames.values()]
    frames.clear()
    queued.forEach(callback => callback(0))
  }
  const image = (width = 2, height = 3) => ({
    width, height, format: 'image/png' as const,
    bitmap: { width, height, close: vi.fn() } as unknown as ImageBitmap,
    file: new File([new Uint8Array([0])], 'source.png'),
    dispose: vi.fn(),
  })
  const status = vi.fn()
  const renderer = new ImageRenderer(canvas, status)
  return { renderer, gl, methods, listeners, canvas, frames, flush, image, status }
}

function encodingHarness(deferred = false) {
  const h = rendererHarness()
  const encoded: { width: number; height: number; type: string; quality: number | undefined }[] = []
  const callbacks: BlobCallback[] = []
  const putImageData = vi.fn()
  vi.stubGlobal('ImageData', class {
    data: Uint8ClampedArray
    width: number
    height: number
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data
      this.width = width
      this.height = height
    }
  })
  vi.stubGlobal('document', {
    createElement: () => {
      const canvas = {
        width: 0, height: 0,
        getContext: () => ({ putImageData }),
        toBlob(callback: BlobCallback, type: string, quality?: number) {
          encoded.push({ width: canvas.width, height: canvas.height, type, quality })
          if (deferred) callbacks.push(callback)
          else callback(new Blob([new Uint8Array([1])], { type }))
        },
        toDataURL(type: string) {
          encoded.push({ width: canvas.width, height: canvas.height, type, quality: undefined })
          return 'data:image/png;base64,AQ=='
        },
      }
      return canvas
    },
  })
  h.methods.readPixels = vi.fn((_x, _y, width: number, height: number, _format, _type, pixels: Uint8ClampedArray) => {
    for (let y = 0; y < height; y++) pixels.fill(y + 1, y * width * 4, (y + 1) * width * 4)
  })
  return { ...h, encoded, putImageData, callbacks }
}

describe('renderer lifecycle and allocation', () => {
  it('coalesces edits and sizes, uploads only source changes, and remembers comparison on resize', () => {
    const h = rendererHarness()
    const source = h.image()
    h.renderer.setSource(source)
    h.renderer.setSource(source)
    h.renderer.setDocument(createDocument())
    h.renderer.setPreviewSize(20, 30)
    h.renderer.render(true)
    expect(h.frames.size).toBe(1)
    expect(h.methods.texImage2D).toHaveBeenCalledTimes(1)
    h.flush()
    expect(h.methods.drawArrays).toHaveBeenCalledTimes(1)
    expect([h.canvas.width, h.canvas.height]).toEqual([20, 30])
    expect(h.methods.uniform1i).toHaveBeenCalledWith('before', 1)
    h.renderer.setPreviewSize(10, 15)
    h.flush()
    expect(h.methods.uniform1i).toHaveBeenLastCalledWith('flattenWhite', 0)
    expect(h.methods.uniform1i!.mock.calls.filter(call => call[0] === 'before').at(-1)).toEqual(['before', 1])
    h.renderer.dispose()
  })
  it('preserves the previous image on incomplete replacement texture allocation', () => {
    const h = rendererHarness()
    const original = h.image()
    h.renderer.setSource(original)
    h.flush()
    const originalTexture = h.methods.createTexture!.mock.results[0]!.value
    h.methods.checkFramebufferStatus!.mockReturnValueOnce(0)
    expect(() => h.renderer.setSource(h.image())).toThrow(/incomplete/)
    expect(h.methods.deleteTexture).not.toHaveBeenCalledWith(originalTexture)
    h.renderer.render()
    h.flush()
    expect(h.methods.bindTexture).toHaveBeenLastCalledWith(h.gl.TEXTURE_2D, originalTexture)
    expect(original.dispose).not.toHaveBeenCalled()
    h.renderer.dispose()
    expect(original.dispose).toHaveBeenCalledOnce()
  })
  it('preserves the source on an upload GL error and releases the failed texture', () => {
    const h = rendererHarness()
    h.renderer.setSource(h.image())
    h.flush()
    h.methods.getError!.mockReturnValueOnce(123)
    expect(() => h.renderer.setSource(h.image())).toThrow(/Source upload failed/)
    const failedTexture = h.methods.createTexture!.mock.results[1]!.value
    expect(h.methods.deleteTexture).toHaveBeenCalledWith(failedTexture)
    h.renderer.render()
    h.flush()
    expect(h.methods.drawArrays).toHaveBeenCalledTimes(2)
    h.renderer.dispose()
  })
  it('suspends during context loss, refuses export and reconstructs retained settings/source', async () => {
    const h = rendererHarness()
    h.renderer.setSource(h.image())
    h.renderer.setDocument({ ...createDocument(), adjustments: { ...NEUTRAL, exposure: 1 } })
    h.renderer.render(true)
    const preventDefault = vi.fn()
    h.listeners.get('webglcontextlost')!({ preventDefault } as unknown as Event)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(h.frames.size).toBe(0)
    expect(h.status).toHaveBeenLastCalledWith(expect.stringMatching(/lost/), true)
    await expect(h.renderer.export('image/png')).rejects.toThrow(/context/)
    h.renderer.setPreviewSize(40, 60)
    h.listeners.get('webglcontextrestored')!(new Event('webglcontextrestored'))
    expect(h.methods.texImage2D).toHaveBeenCalledTimes(2)
    h.flush()
    expect(h.methods.uniform4f).toHaveBeenCalledWith('manualA', 1, 0, 0, 0)
    expect(h.methods.uniform1i).toHaveBeenCalledWith('before', 1)
    expect(h.status).toHaveBeenLastCalledWith(expect.stringMatching(/restored/), false)
    h.renderer.dispose()
  })
  it('checks source/preview/atomic replacement memory before graphics allocations', () => {
    const h = rendererHarness()
    h.renderer.setSource(h.image(4000, 4000))
    const replacement = h.image(4000, 4000)
    replacement.file = { size: 20 * 1024 * 1024 } as File
    expect(() => h.renderer.setSource(replacement)).toThrow(/memory/)
    expect(() => h.renderer.setPreviewSize(4000, 4000)).not.toThrow()
    expect(() => h.renderer.setPreviewSize(8192, 2000)).toThrow(/memory|megapixel/)
    expect(h.methods.texImage2D).toHaveBeenCalledTimes(1)
    h.renderer.dispose()
  })
  it('rejects unsafe full-size exports before creating a target even with a small preview', async () => {
    const h = rendererHarness()
    h.renderer.setSource(h.image(4000, 4000))
    h.renderer.setPreviewSize(40, 40)
    await expect(h.renderer.export('image/png')).rejects.toThrow(/memory/)
    expect(h.methods.texImage2D).toHaveBeenCalledTimes(1)
    h.renderer.dispose()
  })
  it('disposes resources and cancels pending work idempotently', () => {
    const h = rendererHarness()
    const source = h.image()
    h.renderer.setSource(source)
    h.renderer.dispose()
    h.renderer.dispose()
    h.flush()
    expect(source.dispose).toHaveBeenCalledOnce()
    expect(h.methods.deleteTexture).toHaveBeenCalledOnce()
    expect(h.methods.deleteProgram).toHaveBeenCalledOnce()
    expect(h.methods.deleteVertexArray).toHaveBeenCalledOnce()
    expect(h.methods.deleteShader).toHaveBeenCalledTimes(2)
    expect(h.methods.drawArrays).not.toHaveBeenCalled()
    expect(h.listeners.size).toBe(0)
    expect(() => h.renderer.setSource(h.image())).toThrow(/disposed/)
  })
  it('exports full normalized dimensions, flips readback, and ignores comparison state', async () => {
    const h = encodingHarness()
    h.renderer.setSource(h.image(4, 3))
    h.renderer.setPreviewSize(2, 1)
    h.renderer.render(true)
    h.flush()
    const blob = await h.renderer.export('image/png')
    expect(blob.type).toBe('image/png')
    expect(h.encoded).toEqual([{ width: 4, height: 3, type: 'image/png', quality: .92 }])
    const imageData = h.putImageData.mock.calls[0]![0] as ImageData
    expect([...imageData.data.slice(0, 16)]).toEqual(Array(16).fill(3))
    expect([...imageData.data.slice(32, 48)]).toEqual(Array(16).fill(1))
    expect(h.methods.uniform1i!.mock.calls.filter(call => call[0] === 'before').at(-1)).toEqual(['before', 0])
    expect(h.methods.texImage2D).toHaveBeenCalledTimes(2)
    h.renderer.render()
    h.flush()
    expect(h.methods.uniform1i!.mock.calls.filter(call => call[0] === 'before').at(-1)).toEqual(['before', 1])
    h.renderer.dispose()
  })
  it('uses white flattening only for JPEG and passes quality to the encoder', async () => {
    const h = encodingHarness()
    h.renderer.setSource(h.image())
    const blob = await h.renderer.export('image/jpeg', .8)
    expect(blob.type).toBe('image/jpeg')
    expect(h.encoded[0]?.quality).toBe(.8)
    expect(h.methods.uniform1i!.mock.calls.filter(call => call[0] === 'flattenWhite').at(-1)).toEqual(['flattenWhite', 1])
    await expect(h.renderer.export('image/jpeg', NaN)).rejects.toThrow(/quality/)
    h.renderer.dispose()
  })
  it('renders thumbnail settings in a separate target without mutating current settings', async () => {
    const h = encodingHarness()
    h.renderer.setSource(h.image())
    h.renderer.setDocument({ ...createDocument(), adjustments: { ...NEUTRAL, exposure: 1 } })
    const thumbnail = await h.renderer.thumbnail({ ...createDocument(), adjustments: { ...NEUTRAL, exposure: -1 } }, 40)
    expect(thumbnail).toBe('data:image/png;base64,AQ==')
    expect(h.encoded[0]).toMatchObject({ width: 27, height: 40 })
    expect(h.methods.uniform4f).toHaveBeenCalledWith('manualA', -1, 0, 0, 0)
    h.flush()
    expect(h.methods.uniform4f!.mock.calls.filter(call => call[0] === 'manualA').at(-1)).toEqual(['manualA', 1, 0, 0, 0])
    h.renderer.dispose()
  })
  it('keeps extreme-aspect-ratio thumbnails bounded on both dimensions', async () => {
    const h = encodingHarness()
    h.renderer.setSource(h.image(1, 8192))
    await h.renderer.thumbnail(createDocument())
    expect(h.encoded[0]).toMatchObject({ width: 1, height: 160 })
    h.renderer.dispose()
  })
  it('deletes separate target resources even if readback fails', async () => {
    const h = encodingHarness()
    h.renderer.setSource(h.image())
    h.methods.readPixels!.mockImplementationOnce(() => { throw new Error('readback failed') })
    await expect(h.renderer.export('image/png')).rejects.toThrow(/readback/)
    expect(h.methods.deleteFramebuffer).toHaveBeenCalledTimes(2)
    expect(h.methods.deleteTexture).toHaveBeenCalledOnce()
    h.renderer.render()
    h.flush()
    expect(h.methods.drawArrays).toHaveBeenCalledTimes(2)
    h.renderer.dispose()
  })
  it('rejects concurrent export and thumbnail allocation while the encoder retains its output', async () => {
    const h = encodingHarness(true)
    h.renderer.setSource(h.image())
    const pending = h.renderer.export('image/png')
    await expect(h.renderer.export('image/png')).rejects.toThrow(/already being encoded/)
    await expect(h.renderer.thumbnail(createDocument())).rejects.toThrow(/already being encoded/)
    expect(h.methods.texImage2D).toHaveBeenCalledTimes(2)
    h.callbacks[0]!(new Blob([new Uint8Array([1])], { type: 'image/png' }))
    await expect(pending).resolves.toBeInstanceOf(Blob)
    h.renderer.dispose()
  })
  it('rejects an in-flight export after disposal without touching released graphics', async () => {
    const h = encodingHarness(true)
    h.renderer.setSource(h.image())
    const pending = h.renderer.export('image/png')
    h.renderer.dispose()
    const calls = h.methods.drawArrays!.mock.calls.length
    h.callbacks[0]!(new Blob([new Uint8Array([1])], { type: 'image/png' }))
    await expect(pending).rejects.toThrow(/disposed/)
    expect(h.methods.drawArrays).toHaveBeenCalledTimes(calls)
  })
  it('releases the encoding guard after a null browser encoding result', async () => {
    const h = encodingHarness(true)
    h.renderer.setSource(h.image())
    const first = h.renderer.export('image/png')
    h.callbacks[0]!(null)
    await expect(first).rejects.toThrow(/encoding failed/)
    const second = h.renderer.export('image/png')
    h.callbacks[1]!(new Blob([new Uint8Array([1])], { type: 'image/png' }))
    await expect(second).resolves.toBeInstanceOf(Blob)
    h.renderer.dispose()
  })
})
