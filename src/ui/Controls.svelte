<script lang="ts">
  import { onMount } from 'svelte';
  let { onBack }: { onBack: () => void } = $props();
  let back: HTMLButtonElement;
  onMount(() => {
    back?.focus();
    const onKey = (e: KeyboardEvent) => e.code === 'Escape' && onBack();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<section class="panel" aria-labelledby="controls-title">
  <h1 id="controls-title" class="pixel">CONTROLES</h1>
  <div class="cols">
    <div>
      <h2 class="pixel">TECLADO</h2>
      <dl>
        <dt><kbd>↑</kbd> <kbd>W</kbd></dt>
        <dd>Acelerar / caminar</dd>
        <dt><kbd>↓</kbd> <kbd>S</kbd></dt>
        <dd>Frenar / marcha atrás</dd>
        <dt><kbd>←</kbd> <kbd>→</kbd></dt>
        <dd>Doblar</dd>
        <dt><kbd>SHIFT</kbd></dt>
        <dd>Freno de mano</dd>
        <dt><kbd>ENTER</kbd> <kbd>E</kbd></dt>
        <dd>Subir / bajar del auto</dd>
        <dt><kbd>ESPACIO</kbd></dt>
        <dd>Disparar</dd>
        <dt><kbd>M</kbd></dt>
        <dd>Mapa</dd>
        <dt><kbd>ESC</kbd> <kbd>P</kbd></dt>
        <dd>Pausa</dd>
      </dl>
    </div>
    <div>
      <h2 class="pixel">CELULAR</h2>
      <dl>
        <dt>Palanca</dt>
        <dd>Hacia dónde ir (auto o a pie)</dd>
        <dt class="sun">GAS</dt>
        <dd>Acelerar</dd>
        <dt>FRENO</dt>
        <dd>Frenar / marcha atrás</dd>
        <dt class="sky">ACCIÓN</dt>
        <dd>Subir / bajar del auto</dd>
        <dt class="red">TIRO</dt>
        <dd>Disparar</dd>
      </dl>
      <h2 class="pixel">JOYSTICK</h2>
      <dl>
        <dt>Palanca</dt>
        <dd>Dirección</dd>
        <dt>RT / A</dt>
        <dd>Acelerar · LT frenar</dd>
        <dt>Y / B</dt>
        <dd>Subir / bajar · X disparar</dd>
      </dl>
    </div>
    <div>
      <h2 class="pixel">CÓMO SE JUEGA</h2>
      <ul>
        <li>Atendé los <b class="sun">teléfonos</b> que suenan para conseguir trabajos.</li>
        <li>Cada trabajo hecho sube el <b class="sky">multiplicador</b>.</li>
        <li>Si te persigue la policía, escondete o pasá por el <b class="sky">taller</b> ($500).</li>
        <li>Si te agarran perdés la mitad de la plata y una vida.</li>
        <li>Terminá los 3 trabajos del centro para abrir más barrios.</li>
      </ul>
    </div>
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
    font-size: 11px;
    font-weight: 400;
    color: var(--sky);
    margin: 0 0 12px;
  }
  h2 + dl + h2,
  dl + h2 {
    margin-top: 18px;
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: clamp(16px, 4vw, 48px);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px 14px;
    margin: 0;
    font-size: 14px;
  }
  dt {
    font-family: var(--pixel);
    font-size: 9px;
    align-self: center;
  }
  dd {
    margin: 0;
    color: var(--paper-2);
  }
  ul {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 14px;
    color: var(--paper-2);
  }
  kbd {
    font-family: var(--pixel);
    font-size: 9px;
    padding: 4px 6px;
    background: var(--paper);
    color: var(--ink);
  }
  .sun {
    color: var(--sun);
  }
  .sky {
    color: var(--sky);
  }
  .red {
    color: var(--fire);
  }
  .btn.primary {
    align-self: flex-start;
    justify-content: center;
    min-width: 200px;
    font-size: 14px;
  }
</style>
