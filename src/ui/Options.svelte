<script lang="ts">
  import { onMount } from 'svelte';
  import { clearSave, loadSave } from '../game/systems/save.ts';
  import { formatMoney } from '../game/systems/score.ts';
  import { MISSIONS } from '../game/systems/missions.ts';
  import Attribution from './Attribution.svelte';

  let { onBack }: { onBack: () => void } = $props();
  let save = $state(loadSave());
  let confirming = $state(false);
  let back: HTMLButtonElement;

  onMount(() => {
    back?.focus();
    const onKey = (e: KeyboardEvent) => e.code === 'Escape' && onBack();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function reset() {
    if (!confirming) {
      confirming = true;
      return;
    }
    clearSave();
    save = loadSave();
    confirming = false;
  }
</script>

<section class="panel" aria-labelledby="options-title">
  <h1 id="options-title" class="pixel">OPCIONES</h1>

  <div class="card">
    <h2 class="pixel">PROGRESO</h2>
    <p>Se guarda en este dispositivo.</p>
    <dl>
      <dt>Plata</dt>
      <dd>{formatMoney(save.score.money)}</dd>
      <dt>Multiplicador</dt>
      <dd>x{save.score.multiplier}</dd>
      <dt>Vidas</dt>
      <dd>{save.score.lives}</dd>
      <dt>Trabajos</dt>
      <dd>{save.completed.length} de {MISSIONS.length}</dd>
      <dt>Zonas abiertas</dt>
      <dd>Fase {save.unlocked}</dd>
    </dl>
    <button class="btn danger" onclick={reset}>
      {confirming ? '¿SEGURO? TOCÁ DE NUEVO' : 'BORRAR PROGRESO'}
    </button>
  </div>

  <div class="card">
    <h2 class="pixel">CRÉDITOS</h2>
    <p>Calles de Rosario es un juego original hecho por nepoteidea. Arte, nombres y personajes inventados.</p>
    <p>
      <Attribution /> — el mapa del juego es una base de datos derivada y se comparte bajo la misma licencia ODbL.
    </p>
  </div>

  <button class="btn primary" bind:this={back} onclick={onBack}>VOLVER</button>
</section>

<style>
  .panel {
    position: absolute;
    inset: 0;
    background: var(--ink);
    padding: clamp(16px, 5vh, 48px) max(clamp(16px, 6vw, 96px), env(safe-area-inset-left));
    display: flex;
    flex-direction: column;
    gap: clamp(12px, 3vh, 24px);
    overflow: auto;
  }
  h1 {
    margin: 0;
    font-size: clamp(20px, 5vh, 32px);
    font-weight: 400;
    color: var(--sun);
    text-shadow: 4px 4px 0 #000;
  }
  h2 {
    margin: 0;
    font-size: 11px;
    font-weight: 400;
    color: var(--sky);
  }
  .card {
    max-width: 620px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 18px;
    border: 2px solid rgba(255, 255, 255, 0.22);
    background: rgba(13, 14, 18, 0.9);
  }
  p {
    margin: 0;
    font-size: 14px;
    line-height: 1.5;
    color: var(--paper-2);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 16px;
    margin: 0;
    font-size: 14px;
  }
  dt {
    color: var(--muted-2);
  }
  dd {
    margin: 0;
  }
  .danger {
    align-self: flex-start;
    font-size: 11px;
    border-color: var(--alarm);
    color: var(--alarm);
  }
  .btn.primary {
    align-self: flex-start;
    justify-content: center;
    min-width: 200px;
    font-size: 14px;
  }
</style>
