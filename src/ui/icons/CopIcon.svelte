<script lang="ts">
  let { on, size = 30 }: { on: boolean; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 15 15" aria-hidden="true" shape-rendering="crispEdges" class:on>
  {#if on}
    <rect x="1" y="11" width="13" height="3" fill="#d8d8d8" stroke="#000" stroke-width="0.5"></rect>
    <rect class="red" x="3" y="4" width="4" height="7" fill="#e23b3b"></rect>
    <rect class="blue" x="8" y="4" width="4" height="7" fill="#3b6fe2"></rect>
    <rect x="3" y="4" width="9" height="7" fill="none" stroke="#000" stroke-width="0.5"></rect>
    <rect x="7" y="0" width="1" height="3" fill="#fff"></rect>
  {:else}
    <rect x="1" y="11" width="13" height="3" fill="#55565c" stroke="#000" stroke-width="0.5"></rect>
    <rect x="3" y="4" width="9" height="7" fill="#55565c" stroke="#000" stroke-width="0.5"></rect>
  {/if}
</svg>

<style>
  .on .red {
    animation: flash 0.5s steps(2) infinite;
  }
  .on .blue {
    animation: flash 0.5s steps(2) infinite reverse;
  }
  @keyframes flash {
    50% {
      opacity: 0.45;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .on .red,
    .on .blue {
      animation: none;
    }
  }
</style>
