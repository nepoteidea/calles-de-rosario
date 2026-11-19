<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { GameHost, loadMeta } from '../game/host.ts';
  import type { GameEvent, HudSnapshot } from '../game/game.ts';
  import type { MapMeta } from '../game/map/format.ts';
  import Hud from './Hud.svelte';
  import TouchControls from './TouchControls.svelte';
  import CityMap from './CityMap.svelte';
  import Caught from './Caught.svelte';
  import Pause from './Pause.svelte';
  import Controls from './Controls.svelte';
  import { isTouchDevice, vibrate } from './device.ts';

  let { onMenu }: { onMenu: () => void } = $props();

  type Overlay = 'none' | 'map' | 'pause' | 'controls' | 'caught';
  let canvas: HTMLCanvasElement;
  let host = $state<GameHost | null>(null);
  let meta = $state<MapMeta | null>(null);
  let hud = $state<HudSnapshot | null>(null);
  let overlay = $state<Overlay>('none');
  let caught = $state<GameEvent | null>(null);
  let error = $state('');
  let touch = $state(isTouchDevice());
  let timer = 0;
  let minimap = $state<HTMLCanvasElement | null>(null);

  function onEvent(e: GameEvent) {
    if (e.type === 'map') openOverlay('map');
    else if (e.type === 'pause') openOverlay('pause');
    else {
      caught = e;
      vibrate(300);
      openOverlay('caught');
    }
  }

  function openOverlay(o: Overlay) {
    overlay = o;
    if (o !== 'caught') host?.pause();
    else host?.game.input.releaseAll();
  }

  function closeOverlay() {
    overlay = 'none';
    host?.resume();
  }

  async function retry() {
    if (!host) return;
    overlay = 'none';
    caught = null;
    host.pause();
    await host.game.respawn();
    host.resume();
  }

  function toMenu() {
    host?.game.persist();
    onMenu();
  }

  onMount(() => {
    const onTouch = () => (touch = true);
    window.addEventListener('touchstart', onTouch, { once: true, passive: true });
    const onKey = (e: KeyboardEvent) => {
      if (overlay === 'map' && (e.code === 'KeyM' || e.code === 'Escape')) {
        e.preventDefault();
        closeOverlay();
      } else if (overlay === 'pause' && e.code === 'Escape') {
        e.preventDefault();
        closeOverlay();
      }
    };
    window.addEventListener('keydown', onKey);
    const onHidden = () => {
      if (document.hidden && overlay === 'none') openOverlay('pause');
    };
    document.addEventListener('visibilitychange', onHidden);

    loadMeta()
      .then(async (m) => {
        meta = m;
        host = new GameHost(canvas, m, onEvent);
        await host.start();
        timer = window.setInterval(() => {
          if (!host) return;
          hud = host.game.snapshot();
        }, 100);
      })
      .catch((err) => {
        console.error(err);
        error = 'No se pudo cargar el mapa. Revisá tu conexión y probá de nuevo.';
      });
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHidden);
    };
  });

  onDestroy(() => {
    clearInterval(timer);
    host?.destroy();
  });
</script>

<div class="play" class:touch>
  <canvas bind:this={canvas} class="world" aria-label="Vista de la ciudad desde arriba"></canvas>

  {#if !host?.game || !hud}
    <div class="loading pixel" role="status">{error || 'CARGANDO ROSARIO…'}</div>
  {/if}

  {#if host && hud}
    <Hud
      {hud}
      game={host.game}
      {touch}
      bind:minimap
      onPause={() => openOverlay('pause')}
      onMap={() => openOverlay('map')}
    />
    {#if touch && overlay === 'none'}
      <TouchControls input={host.game.input} />
    {/if}
  {/if}

  {#if overlay === 'map' && meta && host}
    <div class="overlay">
      <CityMap
        unlocked={host.game.save.unlocked}
        player={{
          x: host.game.focus().x,
          y: host.game.focus().y,
          heading: host.game.player.vehicle?.heading ?? host.game.player.heading,
        }}
        where={hud ? [hud.hood, hud.street].filter(Boolean).join(' · ') : ''}
        completed={host.game.save.completed}
        onBack={closeOverlay}
        onMenu={toMenu}
        inGame
      />
    </div>
  {:else if overlay === 'pause'}
    <Pause
      onResume={closeOverlay}
      onMap={() => (overlay = 'map')}
      onControls={() => (overlay = 'controls')}
      onMenu={toMenu}
    />
  {:else if overlay === 'controls'}
    <div class="overlay"><Controls onBack={() => (overlay = 'pause')} /></div>
  {:else if overlay === 'caught' && caught}
    <Caught event={caught} onRetry={retry} onMenu={toMenu} />
  {/if}
</div>

<style>
  .play {
    position: absolute;
    inset: 0;
    background: #3b3c43;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .world {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  .loading {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 24px;
    text-align: center;
    background: var(--ink);
    color: var(--sun);
    font-size: 14px;
    line-height: 1.8;
  }
  .overlay {
    position: absolute;
    inset: 0;
    z-index: 20;
  }
</style>
