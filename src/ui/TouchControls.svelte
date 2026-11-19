<script lang="ts">
  import type { Input } from '../game/input/input.ts';
  import { vibrate } from './device.ts';

  let { input }: { input: Input } = $props();

  const RADIUS = 46;
  let stickId: number | null = null;
  let center = { x: 0, y: 0 };
  let knob = $state({ x: 0, y: 0 });
  let base: HTMLDivElement;

  function stickDown(e: PointerEvent) {
    e.preventDefault();
    stickId = e.pointerId;
    base.setPointerCapture(e.pointerId);
    const r = base.getBoundingClientRect();
    center = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    stickMove(e);
  }

  function stickMove(e: PointerEvent) {
    if (e.pointerId !== stickId) return;
    let dx = e.clientX - center.x;
    let dy = e.clientY - center.y;
    const d = Math.hypot(dx, dy);
    if (d > RADIUS) {
      dx = (dx / d) * RADIUS;
      dy = (dy / d) * RADIUS;
    }
    knob = { x: dx, y: dy };
    input.touch.stick = { x: dx / RADIUS, y: dy / RADIUS };
  }

  function stickUp(e: PointerEvent) {
    if (e.pointerId !== stickId) return;
    stickId = null;
    knob = { x: 0, y: 0 };
    input.touch.stick = null;
  }

  type Key = 'gas' | 'brake' | 'fire' | 'action';
  let pressed = $state<Record<Key, boolean>>({ gas: false, brake: false, fire: false, action: false });

  function press(key: Key, on: boolean) {
    return (e: PointerEvent) => {
      e.preventDefault();
      if (on) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      if (on && !pressed[key]) vibrate(10);
      pressed[key] = on;
      input.touch[key] = on;
    };
  }
</script>

<div class="touch-controls" data-testid="touch-controls">
  <div
    class="stick"
    bind:this={base}
    onpointerdown={stickDown}
    onpointermove={stickMove}
    onpointerup={stickUp}
    onpointercancel={stickUp}
    role="presentation"
  >
    <div class="knob" style="transform: translate({knob.x}px, {knob.y}px)"></div>
  </div>

  <div class="pad">
    {#each [{ key: 'gas', label: 'GAS' }, { key: 'brake', label: 'FRENO' }, { key: 'action', label: 'ACCIÓN' }, { key: 'fire', label: 'TIRO' }] as b (b.key)}
      <button
        type="button"
        class="b-{b.key}"
        class:down={pressed[b.key as Key]}
        onpointerdown={press(b.key as Key, true)}
        onpointerup={press(b.key as Key, false)}
        onpointercancel={press(b.key as Key, false)}
        oncontextmenu={(e) => e.preventDefault()}
      >
        {b.label}
      </button>
    {/each}
  </div>
</div>

<style>
  .touch-controls {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 5;
  }
  .stick {
    position: absolute;
    left: max(32px, env(safe-area-inset-left));
    bottom: 26px;
    width: 128px;
    height: 128px;
    border-radius: 50%;
    border: 3px solid rgba(255, 255, 255, 0.4);
    background: rgba(13, 14, 18, 0.45);
    pointer-events: auto;
    touch-action: none;
  }
  .knob {
    position: absolute;
    left: 33px;
    top: 33px;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: rgba(243, 239, 230, 0.88);
    box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.5);
  }
  .pad {
    position: absolute;
    right: max(22px, env(safe-area-inset-right));
    bottom: 18px;
    width: 230px;
    height: 190px;
  }
  .pad button {
    position: absolute;
    border-radius: 50%;
    border: 0;
    font-family: var(--pixel);
    cursor: pointer;
    pointer-events: auto;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .pad button.down {
    transform: translate(2px, 2px);
    box-shadow: 1px 1px 0 #000;
    filter: brightness(1.15);
  }
  .b-gas {
    right: 0;
    bottom: 26px;
    width: 88px;
    height: 88px;
    background: var(--sun);
    color: var(--ink);
    font-size: 12px;
    box-shadow: 4px 4px 0 #000;
  }
  .b-brake {
    right: 100px;
    bottom: 0;
    width: 66px;
    height: 66px;
    border: 3px solid rgba(255, 255, 255, 0.55) !important;
    background: rgba(13, 14, 18, 0.7);
    color: #fff;
    font-size: 8px;
  }
  .b-action {
    right: 104px;
    bottom: 82px;
    width: 58px;
    height: 58px;
    background: var(--sky);
    color: var(--ink);
    font-size: 7px;
    box-shadow: 3px 3px 0 #000;
  }
  .b-fire {
    right: 22px;
    bottom: 126px;
    width: 58px;
    height: 58px;
    background: var(--fire);
    color: #fff;
    font-size: 8px;
    box-shadow: 3px 3px 0 #000;
  }
</style>
