<script lang="ts">
  // static markup
</script>

<div class="rotate" role="alert" data-testid="rotate">
  <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true">
    <rect x="22" y="8" width="28" height="48" rx="4" fill="none" stroke="#f3efe6" stroke-width="4"></rect>
    <rect x="31" y="48" width="10" height="3" fill="#f3efe6"></rect>
    <path d="M10 44 A26 26 0 0 0 30 66" fill="none" stroke="#F6B40E" stroke-width="4"></path>
    <path d="M24 60 L32 67 L24 72" fill="none" stroke="#F6B40E" stroke-width="4"></path>
  </svg>
  <p class="pixel">GIRÁ EL CELULAR</p>
  <p class="sub">Calles de Rosario se juega con el teléfono acostado.</p>
</div>

<style>
  .rotate {
    display: none;
  }
  @media (orientation: portrait) and (pointer: coarse) {
    .rotate {
      position: fixed;
      inset: 0;
      z-index: 100;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 18px;
      padding: 24px;
      background: var(--ink);
      text-align: center;
    }
  }
  .pixel {
    margin: 0;
    font-size: 16px;
    color: var(--sun);
    line-height: 1.6;
  }
  .sub {
    margin: 0;
    font-size: 14px;
    color: var(--muted);
  }
</style>
