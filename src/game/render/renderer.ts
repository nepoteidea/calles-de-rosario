// Draws the world from straight above: the cached ground layer, markers,
// pedestrians, vehicles, bullets and effects, then trees and the buildings,
// which lean away from the centre of the screen. Fixed top-down camera that
// zooms out a little at speed.

import { Tile, tileType, type ChunkData } from '../map/format.ts';
import type { Game } from '../game.ts';
import type { Ped, Vehicle } from '../entities.ts';
import { GROUND_TILE_M, GroundPainter } from './ground.ts';
import {
  BuildingRenderer,
  drawTrees,
  prepareBuildings,
  prepareTrees,
  type BuildingView,
} from './buildings.ts';
import { C, MAP_COLORS } from './palette.ts';

/** Metres of world shown vertically at rest: phones in landscape, then larger screens. */
export const VIEW_HEIGHT_PHONE_M = 42;
export const VIEW_HEIGHT_M = 58;
const MAX_GROUND_TILES = 48;
/** New ground tiles painted per frame at most; the rest wait a frame or two. */
const PAINT_BUDGET = 3;

interface ChunkView {
  buildings: BuildingView[];
  trees: Float32Array;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private ground = new Map<string, HTMLCanvasElement>();
  private visibleTiles = 0;
  /** CSS pixels per metre of the current frame, for labels that keep their size on screen. */
  private framePpm = 1;
  private painter: GroundPainter | null = null;
  private readonly prepared = new WeakMap<ChunkData, ChunkView>();
  private readonly buildings = new BuildingRenderer();
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cssW = this.canvas.clientWidth || window.innerWidth;
    this.cssH = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
  }

  /** CSS pixels per metre at zoom 1: a close camera, closer still on phones. */
  basePpm() {
    const phone = Math.min(this.cssW, this.cssH) <= 520;
    const viewH = phone ? VIEW_HEIGHT_PHONE_M : VIEW_HEIGHT_M;
    // portrait or very narrow windows still show at least 40 m across
    return Math.max(2, Math.min(this.cssH / viewH, this.cssW / 40));
  }

  private groundTile(game: Game, tx: number, ty: number, budget: { left: number }) {
    const key = `${tx}_${ty}`;
    const img = this.ground.get(key);
    if (img) {
      // refresh LRU order
      this.ground.delete(key);
      this.ground.set(key, img);
      return img;
    }
    if (budget.left <= 0) return null;
    const x0 = tx * GROUND_TILE_M;
    const y0 = ty * GROUND_TILE_M;
    const chunk = game.world.getChunk(Math.floor(x0 / game.world.chunkM), Math.floor(y0 / game.world.chunkM));
    if (!chunk) return null;
    budget.left--;
    const tile = this.painter!.paint(chunk, x0, y0);
    this.ground.set(key, tile);
    if (this.ground.size > Math.max(MAX_GROUND_TILES, this.visibleTiles + 16))
      this.ground.delete(this.ground.keys().next().value!);
    return tile;
  }

  private chunkView(game: Game, chunk: ChunkData): ChunkView {
    let v = this.prepared.get(chunk);
    if (!v) {
      v = {
        buildings: prepareBuildings(chunk, game.meta.landmarks ?? []),
        trees: prepareTrees(chunk, (x, y) => game.world.tileAt(x, y), game.world.chunkM),
      };
      this.prepared.set(chunk, v);
    }
    return v;
  }

  draw(game: Game, alpha: number) {
    if (this.canvas.width !== Math.round((this.canvas.clientWidth || window.innerWidth) * this.dpr))
      this.resize();
    const g = this.ctx;
    const ppm = this.basePpm() * game.camera.zoom;
    const camX = lerp(game.camera.px, game.camera.x, alpha);
    const camY = lerp(game.camera.py, game.camera.y, alpha);
    const halfW = this.cssW / 2 / ppm;
    const halfH = this.cssH / 2 / ppm;
    game.view.w = halfW * 2;
    game.view.h = halfH * 2;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = C.ground;
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const s = ppm * this.dpr;
    g.setTransform(s, 0, 0, s, (-camX + halfW) * s, (-camY + halfH) * s);
    g.imageSmoothingEnabled = true;

    // ground layer, cached in small tiles at about the screen's resolution
    const wantPpm = Math.max(8, Math.min(16, Math.round(this.basePpm() * this.dpr)));
    if (!this.painter || this.painter.ppm !== wantPpm) {
      this.painter = new GroundPainter(wantPpm);
      this.ground.clear();
    }
    const x0 = camX - halfW;
    const y0 = camY - halfH;
    const x1 = camX + halfW;
    const y1 = camY + halfH;
    const T = GROUND_TILE_M;
    const budget = { left: PAINT_BUDGET };
    // paint the tiles nearest the centre first
    const todo: [number, number, number][] = [];
    for (let ty = Math.floor(y0 / T); ty <= Math.floor(y1 / T); ty++)
      for (let tx = Math.floor(x0 / T); tx <= Math.floor(x1 / T); tx++)
        todo.push([tx, ty, Math.hypot((tx + 0.5) * T - camX, (ty + 0.5) * T - camY)]);
    todo.sort((a, b) => a[2] - b[2]);
    this.visibleTiles = todo.length;
    this.framePpm = ppm;
    for (const [tx, ty] of todo) {
      const outside = tx < 0 || ty < 0 || tx * T >= game.world.widthM || ty * T >= game.world.heightM;
      const img = outside ? null : this.groundTile(game, tx, ty, budget);
      if (img) g.drawImage(img, tx * T, ty * T, T + 0.04, T + 0.04);
      else {
        g.fillStyle = outside ? C.water : C.ground;
        g.fillRect(tx * T, ty * T, T + 0.04, T + 0.04);
      }
    }

    this.drawMarkers(game);

    for (const f of game.fx) if (f.kind === 'blood') this.blood(f.x, f.y, f.age, f.life);
    for (const p of game.peds) if (!p.alive) this.deadPed(p);
    for (const v of game.vehicles) if (v.destroyed) this.vehicle(v, alpha, game.time);
    for (const p of game.peds) if (p.alive) this.ped(p, alpha);
    if (!game.player.vehicle) this.playerPed(game, alpha);
    for (const v of game.vehicles)
      if (!v.destroyed) this.vehicle(v, alpha, game.time, v === game.player.vehicle);

    this.drawCity(game, camX, camY, ppm, x0, y0, x1, y1);
    this.drawLockedZones(game, x0, y0, x1, y1);

    g.strokeStyle = '#ffe680';
    g.lineWidth = 0.18;
    for (const b of game.bullets) {
      g.beginPath();
      g.moveTo(b.x, b.y);
      g.lineTo(b.x - b.vx * 0.012, b.y - b.vy * 0.012);
      g.stroke();
    }
    for (const f of game.fx) {
      const t = f.age / f.life;
      if (f.kind === 'explosion') {
        g.fillStyle = `rgba(255,${Math.round(180 - t * 140)},40,${1 - t})`;
        g.beginPath();
        g.arc(f.x, f.y, 1.5 + t * 5, 0, Math.PI * 2);
        g.fill();
      } else if (f.kind === 'spark') {
        g.fillStyle = `rgba(255,230,120,${1 - t})`;
        g.fillRect(f.x - 0.3, f.y - 0.3, 0.6, 0.6);
      }
    }
    this.drawObjectiveArrow(game, alpha);
  }

  /** Trees, buildings and landmark labels over everything on the ground. */
  private drawCity(
    game: Game,
    camX: number,
    camY: number,
    ppm: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ) {
    const chunkM = game.world.chunkM;
    const list: BuildingView[] = [];
    const trees: Float32Array[] = [];
    // buildings belong to the chunk holding their centre: look one chunk further out
    for (let cy = Math.floor(y0 / chunkM) - 1; cy <= Math.floor(y1 / chunkM) + 1; cy++) {
      for (let cx = Math.floor(x0 / chunkM) - 1; cx <= Math.floor(x1 / chunkM) + 1; cx++) {
        const chunk = game.world.getChunk(cx, cy);
        if (!chunk) continue;
        const v = this.chunkView(game, chunk);
        for (const b of v.buildings) if (b.x1 > x0 && b.x0 < x1 && b.y1 > y0 && b.y0 < y1) list.push(b);
        trees.push(v.trees);
      }
    }
    const g = this.ctx;
    for (const t of trees) drawTrees(g, t, x0, y0, x1, y1);
    this.buildings.draw(g, list, camX, camY, ppm * this.dpr);
    for (const l of game.meta.landmarks ?? []) {
      if (l.x < x0 - 10 || l.x > x1 + 10 || l.y < y0 - 10 || l.y > y1 + 10) continue;
      this.label(l.x, l.y, l.label.toUpperCase(), '#ffffff', undefined, C.sky);
    }
  }

  private drawLockedZones(game: Game, x0: number, y0: number, x1: number, y1: number) {
    const unlocked = game.save.unlocked;
    const open = game.meta.phases.find((p) => p.id === unlocked);
    if (!open || unlocked >= game.meta.phases.length) return;
    const [rx0, ry0, rx1, ry1] = open.rect;
    const g = this.ctx;
    g.fillStyle = 'rgba(13,14,18,0.55)';
    g.beginPath();
    g.rect(x0 - 10, y0 - 10, x1 - x0 + 20, y1 - y0 + 20);
    g.rect(rx0, ry0, rx1 - rx0, ry1 - ry0);
    g.fill('evenodd');
    g.strokeStyle = C.sun;
    g.lineWidth = 0.6;
    g.setLineDash([3, 2]);
    g.strokeRect(rx0, ry0, rx1 - rx0, ry1 - ry0);
    g.setLineDash([]);
  }

  private drawMarkers(game: Game) {
    const g = this.ctx;
    const pulse = 0.5 + 0.5 * Math.sin(game.time * 6);
    // phone booths with a job waiting
    for (const m of game.availableMissions()) {
      const p = game.places[m.phone];
      if (!game.missions.active) {
        g.strokeStyle = `rgba(246,180,14,${0.4 + pulse * 0.6})`;
        g.lineWidth = 0.5;
        g.beginPath();
        g.arc(p.x, p.y, 3 + pulse * 2, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = C.ink;
      g.fillRect(p.x - 1.1, p.y - 1.1, 2.2, 2.2);
      g.fillStyle = C.sun;
      g.fillRect(p.x - 0.8, p.y - 0.8, 1.6, 1.6);
      g.fillStyle = C.ink;
      g.fillRect(p.x - 0.4, p.y - 0.2, 0.8, 0.4);
    }
    const t = game.places.taller;
    if (t)
      this.label(t.x, t.y - 3, 'TALLER', C.sky, () => {
        g.fillStyle = C.sky;
        g.fillRect(t.x - 1.5, t.y - 1.5, 3, 3);
      });

    const obj = game.missions.active ? game.objective() : null;
    if (obj) {
      g.strokeStyle = C.sun;
      g.lineWidth = 0.5;
      g.setLineDash([1.6, 1.1]);
      g.beginPath();
      g.arc(obj.x, obj.y, 6 + pulse, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }
  }

  private label(x: number, y: number, text: string, color: string, before?: () => void, border?: string) {
    const g = this.ctx;
    before?.();
    // about 9 CSS pixels tall whatever the zoom
    const u = 9 / this.framePpm / 1.4;
    g.font = `${1.4 * u}px "Press Start 2P", monospace`;
    const w = g.measureText(text).width;
    g.fillStyle = 'rgba(13,14,18,0.82)';
    g.fillRect(x - w / 2 - 0.6 * u, y - 1.2 * u, w + 1.2 * u, 2.2 * u);
    if (border) {
      g.strokeStyle = border;
      g.lineWidth = 0.2 * u;
      g.strokeRect(x - w / 2 - 0.6 * u, y - 1.2 * u, w + 1.2 * u, 2.2 * u);
    }
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, x, y);
  }

  private drawObjectiveArrow(game: Game, alpha: number) {
    const obj = game.objective();
    if (!obj) return;
    const p = game.player.vehicle ?? game.player;
    const px = lerp(p.px, p.x, alpha);
    const py = lerp(p.py, p.y, alpha);
    const d = Math.hypot(obj.x - px, obj.y - py);
    if (d < 14) return;
    const a = Math.atan2(obj.y - py, obj.x - px);
    const r = game.player.vehicle ? 5.5 : 3.2;
    const g = this.ctx;
    g.save();
    g.translate(px + Math.cos(a) * r, py + Math.sin(a) * r);
    g.rotate(a);
    g.scale(0.11, 0.11);
    g.fillStyle = C.sun;
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-11, -12);
    g.lineTo(11, 0);
    g.lineTo(-11, 12);
    g.lineTo(-5, 0);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  private blood(x: number, y: number, age: number, life: number) {
    const g = this.ctx;
    g.fillStyle = `rgba(120,10,10,${Math.min(0.8, (life - age) / 3)})`;
    g.beginPath();
    g.arc(x, y, 0.7, 0, Math.PI * 2);
    g.arc(x + 0.5, y + 0.3, 0.4, 0, Math.PI * 2);
    g.fill();
  }

  private deadPed(p: Ped) {
    const g = this.ctx;
    g.fillStyle = p.color;
    g.fillRect(p.x - 0.5, p.y - 0.2, 1, 0.4);
  }

  private ped(p: Ped, alpha: number) {
    this.person(lerp(p.px, p.x, alpha), lerp(p.py, p.y, alpha), p.heading, p.color, p.step);
  }

  private playerPed(game: Game, alpha: number) {
    const p = game.player;
    const x = lerp(p.px, p.x, alpha);
    const y = lerp(p.py, p.y, alpha);
    const g = this.ctx;
    g.fillStyle = 'rgba(246,180,14,0.35)';
    g.beginPath();
    g.arc(x, y, 1.1, 0, Math.PI * 2);
    g.fill();
    this.person(x, y, lerpAngle(p.ph, p.heading, alpha), C.sun, p.step);
  }

  private person(x: number, y: number, heading: number, color: string, step: number) {
    const g = this.ctx;
    g.save();
    g.translate(x, y);
    g.rotate(heading);
    // people are drawn a bit larger than life so they read on a phone
    g.scale(1.3, 1.3);
    const swing = Math.sin(step * 4) * 0.25;
    g.fillStyle = '#222';
    g.fillRect(swing - 0.15, -0.45, 0.3, 0.2);
    g.fillRect(-swing - 0.15, 0.25, 0.3, 0.2);
    g.fillStyle = color;
    g.beginPath();
    g.ellipse(0, 0, 0.3, 0.45, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 0.08;
    g.stroke();
    g.fillStyle = '#5a3d2b';
    g.beginPath();
    g.arc(0.05, 0, 0.22, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  private vehicle(v: Vehicle, alpha: number, time: number, isPlayer = false) {
    const g = this.ctx;
    const x = lerp(v.px, v.x, alpha);
    const y = lerp(v.py, v.y, alpha);
    const h = lerpAngle(v.ph, v.heading, alpha);
    const L = v.params.length;
    const W = v.params.width;
    g.save();
    g.translate(x, y);
    g.rotate(h);
    // shadow
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(-L / 2 + 0.25, -W / 2 + 0.35, L, W);
    if (isPlayer) {
      g.strokeStyle = C.sun;
      g.lineWidth = 0.35;
      g.strokeRect(-L / 2 - 0.35, -W / 2 - 0.35, L + 0.7, W + 0.7);
    }
    const body = v.destroyed ? '#2a2725' : v.color;
    g.fillStyle = body;
    roundRect(g, -L / 2, -W / 2, L, W, 0.45);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 0.1;
    g.stroke();
    if (!v.destroyed) {
      // windscreen, roof, rear window
      g.fillStyle = '#1d2733';
      g.fillRect(L * 0.08, -W / 2 + 0.25, L * 0.18, W - 0.5);
      g.fillRect(-L * 0.36, -W / 2 + 0.3, L * 0.12, W - 0.6);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(-L * 0.22, -W / 2 + 0.3, L * 0.3, W - 0.6);
      if (v.model === 'van') {
        g.fillStyle = 'rgba(0,0,0,0.15)';
        g.fillRect(-L / 2 + 0.2, -W / 2 + 0.2, L * 0.55, W - 0.4);
      }
      if (v.kind === 'cop') {
        const on = Math.floor(time * 6) % 2 === 0;
        g.fillStyle = on ? C.copRed : '#6a1d1d';
        g.fillRect(-L * 0.1, -W / 2 + 0.2, L * 0.12, (W - 0.4) / 2);
        g.fillStyle = on ? '#1d2f6a' : C.copBlue;
        g.fillRect(-L * 0.1, 0, L * 0.12, (W - 0.4) / 2);
        g.fillStyle = '#15161b';
        g.fillRect(L * 0.3, -W / 2, L * 0.06, W);
      }
      // headlights
      g.fillStyle = '#fff6c8';
      g.fillRect(L / 2 - 0.25, -W / 2 + 0.2, 0.2, 0.35);
      g.fillRect(L / 2 - 0.25, W / 2 - 0.55, 0.2, 0.35);
      if (v.health < 35) {
        g.fillStyle = `rgba(60,60,60,${0.4 + 0.3 * Math.sin(time * 9)})`;
        g.beginPath();
        g.arc(L * 0.35, 0, 0.7, 0, Math.PI * 2);
        g.fill();
      }
    }
    g.restore();
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

/** Minimap: one pixel per tile around the player, with police and objective blips. */
export function drawMinimap(canvas: HTMLCanvasElement, game: Game) {
  const g = canvas.getContext('2d')!;
  const N = 128;
  if (canvas.width !== N) canvas.width = canvas.height = N;
  const tileM = game.meta.tileM;
  const f = game.focus();
  const img = g.createImageData(N, N);
  const rgb: Record<number, [number, number, number]> = {};
  for (const [k, hex] of Object.entries(MAP_COLORS)) {
    const n = parseInt(hex.slice(1), 16);
    rgb[+k] = [n >> 16, (n >> 8) & 255, n & 255];
  }
  const x0 = f.x - (N / 2) * tileM;
  const y0 = f.y - (N / 2) * tileM;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const t = tileType(game.world.tileAt(x0 + (c + 0.5) * tileM, y0 + (r + 0.5) * tileM));
      const [R, G, B] = rgb[t] ?? rgb[Tile.Ground];
      const i = (r * N + c) * 4;
      img.data[i] = R;
      img.data[i + 1] = G;
      img.data[i + 2] = B;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const toMap = (x: number, y: number) => [(x - x0) / tileM, (y - y0) / tileM] as const;
  const obj = game.objective();
  if (obj) {
    let [ox, oy] = toMap(obj.x, obj.y);
    ox = Math.max(4, Math.min(N - 4, ox));
    oy = Math.max(4, Math.min(N - 4, oy));
    g.strokeStyle = C.sun;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(ox, oy, 4, 0, Math.PI * 2);
    g.stroke();
  }
  for (const v of game.vehicles) {
    if (v.kind !== 'cop' || v.destroyed) continue;
    const [cx, cy] = toMap(v.x, v.y);
    if (cx < 0 || cy < 0 || cx > N || cy > N) continue;
    g.fillStyle = Math.floor(game.time * 4) % 2 ? C.copRed : C.copBlue;
    g.fillRect(cx - 2, cy - 2, 4, 4);
  }
  const h = game.player.vehicle?.heading ?? game.player.heading;
  g.save();
  g.translate(N / 2, N / 2);
  g.rotate(h + Math.PI / 2);
  g.fillStyle = C.sun;
  g.strokeStyle = '#000';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(0, -5);
  g.lineTo(4, 5);
  g.lineTo(0, 2.5);
  g.lineTo(-4, 5);
  g.closePath();
  g.fill();
  g.stroke();
  g.restore();
}
