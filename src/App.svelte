<script lang="ts">
  import { onMount, tick } from 'svelte'
  import Icon from './components/Icon.svelte'
  import AdjustmentSlider from './components/AdjustmentSlider.svelte'
  import { loadImage, type LoadedImage } from './engine/image'
  import { ImageRenderer } from './engine/rendering/renderer'
  import { ADJUSTMENT_KEYS, CONTROL_LABELS, NEUTRAL, createDocument, validateDocument, type AdjustmentKey, type EditDocument, type PresetId } from './editor/state/document'
  import { PRESETS, getPreset } from './editor/presets/presets'
  import { EditHistory } from './editor/history/history'

  let canvas: HTMLCanvasElement
  let viewport: HTMLDivElement
  let fileInput: HTMLInputElement
  let renderer: ImageRenderer | undefined
  let source = $state<LoadedImage | null>(null)
  let document = $state<EditDocument>(createDocument())
  let history = new EditHistory(createDocument())
  let canUndo = $state(false)
  let canRedo = $state(false)
  let importing = $state(false)
  let exporting = $state(false)
  let unavailable = $state(false)
  let status = $state('Your photograph. Your darkroom.')
  let error = $state('')
  let gpuMessage = $state('')
  let before = $state(false)
  let dragActive = $state(false)
  let exportOpen = $state(false)
  let exportFormat = $state<'image/jpeg' | 'image/png'>('image/jpeg')
  let quality = $state(92)
  let thumbnails = $state<Partial<Record<PresetId, string>>>({})
  let generation = 0
  let thumbnailRun = 0
  let destroyed = false
  let observer: ResizeObserver
  let viewportWidth = $state(800)
  let viewportHeight = $state(560)
  let zoom = $state(1)
  let panX = $state(0)
  let panY = $state(0)
  let panning = $state(false)
  let pointer: { id: number; x: number; y: number; panX: number; panY: number } | null = null
  const busy = $derived(importing || exporting)
  const disabled = $derived(!source || busy || unavailable)
  const fitScale = $derived(source ? Math.min(Math.max(1, viewportWidth - 64) / source.width, Math.max(1, viewportHeight - 64) / source.height, 1) : 1)
  const imageWidth = $derived(source ? Math.max(1, source.width * fitScale) : 1)
  const imageHeight = $derived(source ? Math.max(1, source.height * fitScale) : 1)
  const zoomPercent = $derived(Math.round(fitScale * zoom * 100))
  const activePreset = $derived(getPreset(document.presetId))

  function message(reason: unknown): string {
    return reason instanceof Error ? reason.message : 'Something went wrong. Please try again.'
  }
  function syncHistory(): void {
    document = history.value
    canUndo = history.canUndo
    canRedo = history.canRedo
    renderer?.setDocument(document)
    renderer?.render(before)
  }
  function begin(): void { history.begin() }
  function end(): void {
    history.end()
    canUndo = history.canUndo
    canRedo = history.canRedo
  }
  function update(next: EditDocument): void {
    history.update(validateDocument(next))
    syncHistory()
  }
  function action(next: EditDocument, announcement: string): void {
    if (disabled) return
    end()
    update(next)
    status = announcement
  }
  function adjust(key: AdjustmentKey, value: number): void {
    update({ ...document, adjustments: { ...document.adjustments, [key]: value } })
  }
  function selectPreset(id: PresetId | null): void {
    action({ ...document, presetId: id }, id ? `${getPreset(id)?.name} applied.` : 'Original look selected. Your adjustments are retained.')
  }
  function undo(): void {
    if (disabled) return
    history.undo()
    syncHistory()
    status = 'Undid the last edit.'
  }
  function redo(): void {
    if (disabled) return
    history.redo()
    syncHistory()
    status = 'Redid the last edit.'
  }
  function toggleBefore(): void {
    if (disabled) return
    before = !before
    renderer?.render(before)
    status = before ? 'Viewing the untouched original.' : 'Viewing your edited photograph.'
  }
  function clampPan(): void {
    const limitX = Math.max(0, (imageWidth * zoom - viewportWidth) / 2 + 24)
    const limitY = Math.max(0, (imageHeight * zoom - viewportHeight) / 2 + 24)
    panX = Math.max(-limitX, Math.min(limitX, panX))
    panY = Math.max(-limitY, Math.min(limitY, panY))
  }
  function sizePreview(): void {
    if (!source || !renderer || unavailable) return
    const scale = Math.min(window.devicePixelRatio || 1, 2) * zoom
    const cap = Math.min(1, 1600 / Math.max(imageWidth * scale, imageHeight * scale))
    try {
      renderer.setPreviewSize(Math.max(1, Math.round(imageWidth * scale * cap)), Math.max(1, Math.round(imageHeight * scale * cap)))
      renderer.render(before)
    } catch (reason) {
      error = message(reason)
      status = 'Preview sizing failed. Your original and edits are safe; try fitting the view.'
    }
  }
  function resetView(): void {
    zoom = 1
    panX = panY = 0
    sizePreview()
  }
  function setZoom(value: number): void {
    zoom = Math.max(1, Math.min(Math.max(8, 1 / fitScale), value))
    clampPan()
    sizePreview()
  }
  function panStart(event: PointerEvent): void {
    if (!source || zoom <= 1 || event.button !== 0) return
    viewport.setPointerCapture(event.pointerId)
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, panX, panY }
    panning = true
  }
  function panMove(event: PointerEvent): void {
    if (!pointer || pointer.id !== event.pointerId) return
    panX = pointer.panX + event.clientX - pointer.x
    panY = pointer.panY + event.clientY - pointer.y
    clampPan()
  }
  function panEnd(event: PointerEvent): void {
    if (pointer?.id !== event.pointerId) return
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId)
    pointer = null
    panning = false
  }
  function keyboard(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return
    const key = event.key.toLowerCase()
    if (key === 'z' || key === 'y') {
      event.preventDefault()
      if (key === 'y' || event.shiftKey) redo()
      else undo()
    }
  }
  async function makeThumbnails(token: number): Promise<void> {
    const run = ++thumbnailRun
    for (const preset of PRESETS) {
      await new Promise<void>(resolve => window.setTimeout(resolve, 30))
      if (destroyed || token !== generation || run !== thumbnailRun || !renderer || unavailable) return
      if (thumbnails[preset.id]) continue
      try {
        const data = await renderer.thumbnail({ ...createDocument(), presetId: preset.id }, 160)
        if (destroyed || token !== generation || run !== thumbnailRun) return
        thumbnails = { ...thumbnails, [preset.id]: data }
      } catch { return }
    }
  }
  async function openFile(file?: File): Promise<void> {
    if (!file || exporting) return
    const token = ++generation
    importing = true
    error = ''
    status = 'Opening your photograph…'
    let loaded: LoadedImage | undefined
    try {
      loaded = await loadImage(file)
      if (destroyed || token !== generation) { loaded.dispose(); return }
      if (!renderer || unavailable) throw new Error('WebGL2 is not available. Enable hardware acceleration or try another browser, then reopen your photograph.')
      renderer.setSource(loaded)
      const previous = source
      source = loaded
      loaded = undefined
      previous?.dispose()
      history = new EditHistory(createDocument())
      before = false
      syncHistory()
      resetView()
      thumbnails = {}
      exportOpen = false
      status = 'Photograph ready. Every edit stays on this device.'
      void makeThumbnails(token)
    } catch (reason) {
      loaded?.dispose()
      if (!destroyed && token === generation) {
        error = message(reason)
        status = source ? 'Your current photograph and edits are safe.' : 'No photograph opened.'
        // A rejected import must not invalidate thumbnails for the retained source.
        if (source) void makeThumbnails(token)
      }
    } finally {
      if (token === generation) importing = false
    }
  }
  function fileChanged(event: Event): void {
    const input = event.currentTarget as HTMLInputElement
    void openFile(input.files?.[0])
    input.value = ''
  }
  function drop(event: DragEvent): void {
    event.preventDefault()
    dragActive = false
    if (event.dataTransfer?.files.length) void openFile(event.dataTransfer.files[0])
  }
  function dragOver(event: DragEvent): void {
    if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); dragActive = true }
  }
  function filename(file: File, format: string): string {
    const base = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, 100) || 'photograph'
    return `${base}-daguerrify.${format === 'image/jpeg' ? 'jpg' : 'png'}`
  }
  async function toggleExport(): Promise<void> {
    exportOpen = !exportOpen
    if (exportOpen) {
      await tick()
      window.document.getElementById('export-format')?.focus()
    }
  }
  async function download(): Promise<void> {
    if (disabled || !renderer || !source) return
    exporting = true
    error = ''
    status = 'Preparing your full-resolution image…'
    const file = source.file
    const format = exportFormat
    let url: string | undefined
    try {
      const blob = await renderer.export(format, quality / 100)
      if (destroyed) return
      url = URL.createObjectURL(blob)
      const link = window.document.createElement('a')
      link.href = url
      link.download = filename(file, format)
      window.document.body.appendChild(link)
      link.click()
      link.remove()
      const downloadUrl = url
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
      url = undefined
      status = `Downloaded ${filename(file, format)}. Your original is unchanged.`
      exportOpen = false
    } catch (reason) {
      error = message(reason)
      status = 'Export failed. Your photograph and edits are safe.'
    } finally {
      if (url) URL.revokeObjectURL(url)
      exporting = false
      renderer?.render(before)
      if (!destroyed) void makeThumbnails(generation)
    }
  }

  onMount(() => {
    try {
      renderer = new ImageRenderer(canvas, (text, lost) => {
        unavailable = lost
        gpuMessage = text
        if (!lost && source) {
          sizePreview()
          void makeThumbnails(generation)
        }
      })
    } catch (reason) {
      unavailable = true
      gpuMessage = message(reason)
    }
    observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      viewportWidth = rect.width
      viewportHeight = rect.height
      clampPan()
      sizePreview()
    })
    observer.observe(viewport)
    return () => {
      destroyed = true
      generation++
      observer.disconnect()
      renderer?.dispose()
      source?.dispose()
    }
  })
