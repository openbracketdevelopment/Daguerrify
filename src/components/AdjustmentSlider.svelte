<script lang="ts">
  import Icon from './Icon.svelte'
  export let id: string
  export let label: string
  export let value: number
  export let min = -100
  export let max = 100
  export let step = 1
  export let unit = ''
  export let disabled = false
  export let resettable = true
  export let onvalue: (value: number) => void
  export let onbegin: () => void
  export let onend: () => void
  export let onreset: () => void = () => {}
  const sliderKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']
  let keyboardGesture = false
  let pointerGesture = false
  function finish(): void {
    if (!keyboardGesture && !pointerGesture) return
    keyboardGesture = pointerGesture = false
    onend()
  }
  $: display = `${value > 0 && min < 0 ? '+' : ''}${step < 1 ? value.toFixed(2) : Math.round(value)}${unit}`
</script>

<svelte:window onpointerup={() => { if (pointerGesture) finish() }} onblur={finish} />

<div class="adjustment" class:inactive={disabled}>
  <div class="control-heading">
    <label for={id}>{label}</label>
    <div class="control-value">
      <output for={id} aria-live="off">{display}</output>
      {#if resettable}
        <button class="icon-button tiny" type="button" aria-label={`Reset ${label.toLowerCase()}`} title={`Reset ${label.toLowerCase()}`} {disabled} onclick={onreset}><Icon name="reset" /></button>
      {/if}
    </div>
  </div>
  <input {id} type="range" {min} {max} {step} {value} {disabled} aria-valuetext={display}
    style={`--range-fill: ${((value - min) / (max - min)) * 100}%`}
    onpointerdown={(event) => {
      event.currentTarget.focus()
      pointerGesture = true
      onbegin()
    }} onpointerup={finish} onpointercancel={finish}
    onkeydown={(event) => { if (sliderKeys.includes(event.key)) { keyboardGesture = true; onbegin() } }}
    onkeyup={(event) => { if (sliderKeys.includes(event.key)) finish() }}
    oninput={(event) => onvalue(Number(event.currentTarget.value))}
    onchange={() => { if (!keyboardGesture && !pointerGesture) onend() }} onblur={finish} />
  {#if id === 'temperature'}<div class="range-hints"><span>Cool</span><span>Warm</span></div>{/if}
  {#if id === 'tint'}<div class="range-hints"><span>Green</span><span>Magenta</span></div>{/if}
</div>
