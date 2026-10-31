import { createDocument, validateDocument, NEUTRAL, type Adjustments, type EditDocument } from '../../editor/state/document'
import { pipelineParameters } from '../color'
import { DEFAULT_LIMITS, validateDimensions, type ImageFormat, type LoadedImage } from '../image'
import { fragmentShader, vertexShader } from './shaders'

export interface RendererCapabilities {
  maxTextureSize: number
  maxRenderbufferSize: number
  maxViewportDimensions: readonly [number, number]
  maxMemoryBytes: number
}

export class ImageRenderer {
  private readonly gl: WebGL2RenderingContext
  private caps!: RendererCapabilities
  private program: WebGLProgram | null = null
  private vao: WebGLVertexArrayObject | null = null
  private texture: WebGLTexture | null = null
  private source: LoadedImage | null = null
  private settings = createDocument()
  private previewWidth = 1
  private previewHeight = 1
  private before = false
  private frame: number | null = null
  private lost = false
  private disposed = false
  private encoding = false
  private encodingBytes = 0

  get capabilities(): Readonly<RendererCapabilities> { return this.caps }

  constructor(private readonly canvas: HTMLCanvasElement, private readonly onStatus?: (message: string, unavailable: boolean) => void) {
    const gl = canvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: false, antialias: false,
      depth: false, stencil: false, preserveDrawingBuffer: false,
    })
    if (!gl) throw new Error('WebGL2 is unavailable. Use a browser with hardware acceleration enabled.')
    this.gl = gl
    this.initialize()
    canvas.addEventListener('webglcontextlost', this.handleLost)
    canvas.addEventListener('webglcontextrestored', this.handleRestored)
  }

  private readonly handleLost = (event: Event): void => {
    event.preventDefault()
    this.lost = true
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.frame = null
    // Context loss invalidates these handles, but the original bitmap and edits survive.
    this.texture = null
    this.program = null
    this.vao = null
    this.onStatus?.('Graphics context lost. Editing and export are paused until it recovers.', true)
  }

  private readonly handleRestored = (): void => {
    if (this.disposed) return
    try {
      this.initialize()
      this.lost = false
      this.validateTarget(this.previewWidth, this.previewHeight, 8, this.sourceBytes())
      if (this.source) {
        this.validateTarget(this.source.width, this.source.height, 8, this.source.file.size + this.previewBytes())
        this.texture = this.upload(this.source)
      }
      this.render()
      this.onStatus?.('Graphics context restored.', false)
    } catch (error) {
      this.releaseResources()
      this.lost = true
      this.onStatus?.(`Graphics recovery failed: ${error instanceof Error ? error.message : 'Unknown error'}`, true)
    }
  }

  private initialize(): void {
    const gl = this.gl
    const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array
    this.caps = Object.freeze({
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
      maxViewportDimensions: Object.freeze([viewport[0]!, viewport[1]!] as [number, number]),
      maxMemoryBytes: DEFAULT_LIMITS.maxMemoryBytes,
    })
    if (!gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision) {
      throw new Error('High precision image processing is unavailable.')
    }
    const shaders: WebGLShader[] = []
    let program: WebGLProgram | null = null
    let vao: WebGLVertexArrayObject | null = null
    try {
      for (const [type, code] of [[gl.VERTEX_SHADER, vertexShader], [gl.FRAGMENT_SHADER, fragmentShader]] as const) {
        const shader = gl.createShader(type)
        if (!shader) throw new Error('Could not allocate an image shader.')
        shaders.push(shader)
        gl.shaderSource(shader, code)
        gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          throw new Error(`Image shader compilation failed: ${gl.getShaderInfoLog(shader) ?? ''}`)
        }
      }
      program = gl.createProgram()
      if (!program) throw new Error('Could not allocate the image program.')
      for (const shader of shaders) gl.attachShader(program, shader)
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`Image shader linking failed: ${gl.getProgramInfoLog(program) ?? ''}`)
      }
      vao = gl.createVertexArray()
      if (!vao) throw new Error('Could not allocate image geometry.')
      gl.disable(gl.BLEND)
      gl.disable(gl.DEPTH_TEST)
      gl.disable(gl.DITHER)
      this.checkError('Graphics initialization')
      this.program = program
      this.vao = vao
    } catch (error) {
      if (program) { gl.deleteProgram(program); program = null }
      if (vao) gl.deleteVertexArray(vao)
      throw error
    } finally {
      for (const shader of shaders) {
        if (program) gl.detachShader(program, shader)
        gl.deleteShader(shader)
      }
    }
  }

  private assertAvailable(): void {
    if (this.disposed) throw new Error('The image renderer has been disposed.')
    if (this.lost || this.gl.isContextLost()) throw new Error('Graphics context is unavailable. Wait for recovery before exporting.')
  }

  private checkError(operation: string): void {
    const error = this.gl.getError()
    if (error !== this.gl.NO_ERROR || this.gl.isContextLost()) {
      throw new Error(`${operation} failed. Graphics resources may be exhausted (error ${error}).`)
    }
  }

  private previewBytes(): number { return this.previewWidth * this.previewHeight * 8 }
  private sourceBytes(): number { return this.source ? this.source.width * this.source.height * 8 + this.source.file.size : 0 }
  private validateTarget(width: number, height: number, bytesPerPixel: number, extra: number): void {
    validateDimensions(width, height, this.caps, bytesPerPixel, extra)
    if (width > this.caps.maxViewportDimensions[0] || height > this.caps.maxViewportDimensions[1]) {
      throw new Error('Image dimensions exceed the graphics viewport limit.')
    }
  }

  private configureTexture(texture: WebGLTexture): void {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  private upload(source: LoadedImage): WebGLTexture {
    const gl = this.gl
    const texture = gl.createTexture()
    const framebuffer = gl.createFramebuffer()
    if (!texture || !framebuffer) {
      if (texture) gl.deleteTexture(texture)
      if (framebuffer) gl.deleteFramebuffer(framebuffer)
      throw new Error('Could not allocate source graphics resources.')
    }
    try {
      this.configureTexture(texture)
      // ImageBitmap already has orientation, color conversion and straight alpha applied.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source.bitmap)
      this.checkError('Source upload')
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('Source texture allocation is incomplete.')
      }
      this.checkError('Source allocation')
      return texture
    } catch (error) {
      gl.deleteTexture(texture)
      throw error
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.deleteFramebuffer(framebuffer)
      gl.bindTexture(gl.TEXTURE_2D, this.texture)
    }
  }

  setSource(source: LoadedImage): void {
    this.assertAvailable()
    if (source === this.source) return
    if (source.bitmap.width !== source.width || source.bitmap.height !== source.height) {
      throw new Error('The decoded image is no longer available.')
    }
    this.validateTarget(source.width, source.height, 8, source.file.size + this.sourceBytes() + this.previewBytes() + this.encodingBytes)
    const next = this.upload(source)
    const previous = this.texture
    this.texture = next
    this.source = source
    if (previous) this.gl.deleteTexture(previous)
    this.render()
  }

  setDocument(document: EditDocument): void {
    if (this.disposed) throw new Error('The image renderer has been disposed.')
    pipelineParameters(document)
    this.settings = validateDocument(document)
    this.render()
  }

  setPreviewSize(width: number, height: number): void {
    if (this.disposed) throw new Error('The image renderer has been disposed.')
    this.validateTarget(width, height, 8, this.sourceBytes() + this.encodingBytes)
    this.previewWidth = width
    this.previewHeight = height
    this.render()
  }

  render(before?: boolean): void {
    if (before !== undefined) this.before = before
    if (this.disposed || this.lost || !this.texture || this.frame !== null) return
    this.frame = requestAnimationFrame(() => {
      this.frame = null
      if (this.disposed || this.lost) return
      try {
        if (this.canvas.width !== this.previewWidth) this.canvas.width = this.previewWidth
        if (this.canvas.height !== this.previewHeight) this.canvas.height = this.previewHeight
        this.draw(this.settings, this.previewWidth, this.previewHeight, null, this.before, false)
      } catch (error) {
        this.onStatus?.(error instanceof Error ? error.message : 'Image rendering failed.', true)
      }
    })
  }

  private uniforms(prefix: string, values: Adjustments): void {
    const gl = this.gl
    gl.uniform4f(gl.getUniformLocation(this.program!, `${prefix}A`),
      values.exposure, values.contrast / 100, values.temperature / 100, values.tint / 100)
    gl.uniform1f(gl.getUniformLocation(this.program!, `${prefix}S`), values.saturation / 100)
  }

  private draw(document: EditDocument, width: number, height: number, framebuffer: WebGLFramebuffer | null, before: boolean, flattenWhite: boolean): void {
    this.assertAvailable()
    if (!this.texture || !this.program) throw new Error('Load an image first.')
    const gl = this.gl
    const params = pipelineParameters(document)
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.viewport(0, 0, width, height)
    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.uniform1i(gl.getUniformLocation(this.program, 'source'), 0)
    this.uniforms('manual', params.manual)
    this.uniforms('preset', params.preset ?? NEUTRAL)
    gl.uniform1f(gl.getUniformLocation(this.program, 'intensity'), params.preset ? params.intensity : 0)
    gl.uniform1i(gl.getUniformLocation(this.program, 'before'), before ? 1 : 0)
    gl.uniform1i(gl.getUniformLocation(this.program, 'flattenWhite'), flattenWhite ? 1 : 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    this.checkError('Image rendering')
  }

  private outputCanvas(document: EditDocument, width: number, height: number, flattenWhite: boolean): HTMLCanvasElement {
    this.assertAvailable()
    if (!this.source) throw new Error('Load an image first.')
    // Source bitmap + texture, preview buffers, output texture, readback, 2D and encoder.
    this.validateTarget(width, height, 16, this.sourceBytes() + this.previewBytes())
    const gl = this.gl
    const texture = gl.createTexture()
    const framebuffer = gl.createFramebuffer()
    if (!texture || !framebuffer) {
      if (texture) gl.deleteTexture(texture)
      if (framebuffer) gl.deleteFramebuffer(framebuffer)
      throw new Error('Could not allocate export graphics resources.')
    }
    try {
      this.configureTexture(texture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      this.checkError('Export allocation')
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('Export framebuffer is incomplete.')
      }
      this.draw(document, width, height, framebuffer, false, flattenWhite)
      const pixels = new Uint8ClampedArray(width * height * 4)
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      this.checkError('Export readback')
      // WebGL readback is bottom-up; ImageData is top-down. Swap in place.
      const stride = width * 4
      for (let y = 0; y < Math.floor(height / 2); y++) {
        const top = y * stride
        const bottom = (height - y - 1) * stride
        for (let x = 0; x < stride; x++) {
          const value = pixels[top + x]!
          pixels[top + x] = pixels[bottom + x]!
          pixels[bottom + x] = value
        }
      }
      const canvas = globalThis.document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d', { alpha: !flattenWhite })
      if (!context) throw new Error('Canvas encoding is unavailable.')
      context.putImageData(new ImageData(pixels, width, height), 0, 0)
      return canvas
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.deleteFramebuffer(framebuffer)
      gl.deleteTexture(texture)
      gl.bindTexture(gl.TEXTURE_2D, this.texture)
      gl.viewport(0, 0, this.previewWidth, this.previewHeight)
    }
  }

  async export(format: ImageFormat, quality = .92): Promise<Blob> {
    if (format !== 'image/jpeg' && format !== 'image/png') throw new Error('Unsupported export format.')
    if (!Number.isFinite(quality) || quality < 0 || quality > 1) throw new Error('JPEG quality must be between 0 and 1.')
    this.assertAvailable()
    if (this.encoding) throw new Error('An export is already being encoded. Please wait.')
    if (!this.source) throw new Error('Load an image first.')
    const canvas = this.outputCanvas(this.settings, this.source.width, this.source.height, format === 'image/jpeg')
    this.encoding = true
    this.encodingBytes = canvas.width * canvas.height * 16
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image encoding failed.')), format, quality)
      })
      this.assertAvailable()
      if (blob.type !== format) throw new Error('The browser cannot encode the requested image format.')
      return blob
    } finally {
      canvas.width = canvas.height = 1
      this.encoding = false
      this.encodingBytes = 0
    }
  }

  async thumbnail(document: EditDocument, width = 160): Promise<string> {
    this.assertAvailable()
    if (this.encoding) throw new Error('An export is already being encoded. Please wait.')
    if (!this.source) throw new Error('Load an image first.')
    if (!Number.isSafeInteger(width) || width < 1 || width > 512) throw new Error('Thumbnail width must be between 1 and 512.')
    const scale = width / Math.max(this.source.width, this.source.height)
    const targetWidth = Math.max(1, Math.round(this.source.width * scale))
    const height = Math.max(1, Math.round(this.source.height * scale))
    const canvas = this.outputCanvas(validateDocument(document), targetWidth, height, false)
    try {
      const url = canvas.toDataURL('image/png')
      if (!url.startsWith('data:image/png;')) throw new Error('Thumbnail encoding failed.')
      return url
    } finally {
      canvas.width = canvas.height = 1
    }
  }

  private releaseResources(): void {
    const gl = this.gl
    if (this.texture) gl.deleteTexture(this.texture)
    if (this.vao) gl.deleteVertexArray(this.vao)
    if (this.program) gl.deleteProgram(this.program)
    this.texture = null
    this.vao = null
    this.program = null
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.frame = null
    this.canvas.removeEventListener('webglcontextlost', this.handleLost)
    this.canvas.removeEventListener('webglcontextrestored', this.handleRestored)
    this.releaseResources()
    this.source?.dispose()
    this.source = null
  }
}