</script>

<svelte:window onkeydown={keyboard} ondragover={dragOver} ondrop={drop} ondragleave={(event) => { if (!event.relatedTarget) dragActive = false }} onpointerup={end} onblur={end} />

<input bind:this={fileInput} class="file-input" type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" aria-label="Open a JPEG or PNG photograph" onchange={fileChanged} />

<div class="app-shell">
  <header class="topbar">
    <a class="brand" href="./" aria-label="Daguerrify home">
      <span class="brand-mark" aria-hidden="true">d<span></span></span>
      <span>Daguerrify<span class="brand-caption">THE DIGITAL DARKROOM</span></span>
    </a>
    <div class="header-actions">
      <button class="button open-button" aria-label="Open image" disabled={busy} onclick={() => fileInput.click()}><Icon name="open" /><span>Open image</span></button>
      <div class="history-buttons">
        <button class="icon-button" aria-label="Undo" title="Undo (Ctrl/⌘ Z)" disabled={disabled || !canUndo} onclick={undo}><Icon name="undo" /></button>
        <button class="icon-button" aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)" disabled={disabled || !canRedo} onclick={redo}><Icon name="redo" /></button>
      </div>
      <button class="button primary export-trigger" aria-label="Export" disabled={disabled} aria-expanded={exportOpen} aria-controls={exportOpen ? 'export-panel' : undefined} onclick={toggleExport}><Icon name="download" /><span>Export</span></button>
    </div>
  </header>

  {#if error}
    <div class="notice error-notice" role="alert"><span><strong>Couldn't complete that.</strong> {error}</span><button class="icon-button" aria-label="Dismiss error" onclick={() => error = ''}><Icon name="close" /></button></div>
  {/if}
  {#if unavailable}
    <div class="notice gpu-notice" role="alert"><Icon name="image" /><span><strong>The darkroom needs WebGL2.</strong> {gpuMessage || 'Graphics are temporarily unavailable.'} Enable hardware acceleration or try a WebGL2-capable browser. If the graphics context was lost, editing resumes when it is restored; your original remains safe.</span></div>
  {/if}

  <main class="editor-layout">
    <section class="workspace-column" aria-label="Photograph workspace">
      <div class="workspace-heading">
        <div class="photo-title"><span class="eyebrow">YOUR CANVAS</span><span class="filename" title={source?.file.name}>{source ? source.file.name : 'A little light. A new perspective.'}</span></div>
        <button class="button compare-button" disabled={disabled} aria-pressed={before} onclick={toggleBefore}><Icon name="compare" /><span>{before ? 'Show edited' : 'Before / after'}</span></button>
      </div>
      <!-- The focusable preview region intentionally supports keyboard panning without claiming a button or application role. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div class="image-viewport" class:has-image={!!source} class:can-pan={!!source && zoom > 1} class:panning class:dragging={dragActive}
        bind:this={viewport} role="region" aria-label="Image preview. When zoomed, drag or use arrow keys to pan." tabindex={source ? 0 : -1}
        onpointerdown={panStart} onpointermove={panMove} onpointerup={panEnd} onpointercancel={panEnd} onlostpointercapture={() => { pointer = null; panning = false }}
        onkeydown={(event) => {
          if (zoom > 1 && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
            event.preventDefault()
            panX += event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0
            panY += event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0
            clampPan()
          }
        }}>
        <canvas bind:this={canvas} class:visible={!!source} aria-label={before ? 'Original photograph' : 'Edited photograph'}
          style={`width:${imageWidth}px;height:${imageHeight}px;transform:translate(${panX}px,${panY}px) scale(${zoom})`}></canvas>
        {#if !source}
          <div class="empty-state">
            <div class="empty-frame"><Icon name="image" /><span class="frame-spark"><Icon name="spark" /></span></div>
            <span class="eyebrow">A NEW TAKE ON THE DIGITAL DARKROOM</span>
            <h1>Make room<br />for your <em>vision.</em></h1>
            <p>Bring a photograph. Find its feeling.<br />A few thoughtful edits can change everything.</p>
            <button class="button primary choose-button" disabled={busy} onclick={() => fileInput.click()}><Icon name="plus" />Choose a photograph</button>
            <span class="drop-hint">or drop it anywhere here</span>
            <div class="format-tags"><span>JPEG & PNG</span><span>UP TO 20 MiB · 16 MP</span></div>
          </div>
        {:else}
          <span class="preview-badge">{before ? 'ORIGINAL' : 'EDITED'}</span>
          {#if zoom > 1}<span class="pan-hint">Drag to explore · arrow keys to pan</span>{/if}
        {/if}
        {#if importing || exporting}<div class="busy-overlay" aria-hidden="true"><span class="spinner"></span><span>{importing ? 'Opening photograph…' : 'Preparing export…'}</span></div>{/if}
        {#if dragActive}<div class="drop-overlay"><Icon name="open" /><strong>Let your photograph in.</strong><span>Drop a JPEG or PNG to open</span></div>{/if}
      </div>
      <div class="view-toolbar">
        <span class="image-dimensions">{source ? `${source.width.toLocaleString()} × ${source.height.toLocaleString()} px` : 'Your original stays untouched'}{#if source}<span class="dimension-format">{source.format === 'image/jpeg' ? 'JPEG' : 'PNG'}</span>{/if}</span>
        <div class="zoom-controls">
          <button class="icon-button" aria-label="Zoom out" title="Zoom out" disabled={!source || zoom <= 1} onclick={() => setZoom(zoom / 1.25)}><Icon name="minus" /></button>
          <button class="zoom-value" aria-label={`Zoom ${zoomPercent} percent. View at 100 percent`} disabled={!source} onclick={() => setZoom(1 / fitScale)}>{source ? `${zoomPercent}%` : '—'}</button>
          <button class="icon-button" aria-label="Zoom in" title="Zoom in" disabled={!source || zoom >= Math.max(8, 1 / fitScale)} onclick={() => setZoom(zoom * 1.25)}><Icon name="plus" /></button>
          <button class="button fit-button" disabled={!source} onclick={resetView} title="Reset zoom and pan to fit"><Icon name="fit" />Fit</button>
        </div>
      </div>

      <section class="looks-panel" aria-labelledby="looks-heading">
        <div class="section-heading"><div><h2 id="looks-heading">Find your feeling</h2><p>Five original looks. One photograph, new possibilities.</p></div><span class="eyebrow looks-count">01 — 05</span></div>
        <div class="preset-grid">
          {#each PRESETS as preset, index}
            <button class="preset-card" class:selected={document.presetId === preset.id} disabled={disabled} aria-pressed={document.presetId === preset.id} title={preset.description} onclick={() => selectPreset(preset.id)}>
              <span class={`preset-preview preset-${preset.id}`}>
                {#if thumbnails[preset.id]}<img src={thumbnails[preset.id]} alt="" draggable="false" />{:else}<span class="preset-placeholder"><Icon name="image" /></span>{/if}
                <span class="preset-number">0{index + 1}</span>
                {#if document.presetId === preset.id}<span class="selected-dot" aria-hidden="true">✓</span>{/if}
              </span>
              <span class="preset-name">{preset.name}</span>
              <span class="preset-description">{preset.description}</span>
            </button>
          {/each}
        </div>
      </section>
    </section>

    <aside class="adjustments-panel" aria-labelledby="adjustments-heading">
      <div class="panel-heading"><div><span class="eyebrow">THE FINISHING TOUCHES</span><h2 id="adjustments-heading">Adjustments</h2></div><button class="text-button" disabled={disabled} onclick={() => action(createDocument(), 'All adjustments and the look have been reset.')} title="Reset all adjustments and the selected look">Reset all</button></div>
      <div class="adjustment-controls">
        {#each ADJUSTMENT_KEYS as key}
          <AdjustmentSlider id={key} label={CONTROL_LABELS[key]} value={document.adjustments[key]} min={key === 'exposure' ? -2 : -100} max={key === 'exposure' ? 2 : 100} step={key === 'exposure' ? .01 : 1} unit={key === 'exposure' ? ' EV' : ''} {disabled}
            onbegin={begin} onend={end} onvalue={(value) => adjust(key, value)} onreset={() => action({ ...document, adjustments: { ...document.adjustments, [key]: NEUTRAL[key] } }, `${CONTROL_LABELS[key]} reset.`)} />
        {/each}
      </div>
      <div class="look-settings">
        <div class="section-heading"><h2>Look intensity</h2><button class="text-button" disabled={disabled || !document.presetId} onclick={() => selectPreset(null)}>Remove look</button></div>
        <p class="selected-look">{activePreset?.name || 'No look selected'}<span>{activePreset?.description || 'Start with your own adjustments, or explore a look.'}</span></p>
        <AdjustmentSlider id="preset-intensity" label="Intensity" value={document.presetIntensity} min={0} max={100} unit="%" disabled={disabled || !document.presetId} resettable={false} onbegin={begin} onend={end} onvalue={(value) => update({ ...document, presetIntensity: value })} />
      </div>
      {#if exportOpen}
        <section id="export-panel" class="export-panel" aria-labelledby="export-heading">
          <div class="section-heading"><h2 id="export-heading">The final photograph</h2><button class="icon-button tiny" aria-label="Close export settings" onclick={() => exportOpen = false}><Icon name="close" /></button></div>
          <label class="export-label" for="export-format">File format</label>
          <select id="export-format" bind:value={exportFormat} disabled={busy}><option value="image/jpeg">JPEG · smaller file</option><option value="image/png">PNG · preserves transparency</option></select>
          {#if exportFormat === 'image/jpeg'}
            <AdjustmentSlider id="jpeg-quality" label="JPEG quality" value={quality} min={1} max={100} unit="%" disabled={busy} resettable={false} onbegin={() => {}} onend={() => {}} onvalue={(value) => quality = value} />
            <p class="flatten-note"><span class="white-swatch"></span>Transparent areas flatten on <strong>white</strong>.</p>
          {:else}<p class="export-note">Lossless PNG keeps transparent areas transparent.</p>{/if}
          <p class="export-note">Original resolution. A new file.<br />Your source is never overwritten.</p>
          <button class="button primary download-button" disabled={disabled} onclick={download}><Icon name="download" />{exporting ? 'Preparing…' : `Download ${exportFormat === 'image/jpeg' ? 'JPEG' : 'PNG'}`}</button>
        </section>
      {/if}
      <div class="privacy-note"><Icon name="lock" /><div><strong>Made to stay yours.</strong><p>Your photos never leave this device.<br />No uploads. No accounts. Just you.</p></div></div>
    </aside>
  </main>
  <footer class="statusbar"><div class="status-message" role="status" aria-live="polite"><span class="status-dot" class:working={busy} class:offline={unavailable}></span>{status}</div><span class="footer-signature">A little less ordinary.</span></footer>
</div>
