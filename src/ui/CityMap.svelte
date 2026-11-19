<script lang="ts">
  import { onMount } from 'svelte';
  import { loadMeta, MAP_BASE } from '../game/host.ts';
  import { loadOverview, paintCityMap } from '../game/render/cityMap.ts';
  import { MISSIONS } from '../game/systems/missions.ts';
  import type { MapMeta } from '../game/map/format.ts';

  let {
    unlocked,
    player,
    where = '',
    completed = [],
    inGame = false,
    onBack,
    onMenu,
    onPlay,
  }: {
    unlocked: number;
    player: { x: number; y: number; heading: number } | null;
    where?: string;
    completed?: string[];
    inGame?: boolean;
    onBack: () => void;
    onMenu?: () => void;
    onPlay?: () => void;
  } = $props();

  let canvas: HTMLCanvasElement;
  let meta = $state<MapMeta | null>(null);
  let error = $state('');
  let zoomed = $state(true);
  let backButton = $state<HTMLButtonElement | null>(null);

  onMount(() => {
    backButton?.focus();
    loadMeta()
      .then(async (m) => {
        meta = m;
        paintCityMap(canvas, m, await loadOverview(MAP_BASE, m), unlocked);
      })
      .catch(() => (error = 'No se pudo cargar el mapa.'));
  });

  // Zoomed view frames phase 1 (or the player); full view shows the whole city.
  const view = $derived.by(() => {
    if (!meta) return { x: 0, y: 0, w: 1, h: 1 };
    const W = meta.overview.cols * meta.overview.cell;
    const H = meta.overview.rows * meta.overview.cell;
    if (!zoomed) return { x: 0, y: 0, w: W, h: H };
    const r = meta.phases.find((p) => p.id === Math.min(unlocked, 2))?.rect ?? meta.phases[0].rect;
    const pad = 900;
    const x0 = Math.max(0, r[0] - pad);
    const y0 = Math.max(0, r[1] - pad);
    return { x: x0, y: y0, w: Math.min(W, r[2] + pad) - x0, h: Math.min(H, r[3] + pad) - y0 };
  });

  const pos = (x: number, y: number) =>
    meta ? `left: ${((x - view.x) / view.w) * 100}%; top: ${((y - view.y) / view.h) * 100}%` : '';

  const canvasStyle = $derived.by(() => {
    if (!meta) return '';
    const W = meta.overview.cols * meta.overview.cell;
    const H = meta.overview.rows * meta.overview.cell;
    return `width: ${(W / view.w) * 100}%; height: ${(H / view.h) * 100}%; left: ${(-view.x / view.w) * 100}%; top: ${(-view.y / view.h) * 100}%`;
  });

  const phaseLabel = (id: number) => (id <= unlocked ? 'ABIERTA' : 'CERRADA');
  const phaseHint = (id: number) =>
    id === 2 ? 'Terminá los 3 trabajos de la Fase 1' : id === 3 ? 'Juntá $ 50.000 con la Fase 2 abierta' : '';

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!inGame && e.code === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<section class="map-screen" aria-labelledby="map-title" data-testid="city-map">
  <div class="frame">
    <div class="viewport" style="aspect-ratio: {view.w} / {view.h}">
      <canvas bind:this={canvas} style={canvasStyle} aria-label="Mapa de Rosario con las zonas desbloqueadas"
      ></canvas>
      {#if meta}
        {#each meta.phases as ph (ph.id)}
          {#if ph.id > 1 && ph.id <= 2}
            <div
              class="zone-label pixel"
              class:locked={ph.id > unlocked}
              style={pos(ph.rect[0] + 400, ph.rect[1] + 300)}
            >
              {#if ph.id > unlocked}<svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true">
                  <rect x="0" y="5" width="10" height="7" fill="currentColor"></rect><path
                    d="M2 5 V3 a3 3 0 0 1 6 0 V5"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                  ></path>
                </svg>{/if}
              FASE {ph.id}
            </div>
          {/if}
        {/each}
        {@const p1 = meta.phases[0].rect}
        <div class="zone-label pixel open" style={pos((p1[0] + p1[2]) / 2 - 600, p1[1] + 200)}>
          CENTRO · PICHINCHA
        </div>
        {#each MISSIONS.filter((m) => !completed.includes(m.id)) as m (m.id)}
          {@const ph = meta.places[m.phone]}
          {#if ph}<div class="dot phone" style={pos(ph.x, ph.y)} title="Teléfono: {ph.label}"></div>{/if}
        {/each}
        {#if meta.places.taller}<div
            class="dot taller"
            style={pos(meta.places.taller.x, meta.places.taller.y)}
            title="Taller"
          ></div>{/if}
        {#if meta.places.start}<div
            class="dot hideout"
            style={pos(meta.places.start.x, meta.places.start.y)}
            title="Guarida"
          ></div>{/if}
        {#if meta.places.monumento}
          <div class="mon" style={pos(meta.places.monumento.x, meta.places.monumento.y)}>
            <span>Monumento</span>
          </div>
        {/if}
        {#if player}
          <svg
            class="me"
            style="{pos(player.x, player.y)}; transform: translate(-50%, -50%) rotate({player.heading +
              Math.PI / 2}rad)"
            width="16"
            height="18"
            viewBox="0 0 16 18"
            role="img"
            aria-label="Tu posición"
          >
            <path d="M8 0 L16 18 L8 13 L0 18 Z" fill="#F6B40E" stroke="#000" stroke-width="1.5"></path>
          </svg>
        {/if}
      {/if}
      <div class="compass" aria-hidden="true">
        <svg width="14" height="16" viewBox="0 0 16 18">
          <path d="M8 0 L16 18 L8 13 L0 18 Z" fill="#f3efe6"></path>
        </svg>
        <span class="pixel">N</span>
      </div>
      <div class="river pixel" aria-hidden="true">RÍO PARANÁ</div>
      {#if error}<div class="err">{error}</div>{/if}
    </div>
  </div>

  <aside>
    <div class="head">
      <h1 id="map-title" class="pixel">MAPA</h1>
      <div class="sub">Rosario, Santa Fe</div>
    </div>

    {#if where}
      <div class="here">
        <div class="pixel k">ESTÁS EN</div>
        <div class="v">{where}</div>
      </div>
    {/if}

    <div class="block">
      <div class="pixel k2">ZONAS</div>
      {#each meta?.phases ?? [] as ph (ph.id)}
        <div class="zone" class:dim={ph.id > unlocked}>
          <span>
            Fase {ph.id} · {ph.name}{#if ph.id > unlocked}<small>{phaseHint(ph.id)}</small>{/if}
          </span>
          <span class="tag pixel" class:open={ph.id <= unlocked}>{phaseLabel(ph.id)}</span>
        </div>
      {/each}
    </div>

    <div class="block">
      <div class="pixel k2">REFERENCIAS</div>
      <div class="legend">
        <span><i class="sq phone"></i>Teléfono</span>
        <span><i class="sq taller"></i>Taller</span>
        <span><i class="sq hideout"></i>Guarida</span>
        <span>
          <svg width="12" height="14" viewBox="0 0 16 18" aria-hidden="true">
            <path d="M8 0 L16 18 L8 13 L0 18 Z" fill="#F6B40E" stroke="#000" stroke-width="1.5"></path>
          </svg>Vos
        </span>
      </div>
    </div>

    <div class="actions">
      <button class="btn small" onclick={() => (zoomed = !zoomed)}>
        {zoomed ? 'VER TODA LA CIUDAD' : 'ACERCAR AL CENTRO'}
      </button>
      {#if inGame}
        <button class="btn primary center" bind:this={backButton} onclick={onBack}>VOLVER AL JUEGO</button>
        <button class="btn center" onclick={onMenu}>MENÚ</button>
      {:else}
        <button class="btn primary center" onclick={onPlay}>JUGAR</button>
        <button class="btn center" bind:this={backButton} onclick={onBack}>MENÚ</button>
      {/if}
      <div class="credit">
        Datos: © colaboradores de <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener"
        >
          OpenStreetMap
        </a>
      </div>
    </div>
  </aside>
</section>

<style>
  .map-screen {
    position: absolute;
    inset: 0;
    background: var(--ink);
    display: flex;
    gap: clamp(16px, 2.5vw, 32px);
    padding: clamp(12px, 5vh, 40px) max(clamp(12px, 2.5vw, 32px), env(safe-area-inset-right))
      clamp(12px, 5vh, 40px) max(clamp(12px, 2.5vw, 32px), env(safe-area-inset-left));
    overflow: auto;
  }
  .frame {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .viewport {
    position: relative;
    max-width: 100%;
    max-height: 100%;
    height: 100%;
    overflow: hidden;
    border: 3px solid var(--paper);
    box-shadow: 5px 5px 0 #000;
    background: #23252d;
  }
  canvas {
    position: absolute;
    image-rendering: pixelated;
  }
  .zone-label {
    position: absolute;
    transform: translate(-50%, -50%);
    font-size: 9px;
    color: #9a978f;
    white-space: nowrap;
    text-shadow: 2px 2px 0 #000;
  }
  .zone-label.open {
    color: var(--sun);
    font-size: 10px;
  }
  .dot {
    position: absolute;
    width: 12px;
    height: 12px;
    transform: translate(-50%, -50%);
    box-shadow: 0 0 0 2px #000;
  }
  .phone,
  .sq.phone {
    background: var(--sun);
  }
  .taller,
  .sq.taller {
    background: var(--sky);
  }
  .hideout,
  .sq.hideout {
    background: #fff;
  }
  .mon {
    position: absolute;
    width: 14px;
    height: 14px;
    transform: translate(-50%, -50%) rotate(45deg);
    background: #fff;
    border: 3px solid var(--ink);
  }
  .mon span {
    position: absolute;
    top: 14px;
    left: 14px;
    transform: rotate(-45deg);
    padding: 3px 5px;
    background: var(--ink);
    font-size: 10px;
    color: #fff;
  }
  .me {
    position: absolute;
  }
  .compass {
    position: absolute;
    left: 12px;
    top: 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 8px 10px;
    background: var(--ink);
    border: 2px solid rgba(255, 255, 255, 0.3);
    font-size: 10px;
  }
  .river {
    position: absolute;
    right: 18px;
    top: 50%;
    writing-mode: vertical-rl;
    font-size: 10px;
    letter-spacing: 4px;
    color: rgba(255, 255, 255, 0.65);
  }
  .err {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--alarm);
  }
  aside {
    width: clamp(240px, 24vw, 304px);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: clamp(10px, 3vh, 22px);
  }
  h1 {
    margin: 0;
    font-size: 24px;
    font-weight: 400;
    color: var(--sun);
    text-shadow: 3px 3px 0 #000;
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sub {
    font-size: 14px;
    color: var(--muted);
  }
  .here {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 14px;
    background: var(--ink-2);
    border: 2px solid var(--sky);
  }
  .k {
    font-size: 9px;
    color: var(--sky);
  }
  .v {
    font-size: 15px;
    color: #fff;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .k2 {
    font-size: 10px;
  }
  .zone {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    font-size: 13px;
  }
  .zone small {
    display: block;
    font-size: 11px;
    color: #a8a49a;
  }
  .zone.dim {
    color: var(--muted-2);
  }
  .tag {
    padding: 3px 6px;
    border: 1px solid #77746c;
    color: var(--muted-2);
    font-size: 7px;
    flex-shrink: 0;
  }
  .tag.open {
    background: var(--sun);
    color: var(--ink);
    border-color: var(--sun);
  }
  .legend {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    font-size: 13px;
    color: var(--paper-2);
  }
  .legend span {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .sq {
    width: 12px;
    height: 12px;
    box-shadow: 0 0 0 2px #000;
  }
  .actions {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .btn.center {
    justify-content: center;
  }
  .btn.primary.center {
    font-size: 12px;
  }
  .btn.small {
    justify-content: center;
    font-size: 9px;
    min-height: 44px;
  }
  .credit {
    font-size: 11px;
    color: #a8a49a;
  }
  @media (max-height: 500px) {
    .head .sub,
    .block:last-of-type {
      display: none;
    }
    aside {
      gap: 8px;
    }
    .zone small {
      display: none;
    }
    .btn {
      min-height: 44px;
    }
  }
  @media (max-width: 700px) and (orientation: portrait) {
    .map-screen {
      flex-direction: column;
    }
    aside {
      width: 100%;
    }
  }
</style>
