// Glue between the browser and the simulation: loads the map, runs the
// fixed-timestep loop, forwards keyboard input, exposes a test hook.

import type { MapMeta } from './map/format.ts';
import { World, fetchChunkOverHttp } from './world/world.ts';
import { Game, TICK, type GameEvent } from './game.ts';
import { Renderer } from './render/renderer.ts';
import { loadSave } from './systems/save.ts';
import { Wanted } from './systems/wanted.ts';

export const MAP_BASE = '/map';

let metaPromise: Promise<MapMeta> | null = null;
export function loadMeta(): Promise<MapMeta> {
  metaPromise ??= fetch(`${MAP_BASE}/meta.json`).then((r) => {
    if (!r.ok) throw new Error(`meta.json: HTTP ${r.status}`);
    return r.json() as Promise<MapMeta>;
  });
  return metaPromise;
}

export class GameHost {
  readonly game: Game;
  readonly renderer: Renderer;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;
  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.metaKey || (e.ctrlKey && e.code !== 'ControlLeft')) return;
    if (this.game.input.keyDown(e.code)) e.preventDefault();
  };
  private readonly onKeyUp = (e: KeyboardEvent) => {
    if (this.game.input.keyUp(e.code)) e.preventDefault();
  };
  private readonly onBlur = () => this.game.input.releaseAll();

  constructor(canvas: HTMLCanvasElement, meta: MapMeta, onEvent: (e: GameEvent) => void) {
    const world = new World(meta, fetchChunkOverHttp(MAP_BASE, meta.version));
    const small = Math.min(window.innerWidth, window.innerHeight) < 500;
    this.game = new Game(world, loadSave(), onEvent, small ? { traffic: 12, peds: 20 } : {});
    this.renderer = new Renderer(canvas);
    this.renderer.resize();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('resize', this.onResize);
    if (new URLSearchParams(location.search).has('test')) this.exposeTestHook();
  }

  private readonly onResize = () => this.renderer.resize();

  async start() {
    await this.game.begin();
    this.resume();
  }

  resume() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    if (this.game.state === 'paused') this.game.state = 'playing';
    this.raf = requestAnimationFrame(this.frame);
  }

  pause() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.game.input.releaseAll();
    if (this.game.state === 'playing') this.game.state = 'paused';
  }

  private readonly frame = (now: number) => {
    if (!this.running) return;
    this.acc += Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    let steps = 0;
    while (this.acc >= TICK && steps < 6) {
      this.game.tick(TICK);
      this.acc -= TICK;
      steps++;
    }
    if (steps === 6) this.acc = 0;
    this.renderer.draw(this.game, this.acc / TICK);
    this.raf = requestAnimationFrame(this.frame);
  };

  destroy() {
    this.pause();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('resize', this.onResize);
  }

  /** window.__cdr — only with ?test in the URL. Used by the Playwright suite. */
  private exposeTestHook() {
    const g = this.game;
    (window as unknown as Record<string, unknown>).__cdr = {
      state: () => {
        const f = g.focus();
        return {
          state: g.state,
          x: f.x,
          y: f.y,
          speed: Math.hypot(f.vx, f.vy),
          inVehicle: !!g.player.vehicle,
          wanted: g.wanted.level,
          money: g.score.money,
          lives: g.score.lives,
          mission: g.missions.mission?.id ?? null,
          vehicles: g.vehicles.length,
          peds: g.peds.length,
        };
      },
      /** Puts the player in a fresh car on the nearest road, pointing along it. */
      giveCar: () => g.giveCar(),
      setWanted: (n: number) => {
        g.wanted.heat = n;
      },
      teleport: (place: string) => {
        const p = g.places[place];
        if (p && !g.player.vehicle) Object.assign(g.player, { x: p.x, y: p.y, px: p.x, py: p.y });
      },
      spawnCop: () => g.spawnCopNear(),
      copsFor: Wanted.copsFor,
    };
  }
}
