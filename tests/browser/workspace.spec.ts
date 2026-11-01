/// <reference lib="dom" />
import { expect, test, type Locator, type Page } from '@playwright/test'
import { fixturePath } from './fixtures.ts'

const imageInput = (page: Page) => page.getByLabel('Open a JPEG or PNG photograph')
const slider = (page: Page, name: string) => page.getByRole('slider', { name, exact: true })
const preview = (page: Page) => page.locator('canvas[aria-label$="photograph"]')
const status = (page: Page) => page.locator('[role="status"]')

async function openImage(page: Page, filename = 'illustrative-landscape.png'): Promise<void> {
  await imageInput(page).setInputFiles(fixturePath(filename))
  await expect(status(page)).toContainText('Photograph ready')
  await expect(slider(page, 'Exposure')).toBeEnabled()
}

async function setSlider(control: Locator, value: number): Promise<void> {
  await control.evaluate((element, value) => {
    const input = element as HTMLInputElement
    input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    input.value = String(value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
  }, value)
  await expect(control).toHaveValue(String(value))
}

async function pixels(page: Page): Promise<number[]> {
  const encoded = Array.from(await preview(page).screenshot())
  return page.evaluate(async encoded => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(encoded)], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const result = Array.from(ctx.getImageData(0, 0, bitmap.width, bitmap.height).data)
    bitmap.close()
    return result
  }, encoded)
}

const maxDifference = (a: number[], b: number[]): number => {
  expect(a.length).toBe(b.length)
  return a.reduce((max, value, i) => Math.max(max, Math.abs(value - b[i]!)), 0)
}

test.beforeEach(async ({ page }) => { await page.goto('/') })

test('empty state is accessible and JPEG/PNG load with normalized dimensions', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /Make room/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()
  await expect(slider(page, 'Exposure')).toBeDisabled()
  for (const [filename, dimensions] of [
    ['illustrative-landscape.jpg', '160 × 96 px'],
    ['transparent-edges.png', '96 × 64 px'],
    ['orientation-6.jpg', '48 × 80 px'],
  ]) {
    await openImage(page, filename)
    await expect(page.getByText(filename!, { exact: true })).toBeVisible()
    await expect(page.getByText(dimensions!, { exact: false })).toBeVisible()
    await expect(preview(page)).toBeVisible()
  }
})

test('bad imports preserve current photograph, settings, rendered pixels and history', async ({ page }) => {
  await openImage(page)
  await setSlider(slider(page, 'Exposure'), .45)
  await page.getByRole('button', { name: /Amber Hour/ }).click()
  const prior = await pixels(page)
  for (const filename of ['corrupt.png', 'unsupported.svg', 'animated.png', 'corrupt-payload.png']) {
    await imageInput(page).setInputFiles(fixturePath(filename))
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(status(page)).toContainText('current photograph and edits are safe')
    await expect(page.getByText('illustrative-landscape.png', { exact: true })).toBeVisible()
    await expect(slider(page, 'Exposure')).toHaveValue('0.45')
    await expect(page.getByRole('button', { name: /Amber Hour/ })).toHaveAttribute('aria-pressed', 'true')
    expect(maxDifference(await pixels(page), prior)).toBeLessThanOrEqual(1)
    await page.getByRole('button', { name: 'Dismiss error' }).click()
  }
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(slider(page, 'Exposure')).toHaveValue('0.45')
  await expect(page.getByRole('button', { name: /Amber Hour/ })).toHaveAttribute('aria-pressed', 'false')
})

