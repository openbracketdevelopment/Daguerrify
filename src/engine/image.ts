export type ImageFormat = 'image/jpeg' | 'image/png'
export interface LoadedImage {
  file: File
  bitmap: ImageBitmap
  width: number
  height: number
  format: ImageFormat
  dispose(): void
}
export interface ImageLimits {
  maxFileBytes: number
  maxPixels: number
  maxDimension: number
  maxMemoryBytes: number
  maxTextureSize: number
  maxRenderbufferSize: number
}
export const DEFAULT_LIMITS: Readonly<ImageLimits> = Object.freeze({
  maxFileBytes: 20 * 1024 * 1024,
  maxPixels: 16_000_000,
  maxDimension: 8192,
  maxMemoryBytes: 256 * 1024 * 1024,
  maxTextureSize: 8192,
  maxRenderbufferSize: 8192,
})
export function resolveLimits(overrides: Partial<ImageLimits> = {}): ImageLimits {
  const result = { ...DEFAULT_LIMITS }
  for (const key of Object.keys(result) as (keyof ImageLimits)[]) {
    const value = overrides[key]
    if (value !== undefined) {
      if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid image limits.')
      result[key] = Math.min(result[key], Math.floor(value))
    }
  }
  return result
}
export function validateDimensions(width: number, height: number, overrides: Partial<ImageLimits> = {}, bytesPerPixel = 12, extraBytes = 0): void {
  const limits = resolveLimits(overrides)
  const cap = Math.min(limits.maxDimension, limits.maxTextureSize, limits.maxRenderbufferSize)
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Invalid image dimensions.')
  }
  if (width > cap || height > cap) throw new Error(`Image dimensions exceed the ${cap}px limit.`)
  if (width * height > limits.maxPixels) throw new Error('Image exceeds the 16 megapixel limit.')
  if (width * height * bytesPerPixel + extraBytes > limits.maxMemoryBytes) {
    throw new Error('Image exceeds the conservative memory limit.')
  }
}
export interface ImageHeader { width: number; height: number; format: ImageFormat }
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10]
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  return crc >>> 0
})
export function pngChunkCrc(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]!
  return (crc ^ 0xffffffff) >>> 0
}
export function parsePng(bytes: Uint8Array): ImageHeader {
  if (!pngSignature.every((value, i) => bytes[i] === value)) throw new Error('Invalid PNG signature.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 8
  let header: ImageHeader | undefined
  let data = false
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset)
    const end = offset + length + 12
    if (end > bytes.length) throw new Error('Truncated PNG chunk.')
    if (pngChunkCrc(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) {
      throw new Error('Corrupt PNG chunk checksum.')
    }
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    if (!header && type !== 'IHDR') throw new Error('Missing PNG header.')
    if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') throw new Error('Animated PNG is not supported.')
    if (type === 'IHDR') {
      if (header || length !== 13) throw new Error('Invalid PNG header.')
      const depth = bytes[offset + 16]!
      const color = bytes[offset + 17]!
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
      if (!depths[color]?.includes(depth) || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20]! > 1) {
        throw new Error('Unsupported PNG header.')
      }
      header = { width: view.getUint32(offset + 8), height: view.getUint32(offset + 12), format: 'image/png' }
    }
    if (type === 'IDAT') data = true
    if (type === 'IEND') {
      if (length !== 0 || !data || end !== bytes.length) throw new Error('Invalid PNG ending.')
      return header!
    }
    offset = end
  }
  throw new Error('Incomplete PNG.')
}
export function parseJpeg(bytes: Uint8Array): ImageHeader {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Invalid JPEG signature.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 2
  let header: ImageHeader | undefined
  let scanning = false
  let sawScan = false
  while (offset < bytes.length) {
    if (scanning) {
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) { offset++; continue }
        const start = offset++
        while (bytes[offset] === 0xff) offset++
        const marker = bytes[offset]
        if (marker === 0 || (marker !== undefined && marker >= 0xd0 && marker <= 0xd7)) {
          offset++
          continue
        }
        offset = start
        scanning = false
        break
      }
      if (scanning) break
    }
    if (bytes[offset++] !== 0xff) throw new Error('Invalid JPEG marker.')
    while (bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === undefined) break
    if (marker === 0xd9) {
      if (!header || !sawScan) throw new Error('Incomplete JPEG image.')
      if (offset !== bytes.length) throw new Error('Trailing or multi-picture JPEG data is not supported.')
      return header
    }
    if (marker === 0xd8 || marker === 0 || (marker >= 0xd0 && marker <= 0xd7)) {
      throw new Error('Invalid JPEG marker.')
    }
    if (marker === 0x01) continue
    if (offset + 2 > bytes.length) break
    const length = view.getUint16(offset)
    if (length < 2 || offset + length > bytes.length) throw new Error('Truncated JPEG header.')
    if (marker === 0xe2 && length >= 6 && bytes[offset + 2] === 77 && bytes[offset + 3] === 80 &&
      bytes[offset + 4] === 70 && bytes[offset + 5] === 0) throw new Error('Multi-picture JPEG is not supported.')
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (header || length < 8 || !bytes[offset + 7] || length !== 8 + 3 * bytes[offset + 7]!) throw new Error('Invalid JPEG frame.')
      header = { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3), format: 'image/jpeg' }
    }
    if (marker === 0xda) {
      if (!header || length < 6 || !bytes[offset + 2] || length !== 6 + 2 * bytes[offset + 2]!) throw new Error('Invalid JPEG scan.')
      scanning = true
      sawScan = true
    }
    offset += length
  }
  throw new Error(header ? 'Incomplete JPEG: missing end marker.' : 'Missing JPEG dimensions.')
}
export function parseImageHeader(bytes: Uint8Array): ImageHeader {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return parseJpeg(bytes)
  if (pngSignature.every((value, i) => bytes[i] === value)) return parsePng(bytes)
  throw new Error('Only static JPEG and PNG images are supported.')
}
export async function loadImage(file: File, overrides: Partial<ImageLimits> = {}): Promise<LoadedImage> {
  const limits = resolveLimits(overrides)
  if (!file.size || file.size > limits.maxFileBytes) throw new Error('Choose an image no larger than 20 MiB.')
  const header = parseImageHeader(new Uint8Array(await file.arrayBuffer()))
  validateDimensions(header.width, header.height, limits, 12, file.size)
  if (typeof createImageBitmap !== 'function') throw new Error('This browser does not support image decoding.')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, {
      imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'default',
    })
  } catch {
    throw new Error('The image is corrupt or could not be decoded.')
  }
  try {
    validateDimensions(bitmap.width, bitmap.height, limits, 12, file.size)
    if (!((bitmap.width === header.width && bitmap.height === header.height) ||
      (header.format === 'image/jpeg' && bitmap.width === header.height && bitmap.height === header.width))) {
      throw new Error('Decoded image dimensions do not match its header.')
    }
  } catch (error) {
    bitmap.close()
    throw error
  }
  let disposed = false
  return {
    file, bitmap, width: bitmap.width, height: bitmap.height, format: header.format,
    dispose() { if (!disposed) { disposed = true; bitmap.close() } },
  }
}
