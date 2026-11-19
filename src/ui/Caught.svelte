<script lang="ts">
  import { onMount } from 'svelte';
  import type { GameEvent } from '../game/game.ts';
  import { formatMoney } from '../game/systems/score.ts';

  let { event, onRetry, onMenu }: { event: GameEvent; onRetry: () => void; onMenu: () => void } = $props();
  let retryButton: HTMLButtonElement;

  onMount(() => {
    // don't let a held key or tap immediately skip the screen
    const t = setTimeout(() => retryButton?.focus(), 600);
    return () => clearTimeout(t);
  });
</script>

<div
  class="caught"
  role="alertdialog"
  aria-labelledby="caught-title"
  aria-describedby="caught-desc"
  data-testid="caught"
  data-kind={event.type}
>
  <div class="bar top" aria-hidden="true"><span></span><span></span></div>
  <div class="bar bottom" aria-hidden="true"><span></span><span></span></div>

  <div class="body">
    {#if event.type === 'busted'}
      <h1 id="caught-title" class="pixel">¡TE AGARRARON!</h1>
      <p id="caught-desc">La policía te paró en {event.where || 'la calle'}.</p>
      <div class="cards">
        <div class="card">
          <span class="k pixel">PLATA</span><span class="v pixel sun">{formatMoney(event.money)}</span><span
            class="n"
          >
            Perdiste la mitad
          </span>
        </div>
        <div class="card">
          <span class="k pixel">MULTIPLICADOR</span><span class="v pixel sky">
            x{event.multiplier} → x1
          </span><span class="n">Vuelve a empezar</span>
        </div>
        <div class="card">
          <span class="k pixel">VIDAS</span><span class="v pixel">{event.lives}</span><span class="n">
            Te queda una menos
          </span>
        </div>
      </div>
    {:else if event.type === 'wasted'}
      <h1 id="caught-title" class="pixel">¡TE BAJARON!</h1>
      <p id="caught-desc">Quedaste tirado en {event.where || 'la calle'}.</p>
      <div class="cards">
        <div class="card">
          <span class="k pixel">PLATA</span><span class="v pixel sun">{formatMoney(event.money)}</span><span
            class="n"
          >
            La plata queda
          </span>
        </div>
        <div class="card">
          <span class="k pixel">MULTIPLICADOR</span><span class="v pixel sky">
            x{event.multiplier} → x1
          </span><span class="n">Vuelve a empezar</span>
        </div>
        <div class="card">
          <span class="k pixel">VIDAS</span><span class="v pixel">{event.lives}</span><span class="n">
            Te queda una menos
          </span>
        </div>
      </div>
    {:else if event.type === 'gameover'}
      <h1 id="caught-title" class="pixel">FIN DEL JUEGO</h1>
      <p id="caught-desc">
        Te quedaste sin vidas. Juntaste {formatMoney(event.money)}. Las zonas abiertas siguen abiertas.
      </p>
    {/if}

    <div class="actions">
      <button class="btn primary" bind:this={retryButton} onclick={onRetry}>
        <svg width="14" height="16" viewBox="0 0 16 18" aria-hidden="true">
          <path d="M0 0 L16 9 L0 18 Z" fill="currentColor"></path>
        </svg>
        {event.type === 'gameover' ? 'JUGAR DE NUEVO' : 'REINTENTAR'}
      </button>
      <button class="btn menu" onclick={onMenu}>MENÚ</button>
    </div>
  </div>
</div>

<style>
  .caught {
    position: absolute;
    inset: 0;
    z-index: 30;
    background: rgba(12, 10, 16, 0.76);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
  }
  .bar {
    position: absolute;
    left: 0;
    right: 0;
    height: 12px;
    display: flex;
  }
  .bar span {
    flex: 1;
    background: var(--cop-red);
  }
  .bar span + span {
    background: var(--cop-blue);
  }
  .top {
    top: 0;
  }
  .bottom {
    bottom: 0;
    flex-direction: row-reverse;
  }
  .body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: clamp(12px, 3.5vh, 28px);
    padding: 24px;
    text-align: center;
  }
  h1 {
    margin: 0;
    font-size: clamp(26px, 8vh, 60px);
    font-weight: 400;
    color: var(--alarm);
    text-shadow: 6px 6px 0 #000;
  }
  p {
    margin: 0;
    font-size: clamp(14px, 2.5vh, 18px);
    color: var(--paper-2);
    max-width: 640px;
  }
  .cards {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 16px;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 200px;
    padding: 16px 18px;
    background: rgba(13, 14, 18, 0.9);
    border: 2px solid rgba(255, 255, 255, 0.22);
    text-align: left;
  }
  .k {
    font-size: 9px;
    color: var(--muted-2);
  }
  .v {
    font-size: 16px;
    color: #fff;
  }
  .sun {
    color: var(--sun);
  }
  .sky {
    color: var(--sky);
  }
  .n {
    font-size: 12px;
    color: var(--muted);
  }
  .actions {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    justify-content: center;
  }
  .actions .btn {
    justify-content: center;
    min-width: 200px;
    min-height: 56px;
  }
  .actions .btn.primary {
    min-width: 260px;
    font-size: 15px;
  }
  .btn.menu {
    font-size: 13px;
    border-color: rgba(255, 255, 255, 0.35);
    background: transparent;
  }
  @media (max-height: 500px) {
    .card {
      width: 160px;
      padding: 10px 12px;
      gap: 6px;
    }
    .actions .btn {
      min-height: 48px;
    }
  }
</style>