test('adjustments update pixels; presets switch noncumulatively and intensity endpoints are neutral', async ({ page }) => {
  await openImage(page, 'chart-ramp.png')
  const neutral = await pixels(page)
  await setSlider(slider(page, 'Exposure'), 1)
  expect(maxDifference(await pixels(page), neutral)).toBeGreaterThan(20)
  await page.getByRole('button', { name: 'Reset exposure', exact: true }).click()
  expect(maxDifference(await pixels(page), neutral)).toBeLessThanOrEqual(1)
  await page.getByRole('button', { name: /Amber Hour/ }).click()
  const amber = await pixels(page)
  expect(maxDifference(amber, neutral)).toBeGreaterThan(10)
  await page.getByRole('button', { name: /Midnight Blue/ }).click()
  expect(maxDifference(await pixels(page), amber)).toBeGreaterThan(10)
  await page.getByRole('button', { name: /Amber Hour/ }).click()
  expect(maxDifference(await pixels(page), amber)).toBeLessThanOrEqual(1)
  await setSlider(slider(page, 'Intensity'), 0)
  expect(maxDifference(await pixels(page), neutral)).toBeLessThanOrEqual(1)
  await setSlider(slider(page, 'Intensity'), 100)
  expect(maxDifference(await pixels(page), amber)).toBeLessThanOrEqual(1)
  await setSlider(slider(page, 'Saturation'), -100)
  const monochrome = await pixels(page)
  let channelDifference = 0
  for (let i = 0; i < monochrome.length; i += 4) {
    channelDifference = Math.max(channelDifference, Math.abs(monochrome[i]! - monochrome[i + 1]!), Math.abs(monochrome[i]! - monochrome[i + 2]!))
  }
  expect(channelDifference).toBeLessThanOrEqual(1)
  await page.getByRole('button', { name: 'Remove look', exact: true }).click()
  await expect(slider(page, 'Saturation')).toHaveValue('-100')
  await expect(slider(page, 'Intensity')).toBeDisabled()
})

test('before comparison changes only view and export remains edited', async ({ page }) => {
  await openImage(page, 'chart-ramp.png')
  const neutral = await pixels(page)
  await setSlider(slider(page, 'Exposure'), 1)
  const edited = await pixels(page)
  await page.getByRole('button', { name: 'Before / after', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Show edited' })).toHaveAttribute('aria-pressed', 'true')
  expect(maxDifference(await pixels(page), neutral)).toBeLessThanOrEqual(1)
  await expect(slider(page, 'Exposure')).toHaveValue('1')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByLabel('File format', { exact: true }).selectOption('image/png')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PNG', exact: true }).click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  if (!stream) throw new Error('Download stream unavailable')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array))
  const output = await page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const pixels = Array.from(ctx.getImageData(0, 0, bitmap.width, bitmap.height).data)
    bitmap.close()
    return pixels
  }, Array.from(Buffer.concat(chunks)))
  expect(maxDifference(output, edited)).toBeLessThanOrEqual(3)
  await page.getByRole('button', { name: 'Show edited', exact: true }).click()
  expect(maxDifference(await pixels(page), edited)).toBeLessThanOrEqual(1)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(slider(page, 'Exposure')).toHaveValue('0')
})

