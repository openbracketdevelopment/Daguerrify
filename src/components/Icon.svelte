<script lang="ts">
  export let name: 'open' | 'undo' | 'redo' | 'download' | 'image' | 'plus' | 'minus' | 'fit' | 'reset' | 'compare' | 'close' | 'lock' | 'spark' = 'image'
  const paths: Record<string, string> = {
    open: 'M3 7h6l2 2h10l-3 10H3V7Zm0 0V5h7l2 2h7v2',
    undo: 'M8 4 3 9l5 5M3 9h10a7 7 0 0 1 7 7v3',
    redo: 'm16 4 5 5-5 5m5-5H11a7 7 0 0 0-7 7v3',
    download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
    image: 'M4 4h16v16H4V4Zm0 12 5-5 5 5 3-3 3 3M15 8h.01',
    plus: 'M12 5v14M5 12h14', minus: 'M5 12h14',
    fit: 'M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5M8 8h8v8H8V8Z',
    reset: 'M3 10a9 9 0 1 1 2 8M3 4v6h6',
    compare: 'M12 3v18M8 5H3v14h5m8-14h5v14h-5',
    close: 'm6 6 12 12M6 18 18 6',
    lock: 'M6 10h12v11H6V10Zm3 0V6a3 3 0 0 1 6 0v4',
    spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
  }
</script>

<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d={paths[name]} />
</svg>
