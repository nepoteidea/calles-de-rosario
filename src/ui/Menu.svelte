<script lang="ts">
  import { onMount } from 'svelte';
  import Attribution from './Attribution.svelte';

  let {
    onPlay,
    onMap,
    onControls,
    onOptions,
  }: {
    onPlay: () => void;
    onMap: () => void;
    onControls: () => void;
    onOptions: () => void;
  } = $props();

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' && document.activeElement === document.body) {
        e.preventDefault();
        onPlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<main class="menu">
  <div class="backdrop" aria-hidden="true"></div>
  <div class="content">
    <p class="kicker pixel">CALLES DE</p>
    <h1 class="pixel">ROSARIO</h1>
    <div class="flag" aria-hidden="true"><span></span><span></span><span></span></div>
    <p class="tagline">Manejá, escapá de la policía y hacete un nombre en la ciudad.</p>

    <nav aria-label="Menú principal">
      <button class="btn primary" onclick={onPlay}>
        <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true">
          <path d="M0 0 L16 9 L0 18 Z" fill="currentColor"></path>
        </svg>
        JUGAR
      </button>
      <button class="btn indent" onclick={onMap}>MAPA DE LA CIUDAD</button>
      <button class="btn indent" onclick={onControls}>CONTROLES</button>
      <button class="btn indent" onclick={onOptions}>OPCIONES</button>
    </nav>
  </div>

  <div class="press">
    <div class="pixel">PRESIONÁ ENTER</div>
    <div>o tocá JUGAR</div>
  </div>

  <footer>
    <Attribution />
    <span>v0.1 · prototipo</span>
  </footer>
</main>

<style>
  .menu {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: var(--ink);
  }
  .backdrop {
    position: absolute;
    inset: -40px;
    background-color: #a29d92;
    background-image:
      linear-gradient(90deg, transparent 132px, #3b3c43 132px),
      linear-gradient(180deg, transparent 132px, #3b3c43 132px);
    background-size: 172px 172px;
    filter: saturate(0.9);
    animation: drift 60s linear infinite;
  }
  .backdrop::after {
    content: '';
    position: absolute;
    inset: 0;
    background: rgba(13, 14, 18, 0.78);
  }
  @keyframes drift {
    to {
      transform: translate(-172px, -172px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .backdrop {
      animation: none;
    }
  }
  .content {
    position: relative;
    max-width: 640px;
    padding: clamp(24px, 13vh, 104px) clamp(20px, 7.5vw, 96px) 0;
    display: flex;
    flex-direction: column;
    gap: clamp(10px, 2.5vh, 18px);
  }
  .kicker {
    margin: 0;
    font-size: clamp(14px, 3vh, 22px);
    letter-spacing: 4px;
    color: var(--sky);
    text-shadow: 3px 3px 0 #000;
  }
  h1 {
    margin: 0;
    font-size: clamp(40px, 12vh, 92px);
    line-height: 1;
    font-weight: 400;
    color: var(--sun);
    text-shadow: 6px 6px 0 #000;
  }
  .flag {
    display: flex;
    width: min(320px, 60vw);
    height: 10px;
    box-shadow: 3px 3px 0 #000;
  }
  .flag span {
    flex: 1;
    background: var(--sky);
  }
  .flag span:nth-child(2) {
    background: #fff;
  }
  .tagline {
    margin: 6px 0 0;
    font-size: clamp(14px, 2.5vh, 18px);
    line-height: 1.5;
    color: var(--paper-2);
    max-width: 520px;
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: clamp(8px, 1.6vh, 12px);
    width: min(400px, 100%);
    margin-top: clamp(8px, 3vh, 22px);
  }
  nav .btn {
    min-height: clamp(44px, 7vh, 56px);
  }
  .indent {
    padding-left: 52px;
  }
  .press {
    position: absolute;
    right: clamp(20px, 7.5vw, 96px);
    bottom: clamp(56px, 14vh, 104px);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 10px;
    font-size: 14px;
    color: var(--muted);
  }
  .press .pixel {
    font-size: 13px;
    color: var(--sky);
    text-shadow: 2px 2px 0 #000;
    animation: blink 1.2s steps(2) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0.35;
    }
  }
  footer {
    position: absolute;
    left: clamp(20px, 7.5vw, 96px);
    right: clamp(20px, 7.5vw, 96px);
    bottom: max(16px, env(safe-area-inset-bottom));
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    font-size: 13px;
    color: #bdb8ac;
  }
  @media (max-height: 500px) {
    .content {
      padding-top: 16px;
      max-width: 560px;
    }
    .tagline {
      display: none;
    }
    nav {
      flex-direction: row;
      flex-wrap: wrap;
      width: 100%;
    }
    nav .btn {
      flex: 1 1 40%;
      font-size: 11px;
    }
    nav .btn.primary {
      flex-basis: 100%;
      font-size: 16px;
    }
    .indent {
      padding-left: 20px;
    }
    .press {
      display: none;
    }
  }
</style>
