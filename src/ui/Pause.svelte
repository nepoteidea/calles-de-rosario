<script lang="ts">
  import { onMount } from 'svelte';
  import Attribution from './Attribution.svelte';

  let {
    onResume,
    onMap,
    onControls,
    onMenu,
  }: {
    onResume: () => void;
    onMap: () => void;
    onControls: () => void;
    onMenu: () => void;
  } = $props();
  let first: HTMLButtonElement;
  onMount(() => first?.focus());
</script>

<div class="pause" role="dialog" aria-modal="true" aria-labelledby="pause-title" data-testid="pause">
  <h1 id="pause-title" class="pixel">PAUSA</h1>
  <nav>
    <button class="btn primary" bind:this={first} onclick={onResume}>
      <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true">
        <path d="M0 0 L16 9 L0 18 Z" fill="currentColor"></path>
      </svg>
      SEGUIR
    </button>
    <button class="btn" onclick={onMap}>MAPA DE LA CIUDAD</button>
    <button class="btn" onclick={onControls}>CONTROLES</button>
    <button class="btn" onclick={onMenu}>MENÚ</button>
  </nav>
  <p class="foot"><Attribution /></p>
</div>

<style>
  .pause {
    position: absolute;
    inset: 0;
    z-index: 20;
    background: rgba(13, 14, 18, 0.82);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: clamp(14px, 4vh, 28px);
    padding: 24px;
  }
  h1 {
    margin: 0;
    font-size: clamp(28px, 7vh, 48px);
    font-weight: 400;
    color: var(--sun);
    text-shadow: 5px 5px 0 #000;
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(360px, 90vw);
  }
  .foot {
    margin: 0;
    font-size: 12px;
    color: var(--muted);
  }
  @media (max-height: 500px) {
    nav {
      display: grid;
      grid-template-columns: 1fr 1fr;
      width: min(560px, 90vw);
    }
    nav .btn {
      font-size: 11px;
      min-height: 44px;
    }
  }
</style>
