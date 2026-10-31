/// <reference lib="dom" />
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'

export const fixturePath = (name: string): string => resolve('testdata', name)

/** All artwork is original procedural illustration, generated with browser APIs. */
export async function generateFixtures(page: Page): Promise<void> {
  const encoded = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    const encode = async (type: string) => {
      const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), type, .96))
      return Array.from(new Uint8Array(await blob.arrayBuffer()))
    }
    const files: Record<string, number[]> = {}
    canvas.width = 256
    canvas.height = 96
    for (let x = 0; x < 256; x++) {
      ctx.fillStyle = `rgb(${x},${x},${x})`
      ctx.fillRect(x, 0, 1, 48)
    }
    const colors = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#808080', '#d28c50', '#428aaa']
    colors.forEach((color, index) => {
      ctx.fillStyle = color
      ctx.fillRect(index * 32, 48, 32, 48)
    })
    files['chart-ramp.png'] = await encode('image/png')
    canvas.width = 96
    canvas.height = 64
    ctx.clearRect(0, 0, 96, 64)
    ctx.fillStyle = 'rgba(200,60,100,.5)'
    ctx.fillRect(16, 16, 64, 32)
    ctx.fillStyle = '#2864c8'
    ctx.fillRect(32, 24, 32, 16)
    files['transparent-edges.png'] = await encode('image/png')
    canvas.width = 160
    canvas.height = 96
    const sky = ctx.createLinearGradient(0, 0, 0, 96)
    sky.addColorStop(0, '#639bc4')
    sky.addColorStop(.55, '#e8c99b')
    sky.addColorStop(1, '#486b4b')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, 160, 96)
    ctx.fillStyle = '#f4db9d'
    ctx.beginPath()
    ctx.arc(117, 25, 10, 0, Math.PI * 2)
    ctx.fill()
    for (let layer = 0; layer < 3; layer++) {
      ctx.fillStyle = ['#728285', '#4b686b', '#304d43'][layer]!
      ctx.beginPath()
      ctx.moveTo(0, 96)
      for (let x = 0; x <= 160; x++) {
        ctx.lineTo(x, 53 + layer * 12 + Math.sin(x / (18 + layer * 8) + layer) * 9)
      }
      ctx.lineTo(160, 96)
      ctx.fill()
    }
    // Deterministic fine texture gives this small illustration photographic-like detail.
    for (let y = 0; y < 96; y++) for (let x = 0; x < 160; x++) {
      const noise = ((x * 37 + y * 61 + x * y * 7) % 17) - 8
      ctx.fillStyle = noise > 0 ? `rgba(255,255,255,${noise / 180})` : `rgba(0,0,0,${-noise / 180})`
      ctx.fillRect(x, y, 1, 1)
    }
    files['illustrative-landscape.png'] = await encode('image/png')
    files['illustrative-landscape.jpg'] = await encode('image/jpeg')
    canvas.width = 80
    canvas.height = 48
    ctx.fillStyle = '#f02020'
    ctx.fillRect(0, 0, 40, 24)
    ctx.fillStyle = '#20d030'
    ctx.fillRect(40, 0, 40, 24)
    ctx.fillStyle = '#2040e0'
    ctx.fillRect(0, 24, 40, 24)
    ctx.fillStyle = '#f0d020'
    ctx.fillRect(40, 24, 40, 24)
    const jpeg = await encode('image/jpeg')
    // APP1 Exif: little-endian TIFF, IFD0 at offset 8, SHORT Orientation=6.
    const exif = [
      0xff, 0xe1, 0, 34, 69, 120, 105, 102, 0, 0,
      73, 73, 42, 0, 8, 0, 0, 0, 1, 0,
      0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
    ]
    files['orientation-6.jpg'] = [...jpeg.slice(0, 2), ...exif, ...jpeg.slice(2)]
    const png = files['chart-ramp.png']!
    const chunk = [0, 0, 0, 8, 97, 99, 84, 76, 0, 0, 0, 1, 0, 0, 0, 0]
    let crc = 0xffffffff
    for (const byte of chunk.slice(4)) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
    crc = (crc ^ 0xffffffff) >>> 0
    chunk.push(crc >>> 24, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255)
    files['animated.png'] = [...png.slice(0, 33), ...chunk, ...png.slice(33)]
    files['corrupt.png'] = png.slice(0, 43)
    return files
  })
  await mkdir('testdata', { recursive: true })
  await Promise.all(Object.entries(encoded).map(([name, bytes]) => writeFile(fixturePath(name), new Uint8Array(bytes))))
  await writeFile(fixturePath('unsupported.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>\n')
}