test('pointer and held-key gestures group history; undo branching and reset are reversible', async ({ page }) => {
  await openImage(page)
  const exposure = slider(page, 'Exposure')
  await exposure.evaluate(element => {
    const input = element as HTMLInputElement
    input.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    for (const value of [.1, .3, .7]) {
      input.value = String(value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    input.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
  })
  await expect(exposure).toHaveValue('0.7')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(exposure).toHaveValue('0')
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  await page.keyboard.press('Control+Shift+z')
  await expect(exposure).toHaveValue('0.7')
  await exposure.focus()
  await page.keyboard.down('ArrowRight')
  await page.keyboard.down('ArrowRight')
  await page.keyboard.down('ArrowRight')
  await page.keyboard.up('ArrowRight')
  await expect(exposure).toHaveValue('0.73')
  await page.keyboard.press('Control+z')
  await expect(exposure).toHaveValue('0.7')
  await page.getByRole('button', { name: /Silver Study/ }).click()
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Reset all', exact: true }).click()
  await expect(exposure).toHaveValue('0')
  await expect(page.getByRole('button', { name: /Silver Study/ })).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('Control+z')
  await expect(exposure).toHaveValue('0.7')
  await expect(page.getByRole('button', { name: /Silver Study/ })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Control+y')
  await expect(exposure).toHaveValue('0')
})

test('native keyboard slider controls and zoom/pan remain view-only', async ({ page }) => {
  await openImage(page, 'chart-ramp.png')
  const temperature = slider(page, 'Temperature')
  await temperature.focus()
  await page.keyboard.press('End')
  await expect(temperature).toHaveValue('100')
  await page.keyboard.press('Home')
  await expect(temperature).toHaveValue('-100')
  await page.getByRole('button', { name: 'Reset temperature', exact: true }).click()
  await expect(temperature).toHaveValue('0')
  for (let i = 0; i < 7; i++) await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  const transform = await preview(page).evaluate(canvas => (canvas as HTMLCanvasElement).style.transform)
  await page.getByRole('region', { name: /Image preview/ }).focus()
  await page.keyboard.press('ArrowRight')
  expect(await preview(page).evaluate(canvas => (canvas as HTMLCanvasElement).style.transform)).not.toBe(transform)
  await page.getByRole('button', { name: 'Fit', exact: true }).click()
  await expect(preview(page)).toHaveAttribute('style', /translate\(0px,\s*0px\) scale\(1\)/)
  await expect(temperature).toHaveValue('0')
})

test('mobile workspace has no horizontal overflow and controls/export remain reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: 'Choose a photograph' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await openImage(page, 'transparent-edges.png')
  await page.getByRole('button', { name: /Soft Light/ }).click()
  await setSlider(slider(page, 'Tint'), 25)
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByLabel('File format', { exact: true }).selectOption('image/png')
  await page.getByRole('button', { name: 'Download PNG', exact: true }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: 'Download PNG', exact: true })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.setViewportSize({ width: 320, height: 568 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('PNG and JPEG downloads have correct signatures, dimensions, alpha and safe names', async ({ page }) => {
  await openImage(page, 'transparent-edges.png')
  await setSlider(slider(page, 'Exposure'), .7)
  for (const [format, extension] of [['image/png', 'png'], ['image/jpeg', 'jpg']]) {
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    await page.getByLabel('File format', { exact: true }).selectOption(format!)
    if (format === 'image/jpeg') {
      await expect(page.getByText('Transparent areas flatten on', { exact: false })).toContainText('white')
      await setSlider(slider(page, 'JPEG quality'), 98)
    }
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: format === 'image/png' ? 'Download PNG' : 'Download JPEG', exact: true }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe(`transparent-edges-daguerrify.${extension}`)
    const stream = await download.createReadStream()
    if (!stream) throw new Error('Download stream unavailable')
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array))
    const bytes = Buffer.concat(chunks)
    if (format === 'image/png') expect(Array.from(bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    else expect(Array.from(bytes.subarray(0, 2))).toEqual([255, 216])
    const decoded = await page.evaluate(async ({ bytes, format }) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: format }))
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      const result = {
        dimensions: [bitmap.width, bitmap.height],
        edge: Array.from(ctx.getImageData(2, 2, 1, 1).data),
        half: Array.from(ctx.getImageData(24, 20, 1, 1).data),
      }
      bitmap.close()
      return result
    }, { bytes: Array.from(bytes), format: format! })
    expect(decoded.dimensions).toEqual([96, 64])
    if (format === 'image/png') {
      expect(decoded.edge[3]).toBe(0)
      expect(decoded.half[3]).toBe(128)
    } else {
      expect(decoded.edge).toEqual([255, 255, 255, 255])
      expect(decoded.half[3]).toBe(255)
    }
    await expect(status(page)).toContainText('Your original is unchanged')
    await expect(slider(page, 'Exposure')).toHaveValue('0.7')
  }
})

test('unavailable WebGL reports an actionable error rather than unedited fallback', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type === 'webgl2') return null
      return Reflect.apply(original, this, [type, ...args])
    } as typeof original
  })
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('WebGL2')
  await imageInput(page).setInputFiles(fixturePath('illustrative-landscape.png'))
  await expect(status(page)).toContainText('No photograph opened')
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()
})

test('new import wins over a delayed decoder and stale thumbnail work', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.createImageBitmap.bind(window)
    window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
      if (args[0] instanceof File && args[0].name === 'illustrative-landscape.jpg') {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      return Reflect.apply(original, window, args)
    }) as typeof createImageBitmap
  })
  await page.reload()
  await openImage(page, 'chart-ramp.png')
  await imageInput(page).setInputFiles(fixturePath('illustrative-landscape.jpg'))
  await expect(status(page)).toContainText('Opening your photograph')
  await imageInput(page).setInputFiles(fixturePath('transparent-edges.png'))
  await expect(status(page)).toContainText('Photograph ready')
  await expect(page.getByText('transparent-edges.png', { exact: true })).toBeVisible()
  await expect(page.locator('.preset-card img')).toHaveCount(5)
  await page.waitForTimeout(550)
  await expect(page.getByText('transparent-edges.png', { exact: true })).toBeVisible()
  await expect(page.getByText('96 × 64 px', { exact: false })).toBeVisible()
  await expect(slider(page, 'Exposure')).toHaveValue('0')
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
})
