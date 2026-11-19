<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { Game, HudSnapshot } from '../game/game.ts';
  import { formatMoney } from '../game/systems/score.ts';
  import { drawMinimap } from '../game/render/renderer.ts';
  import Heart from './icons/Heart.svelte';
  import CopIcon from './icons/CopIcon.svelte';

  let {
    hud,
    game,
    touch,
    minimap = $bindable(),
    onPause,
    onMap,
  }: {
    hud: HudSnapshot;
    game: Game;
    touch: boolean;
    minimap: HTMLCanvasElement | null;
    onPause: () => void;
    onMap: () => void;
  } = $props();

  let timer = 0;
  onMount(() => {
    timer = window.setInterval(() => {
      if (minimap) drawMinimap(minimap, game);
    }, 200);
  });
  onDestroy(() => clearInterval(timer));

  const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
</script>

<div class="hud" class:touch data-testid="hud">
  <div class="score">
    <div class="money pixel" data-testid="money">{formatMoney(hud.money)}</div>
    <div class="row">
      <span class="mult pixel" aria-label="Multiplicador">x{hud.multiplier}</span>
      {#if touch}
        <span class="lives-text pixel">VIDAS {hud.lives}</span>
      {:else}
        <span class="lives" aria-label="{hud.lives} vidas">
          {#each Array(hud.lives) as _, i (i)}<Heart />{/each}
        </span>
      {/if}
    </div>
    {#if hud.health < 100}
      <div
        class="health"
        role="meter"
        aria-label="Salud"
        aria-valuenow={hud.health}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style="width: {Math.max(0, Math.min(100, hud.health))}%"></span>
      </div>
    {/if}
    {#if touch}
      <canvas class="minimap small" bind:this={minimap} aria-label="Minimapa"></canvas>
    {/if}
  </div>

  {#if hud.pager}
    <div class="pager" role="status" aria-live="polite" data-testid="pager">
      <div class="msg">
        <div class="from pixel">{touch ? hud.pager.from : `MENSAJE · ${hud.pager.from}`}</div>
        <div class="text">{hud.pager.text}</div>
      </div>
      {#if hud.timer !== null}
        <div class="time">
          <div class="pixel clock">{clock(hud.timer)}</div>
          {#if !touch}<div class="label">TIEMPO</div>{/if}
        </div>
      {/if}
    </div>
  {/if}

  <div class="wanted-box">
    <div class="wanted-col">
      {#if !touch}<div class="pixel wanted-label">BUSCADO</div>{/if}
      <div
        class="wanted"
        role="img"
        aria-label="Nivel de búsqueda {hud.wanted} de 4"
        data-testid="wanted"
        data-level={hud.wanted}
      >
        {#each [1, 2, 3, 4] as n (n)}<CopIcon on={hud.wanted >= n} size={touch ? 18 : 30} />{/each}
      </div>
    </div>
    <div class="buttons">
      {#if touch}
        <button class="icon-btn" aria-label="Mapa" onclick={onMap}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            aria-hidden="true"
          >
            <path d="M1 4 L7 1 L13 4 L19 1 L19 16 L13 19 L7 16 L1 19 Z"></path><path d="M7 1 V16 M13 4 V19"
            ></path>
          </svg>
        </button>
      {/if}
      <button class="icon-btn" aria-label="Pausa" onclick={onPause}>
        <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true">
          <rect x="1" y="0" width="5" height="18" fill="currentColor"></rect><rect
            x="10"
            y="0"
            width="5"
            height="18"
            fill="currentColor"
          ></rect>
        </svg>
      </button>
    </div>
  </div>

  {#if hud.street || hud.hood}
    <div class="where" data-testid="where">
      {#if hud.street}<div class="street pixel">{hud.street}</div>{/if}
      {#if !touch}<div class="hood">{hud.hood}{hud.inVehicle ? ` · ${hud.speedKmh} km/h` : ''}</div>{/if}
    </div>
  {/if}

  {#if !touch}
    <div class="keys" aria-hidden="true">
      <span><kbd>↑ ↓</kbd>acelerar / frenar</span>
      <span><kbd>← →</kbd>doblar</span>
      <span><kbd>ENTER</kbd>subir / bajar</span>
      <span><kbd>ESPACIO</kbd>disparar</span>
      <span><kbd class="hot">M</kbd>mapa</span>
    </div>
    <div class="minimap-box">
      <canvas class="minimap" bind:this={minimap} aria-label="Minimapa"></canvas>
      <div class="north pixel">N</div>
    </div>
  {/if}
  <div class="osm">© OpenStreetMap</div>
</div>

<style>
  .hud {
    position: absolute;
    inset: 0;
    pointer-events: none;
    font-family: var(--mono);
    --gutter: max(20px, env(safe-area-inset-left));
  }
  .hud button {
    pointer-events: auto;
  }
  .score {
    position: absolute;
    left: var(--gutter);
    top: 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .money {
    font-size: clamp(18px, 3.4vh, 30px);
    color: var(--sun);
    text-shadow: 3px 3px 0 #000;
  }
  .row {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .mult {
    font-size: 14px;
    padding: 7px 9px;
    background: var(--sky);
    color: var(--ink);
    box-shadow: 2px 2px 0 #000;
  }
  .lives {
    display: flex;
    gap: 6px;
  }
  .lives-text {
    font-size: 10px;
    color: #fff;
    text-shadow: 2px 2px 0 #000;
  }
  .health {
    width: 120px;
    height: 8px;
    background: rgba(0, 0, 0, 0.6);
    border: 1px solid #000;
  }
  .health span {
    display: block;
    height: 100%;
    background: #e5484d;
  }
  .pager {
    position: absolute;
    left: 50%;
    top: 20px;
    transform: translateX(-50%);
    width: min(520px, 44vw);
    padding: 14px 18px;
    background: var(--ink-2);
    border: 3px solid var(--sky);
    box-shadow: 4px 4px 0 #000;
    display: flex;
    gap: 18px;
    align-items: center;
  }
  .msg {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .from {
    font-size: 10px;
    letter-spacing: 1px;
    color: var(--sky);
  }
  .text {
    font-size: 15px;
    line-height: 1.4;
    color: #e9f2fa;
  }
  .time {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .clock {
    font-size: 22px;
    color: var(--sun);
  }
  .label {
    font-size: 11px;
    letter-spacing: 1px;
    color: #a9bccb;
  }
  .wanted-box {
    position: absolute;
    right: max(28px, env(safe-area-inset-right));
    top: 24px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
  }
  .wanted-col {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
  }
  .wanted-label {
    font-size: 11px;
    color: #fff;
    text-shadow: 2px 2px 0 #000;
  }
  .wanted {
    display: flex;
    gap: 6px;
  }
  .buttons {
    display: flex;
    gap: 8px;
  }
  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    background: rgba(13, 14, 18, 0.85);
    border: 2px solid rgba(255, 255, 255, 0.35);
    color: var(--paper);
    cursor: pointer;
  }
  .where {
    position: absolute;
    left: var(--gutter);
    bottom: 28px;
    padding: 12px 16px;
    background: var(--panel);
    border: 2px solid rgba(255, 255, 255, 0.18);
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 30vw;
  }
  .street {
    font-size: 14px;
    color: #fff;
    line-height: 1.4;
  }
  .hood {
    font-size: 13px;
    color: var(--muted);
  }
  .keys {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    bottom: 28px;
    width: min(620px, 46vw);
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
  }
  .keys span {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: rgba(13, 14, 18, 0.85);
    font-size: 12px;
    color: var(--paper-2);
  }
  kbd {
    font-family: var(--pixel);
    font-size: 9px;
    padding: 4px 6px;
    background: var(--paper);
    color: var(--ink);
  }
  kbd.hot {
    background: var(--sun);
  }
  .minimap-box {
    position: absolute;
    right: max(28px, env(safe-area-inset-right));
    bottom: 28px;
    width: 210px;
    height: 210px;
    border: 3px solid var(--paper);
    box-shadow: 4px 4px 0 #000;
    overflow: hidden;
    background: #2a2c33;
  }
  .minimap {
    width: 100%;
    height: 100%;
    display: block;
    image-rendering: pixelated;
  }
  .north {
    position: absolute;
    left: 8px;
    top: 8px;
    padding: 4px 5px;
    background: var(--ink);
    font-size: 9px;
    color: #fff;
  }
  .osm {
    position: absolute;
    right: max(8px, env(safe-area-inset-right));
    bottom: 4px;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.75);
    text-shadow: 1px 1px 0 #000;
  }
  .minimap-box ~ .osm {
    bottom: 6px;
    right: 250px;
  }

  /* phone landscape (design: GameMobile 844×390) */
  .touch .score {
    top: 14px;
    gap: 8px;
  }
  .touch .money {
    font-size: 16px;
    text-shadow: 2px 2px 0 #000;
  }
  .touch .mult {
    font-size: 10px;
    padding: 5px 6px;
  }
  .touch .pager {
    top: 12px;
    width: min(400px, 46vw);
    padding: 8px 12px;
    border-width: 2px;
    box-shadow: 3px 3px 0 #000;
    gap: 12px;
  }
  .touch .msg {
    gap: 4px;
  }
  .touch .from {
    font-size: 8px;
  }
  .touch .text {
    font-size: 12px;
    line-height: 1.35;
  }
  .touch .clock {
    font-size: 14px;
  }
  .touch .wanted-box {
    top: 12px;
    right: max(16px, env(safe-area-inset-right));
    flex-direction: row;
    align-items: flex-start;
    gap: 8px;
  }
  .touch .wanted {
    gap: 4px;
    padding-top: 4px;
  }
  .touch .where {
    left: 50%;
    bottom: 14px;
    transform: translateX(-50%);
    padding: 6px 10px;
    border: 0;
    max-width: 36vw;
  }
  .touch .street {
    font-size: 9px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .minimap.small {
    width: 88px;
    height: 88px;
    border: 2px solid var(--paper);
    box-shadow: 3px 3px 0 #000;
  }
  .touch .osm {
    left: 50%;
    right: auto;
    transform: translateX(-50%);
    bottom: 2px;
    font-size: 8px;
  }
</style>
