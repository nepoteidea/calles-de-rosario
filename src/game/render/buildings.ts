// Buildings and trees, drawn every frame over the cached ground layer.
//
// The camera looks straight down from a fixed height. A roof at height h is
// drawn scaled away from the screen centre by HC / (HC − h), so buildings lean
// outwards as the camera moves and their walls show, with rows of windows per
// floor. Walls facing the camera are drawn far to near, then the roof with its
// parapet, water tanks, AC units and skylights. Landmarks get their own looks.

import { insideRings, orientedBox, ringArea, ringBounds, ringCentroid } from '../map/geometry.ts';
import { Line, Shape, Tile, tileType, tileVariant, type ChunkData, type Landmark } from '../map/format.ts';

/** Virtual camera height in metres. */
const HC = 150;
/** Heights above this are drawn as this tall, so towers don't swallow the screen. */
const ZMAX = 60;
const kz = (z: number) => HC / (HC - Math.min(z, ZMAX));
/** Variant the map pipeline gives the Monumento's tower. */
const TOWER_VARIANT = 200;

const WALLS = [
  '#8a4b32',
  '#7c7f86',
  '#b9a27a',
  '#3e4f73',
  '#a8794a',
  '#c9c6bd',
  '#b88a7e',
  '#8d8a83',
  '#9c6b4e',
  '#d0c4a8',
  '#6f7480',
  '#c2a77e',
  '#7d5a48',
  '#a9aca8',
  '#bfa58a',
  '#5f6f7d',
];
const ROOFS = [
  '#6d6a66',
  '#5d6068',
  '#9b958a',
  '#47505f',
  '#7a7064',
  '#a9a49a',
  '#8c7f74',
  '#66625c',
  '#827a70',
  '#b3ab9c',
  '#585c63',
  '#948a7c',
  '#6e665f',
  '#9fa19c',
  '#8f8578',
  '#50565e',
];
const PARAPETS = ROOFS.map((c) => shade(c, 1.25));
const TILE_ROOF = '#a5533a';
const SILO_COLORS = ['#e8483b', '#ffd23f', '#3a7bd5', '#3c8f5a', '#8e44ad', '#d35400', '#1abc9c', '#e05a8a'];

export interface BuildingView {
  ring: Float32Array;
  holes: Float32Array[];
  /** +1 or −1: which way the outward normal turns for this ring's winding. */
  wind: number;
  h: number;
  variant: number;
  kind: string;
  colors?: [string, string];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  box: { cx: number; cy: number; angle: number; hw: number; hh: number };
  /** Roof clutter, flattened [type, x, y, size]: 1 tank, 2 AC unit, 3 skylight. */
  details: number[];
}

const hashf = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

export function prepareBuildings(chunk: ChunkData, landmarks: Landmark[]): BuildingView[] {
  const out: BuildingView[] = [];
  let n = chunk.cx * 7919 + chunk.cy * 104729;
  for (const s of chunk.shapes) {
    if (s.kind !== Shape.Building) continue;
    const ring = s.rings[0];
    const [x0, y0, x1, y1] = ringBounds(ring);
    const [cx, cy] = ringCentroid(ring);
    const lm = s.landmark ? landmarks[s.landmark - 1] : undefined;
    const area = Math.abs(ringArea(ring));
    const details: number[] = [];
    const kind = lm?.kind ?? '';
    if (!kind && !(s.variant & 16) && area > 40) {
      const tanks = 1 + Math.floor(hashf(n++) * Math.min(4, area / 120));
      const acs = Math.floor(hashf(n++) * 3);
      const tryPut = (type: number, size: number) => {
        for (let k = 0; k < 12; k++) {
          const x = x0 + size + hashf(n++) * Math.max(0.1, x1 - x0 - size * 2);
          const y = y0 + size + hashf(n++) * Math.max(0.1, y1 - y0 - size * 2);
          if (
            insideRings([ring], x, y) &&
            insideRings([ring], x + size, y) &&
            insideRings([ring], x - size, y) &&
            insideRings([ring], x, y + size) &&
            insideRings([ring], x, y - size)
          ) {
            details.push(type, x, y, size);
            return;
          }
        }
      };
      for (let k = 0; k < tanks; k++) tryPut(1, 0.75);
      for (let k = 0; k < acs; k++) tryPut(2, 0.8);
      if (area > 250 && hashf(n++) < 0.6) tryPut(3, 1.6);
    }
    out.push({
      ring,
      holes: s.rings.slice(1),
      wind: ringArea(ring) > 0 ? 1 : -1,
      h: s.height,
      variant: s.variant,
      kind,
      colors: lm?.colors,
      x0,
      y0,
      x1,
      y1,
      cx,
      cy,
      box: orientedBox(ring),
      details,
    });
  }
  return out;
}

/** Trees, flattened [x, y, radius, kind]: kind 0 broadleaf, 1 dark, 2 palm. */
export function prepareTrees(
  chunk: ChunkData,
  tileAt: (x: number, y: number) => number,
  chunkM: number,
): Float32Array {
  const typeAt = (x: number, y: number) => tileType(tileAt(x, y));
  // parks only: not pitches, lawns, medians or cemeteries
  const parkAt = (x: number, y: number) => {
    const b = tileAt(x, y);
    return tileType(b) === Tile.Park && tileVariant(b) === 0;
  };
  const out: number[] = [];
  const ox = chunk.cx * chunkM,
    oy = chunk.cy * chunkM;
  const mine = (x: number, y: number) => x >= ox && y >= oy && x < ox + chunkM && y < oy + chunkM;
  let n = chunk.cx * 31337 + chunk.cy * 7331;
  for (const s of chunk.shapes) {
    if (s.kind !== Shape.Park) continue;
    const [x0, y0, x1, y1] = ringBounds(s.rings[0]);
    const step = s.variant === 1 ? 6 : 9;
    const p = s.variant === 1 ? 0.8 : 0.42;
    for (let y = y0 + step / 2; y < y1; y += step) {
      for (let x = x0 + step / 2; x < x1; x += step) {
        if (hashf(n++) > p) continue;
        const tx = x + (hashf(n++) - 0.5) * step * 0.8;
        const ty = y + (hashf(n++) - 0.5) * step * 0.8;
        if (!mine(tx, ty) || !insideRings(s.rings, tx, ty) || !parkAt(tx, ty)) continue;
        out.push(tx, ty, 2.6 + hashf(n++) * 2.6, s.variant === 1 ? 1 : 0);
      }
    }
  }
  for (const e of chunk.edges) {
    if (e.sidewalk < 2.4 || e.cls < 1 || e.cls > 4) continue;
    const off = e.width / 2 + e.sidewalk * 0.55;
    let walked = 0;
    for (let i = 0; i + 3 < e.pts.length; i += 2) {
      const ax = e.pts[i],
        ay = e.pts[i + 1];
      const dx = e.pts[i + 2] - ax,
        dy = e.pts[i + 3] - ay;
      const len = Math.hypot(dx, dy);
      if (len < 0.1) continue;
      for (let t = (10 - (walked % 10)) % 10; t < len; t += 10) {
        for (const side of [1, -1]) {
          const x = ax + (dx / len) * t - (dy / len) * off * side;
          const y = ay + (dy / len) * t + (dx / len) * off * side;
          if (!mine(x, y) || typeAt(x, y) !== Tile.Sidewalk) continue;
          if (hashf(n++) < 0.25) continue;
          out.push(x, y, 2.2 + hashf(n++) * 1.4, 0);
        }
      }
      walked += len;
    }
  }
  for (const l of chunk.lines) {
    if (l.kind !== Line.Median || l.width < 3) continue;
    const palm = l.width >= 7 ? 2 : 0;
    for (let i = 0; i + 3 < l.pts.length; i += 2) {
      const ax = l.pts[i],
        ay = l.pts[i + 1];
      const dx = l.pts[i + 2] - ax,
        dy = l.pts[i + 3] - ay;
      const len = Math.hypot(dx, dy);
      for (let t = 5; t < len - 3; t += 11) {
        const x = ax + (dx / len) * t,
          y = ay + (dy / len) * t;
        if (!mine(x, y) || typeAt(x, y) === Tile.Road) continue;
        out.push(x, y, palm ? 3.2 : 2.6, palm);
      }
    }
  }
  return Float32Array.from(out);
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round((n >> 16) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}
const shadeCache = new Map<string, string>();
const shaded = (hex: string, f: number) => {
  const key = `${hex}${Math.round(f * 20)}`;
  let s = shadeCache.get(key);
  if (!s) {
    s = shade(hex, Math.round(f * 20) / 20);
    shadeCache.set(key, s);
  }
  return s;
};

export class BuildingRenderer {
  private camX = 0;
  private camY = 0;
  private ppm = 1;
  private g!: CanvasRenderingContext2D;

  draw(g: CanvasRenderingContext2D, list: BuildingView[], camX: number, camY: number, ppm: number) {
    this.g = g;
    this.camX = camX;
    this.camY = camY;
    this.ppm = ppm;
    const d2 = (b: BuildingView) => (b.cx - camX) ** 2 + (b.cy - camY) ** 2;
    list.sort((a, b) => Math.min(a.h, ZMAX) - Math.min(b.h, ZMAX) || d2(b) - d2(a));
    g.lineJoin = 'miter';
    for (const b of list) this.building(b);
  }

  /** Point (x, y) raised to height z, as drawn on screen (world units). */
  private px(x: number, y: number, k: number): [number, number] {
    return [this.camX + (x - this.camX) * k, this.camY + (y - this.camY) * k];
  }

  private building(b: BuildingView) {
    const g = this.g;
    const k = kz(b.h);
    const r = b.ring;
    const n = r.length / 2;
    const style = this.style(b);

    // walls that face the camera, far to near
    const walls: { i: number; d: number; nx: number; ny: number }[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = r[i * 2],
        ay = r[i * 2 + 1],
        bx = r[j * 2],
        by = r[j * 2 + 1];
      const dx = bx - ax,
        dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len < 0.05) continue;
      const nx = (dy / len) * b.wind,
        ny = (-dx / len) * b.wind;
      const mx = (ax + bx) / 2,
        my = (ay + by) / 2;
      if (nx * (this.camX - mx) + ny * (this.camY - my) <= 0) continue;
      walls.push({ i, d: (mx - this.camX) ** 2 + (my - this.camY) ** 2, nx, ny });
    }
    walls.sort((a, c) => c.d - a.d);
    for (const w of walls) {
      const j = (w.i + 1) % n;
      const ax = r[w.i * 2],
        ay = r[w.i * 2 + 1],
        bx = r[j * 2],
        by = r[j * 2 + 1];
      const [rax, ray] = this.px(ax, ay, k);
      const [rbx, rby] = this.px(bx, by, k);
      // light from the north-west
      const lit = 0.72 + 0.28 * Math.max(0, -0.6 * w.nx - 0.8 * w.ny) + 0.1 * Math.max(0, w.nx);
      g.fillStyle = shaded(style.wall, lit);
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.lineTo(rbx, rby);
      g.lineTo(rax, ray);
      g.closePath();
      g.fill();
      const depth = Math.hypot(rax - ax, ray - ay) * this.ppm;
      if (depth > 3) this.facade(b, style, ax, ay, bx, by, depth);
    }
    this.roof(b, style, k);
  }

  private style(b: BuildingView) {
    const v = b.variant & 15;
    switch (b.kind) {
      case 'monument':
        return { wall: '#c6bfac', roof: '#e6e0d1', parapet: '#f4f0e6', windows: 'grooves' as const };
      case 'stadium':
      case 'arena':
        return {
          wall: '#8d8f96',
          roof: b.colors?.[0] ?? '#8d8f96',
          parapet: '#c9cbd0',
          windows: 'none' as const,
        };
      case 'church':
        return { wall: '#c9b48c', roof: TILE_ROOF, parapet: '#c06a4c', windows: 'arches' as const };
      case 'silos':
        return { wall: '#9a958c', roof: '#b9b4aa', parapet: '#d6d1c6', windows: 'none' as const };
      case 'hospital':
        return { wall: '#d8d6cf', roof: '#ecebe6', parapet: '#ffffff', windows: 'grid' as const };
      case 'station':
        return { wall: '#b9a27a', roof: '#8b8f96', parapet: '#a3a7ae', windows: 'arches' as const };
      case 'warehouse':
        return { wall: '#8a4b32', roof: '#7a6a5a', parapet: '#8f7d6b', windows: 'arches' as const };
      case 'mall':
        return { wall: '#c9c6bd', roof: '#d9d9d4', parapet: '#f0f0ec', windows: 'bands' as const };
      case 'tower':
        return { wall: '#3e5f8f', roof: '#47505f', parapet: '#6b7486', windows: 'bands' as const };
      case 'civic':
      case 'museum':
      case 'theatre':
        return { wall: '#cfc4a8', roof: '#bfb6a0', parapet: '#e2dccb', windows: 'arches' as const };
      default:
        return {
          wall: WALLS[v],
          roof: b.variant & 16 ? TILE_ROOF : ROOFS[v],
          parapet: b.variant & 16 ? '#c06a4c' : PARAPETS[v],
          windows: v === 3 || v === 15 ? ('bands' as const) : ('grid' as const),
        };
    }
  }

  /** Windows (or grooves, arches, glass bands) on one wall. */
  private facade(
    b: BuildingView,
    style: ReturnType<BuildingRenderer['style']>,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    depth: number,
  ) {
    if (style.windows === 'none') return;
    const g = this.g;
    const len = Math.hypot(bx - ax, by - ay);
    const P = (u: number, z: number) => this.px(ax + (bx - ax) * u, ay + (by - ay) * u, kz(z));
    const floors = Math.max(1, Math.floor(b.h / 3));
    g.beginPath();
    if (style.windows === 'grooves') {
      g.strokeStyle = 'rgba(110,104,90,0.6)';
      g.lineWidth = 0.18;
      const cols = Math.max(2, Math.floor(len / 1.6));
      for (let c = 1; c < cols; c++) {
        const [x0, y0] = P(c / cols, 0);
        const [x1, y1] = P(c / cols, b.h);
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
      }
      g.stroke();
      return;
    }
    const quad = (u0: number, u1: number, z0: number, z1: number) => {
      const [a, c] = P(u0, z0);
      const [d, e] = P(u1, z0);
      const [f, h] = P(u1, z1);
      const [i, j] = P(u0, z1);
      g.moveTo(a, c);
      g.lineTo(d, e);
      g.lineTo(f, h);
      g.lineTo(i, j);
      g.closePath();
    };
    const drawFloors = Math.min(floors, depth < 10 ? 4 : 30);
    const zStep = b.h / drawFloors;
    if (style.windows === 'bands') {
      for (let f = 0; f < drawFloors; f++) {
        const z = (f * b.h) / drawFloors;
        quad(0.02, 0.98, z + zStep * 0.3, z + zStep * 0.85);
      }
      g.fillStyle = 'rgba(160,200,235,0.45)';
      g.fill();
      return;
    }
    const spacing = style.windows === 'arches' ? 3.4 : 2.8;
    const cols = Math.max(1, Math.min(18, Math.floor(len / spacing)));
    for (let f = 0; f < drawFloors; f++) {
      const z = (f * b.h) / drawFloors;
      for (let c = 0; c < cols; c++) {
        const u0 = (c + 0.25) / cols,
          u1 = (c + 0.75) / cols;
        quad(u0, u1, z + zStep * 0.3, z + zStep * (style.windows === 'arches' ? 0.9 : 0.78));
      }
    }
    g.fillStyle = (b.variant & 7) === 2 ? '#2b3550' : '#26304a';
    g.fill();
  }

  private trace(ring: ArrayLike<number>, k: number, scale = 1, about?: [number, number]) {
    const g = this.g;
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      let [x, y] = this.px(ring[i * 2], ring[i * 2 + 1], k);
      if (about) {
        x = about[0] + (x - about[0]) * scale;
        y = about[1] + (y - about[1]) * scale;
      }
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
  }

  private roof(b: BuildingView, style: ReturnType<BuildingRenderer['style']>, k: number) {
    const g = this.g;
    const centre = this.px(b.cx, b.cy, k);
    if (b.kind === 'monument' && b.variant === TOWER_VARIANT) {
      // tapered tower: the top is narrower than the base
      g.fillStyle = style.wall;
      g.beginPath();
      this.trace(b.ring, k, 0.55, centre);
      g.fill();
      g.fillStyle = style.roof;
      g.beginPath();
      this.trace(b.ring, k, 0.5, centre);
      g.fill();
      g.fillStyle = '#bfb7a3';
      g.beginPath();
      this.trace(b.ring, k, 0.22, centre);
      g.fill();
      return;
    }
    g.beginPath();
    this.trace(b.ring, k);
    for (const h of b.holes) this.trace(h, k);
    g.fillStyle = style.roof;
    if (b.kind === 'stadium') {
      // stands around an open pitch
      this.trace(b.ring, k, 0.66, centre);
      g.fill('evenodd');
      g.strokeStyle = b.colors?.[1] ?? '#ffd23f';
      const bw = Math.min(b.box.hw, b.box.hh) * k * 0.08;
      g.lineWidth = bw;
      g.setLineDash([bw * 1.6, bw * 1.6]);
      g.beginPath();
      this.trace(b.ring, k, 0.83, centre);
      g.stroke();
      g.setLineDash([]);
      g.strokeStyle = style.parapet;
      g.lineWidth = 0.6;
      g.beginPath();
      this.trace(b.ring, k);
      g.stroke();
      return;
    }
    g.fill('evenodd');
    g.strokeStyle = style.parapet;
    g.lineWidth = Math.max(0.3, 0.45 * k);
    g.stroke();

    const box = b.box;
    const along = (u: number, v: number, kk = k): [number, number] => {
      const c = Math.cos(box.angle),
        s = Math.sin(box.angle);
      return this.px(box.cx + u * c - v * s, box.cy + u * s + v * c, kk);
    };
    const line = (u0: number, v0: number, u1: number, v1: number) => {
      const [x0, y0] = along(u0, v0);
      const [x1, y1] = along(u1, v1);
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
    };

    if (b.variant & 16 || b.kind === 'church') {
      // pitched clay-tile roof: a ridge along the long side
      g.strokeStyle = '#7a3a27';
      g.lineWidth = 0.35 * k;
      g.beginPath();
      line(-box.hw * 0.85, 0, box.hw * 0.85, 0);
      g.stroke();
      g.strokeStyle = 'rgba(110,47,30,0.45)';
      g.lineWidth = 0.15 * k;
      g.beginPath();
      for (const v of [-0.5, 0.5]) line(-box.hw * 0.9, box.hh * v, box.hw * 0.9, box.hh * v);
      g.stroke();
    }
    switch (b.kind) {
      case 'church': {
        const [dx, dy] = along(box.hw * 0.25, 0, kz(b.h + 8));
        const rr = Math.min(box.hh, box.hw) * 0.55 * k;
        g.fillStyle = '#7aa6a0';
        g.beginPath();
        g.arc(dx, dy, rr, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#e6e0d1';
        g.lineWidth = rr * 0.18;
        g.stroke();
        g.fillStyle = '#e6e0d1';
        g.beginPath();
        g.arc(dx, dy, rr * 0.25, 0, Math.PI * 2);
        g.fill();
        break;
      }
      case 'arena': {
        g.strokeStyle = b.colors?.[1] ?? '#1a1a1e';
        g.lineWidth = Math.min(box.hw, box.hh) * 0.25 * k;
        g.beginPath();
        line(-box.hw * 0.8, 0, box.hw * 0.8, 0);
        line(0, -box.hh * 0.8, 0, box.hh * 0.8);
        g.stroke();
        break;
      }
      case 'silos': {
        // grain bins in two rows, painted in bright colours
        const long = box.hw >= box.hh;
        const span = long ? box.hw : box.hh;
        const across = long ? box.hh : box.hw;
        const rowsN = across * 2 > 14 ? 2 : 1;
        const rad = (across / rowsN) * 0.92;
        const count = Math.max(1, Math.floor((span * 2) / (rad * 2)));
        let c = 0;
        for (let row = 0; row < rowsN; row++) {
          const v = rowsN === 1 ? 0 : (row === 0 ? -1 : 1) * across * 0.5;
          for (let i = 0; i < count; i++) {
            const t = -span + rad + ((span * 2 - rad * 2) * i) / Math.max(1, count - 1);
            const [sx, sy] = long ? along(t, v) : along(v, t);
            g.fillStyle = SILO_COLORS[c++ % SILO_COLORS.length];
            g.beginPath();
            g.arc(sx, sy, rad * k, 0, Math.PI * 2);
            g.fill();
            g.strokeStyle = 'rgba(0,0,0,0.35)';
            g.lineWidth = 0.25 * k;
            g.stroke();
            g.fillStyle = 'rgba(255,255,255,0.28)';
            g.beginPath();
            g.arc(sx - rad * k * 0.3, sy - rad * k * 0.3, rad * k * 0.3, 0, Math.PI * 2);
            g.fill();
          }
        }
        break;
      }
      case 'hospital': {
        const s = Math.min(box.hw, box.hh) * 0.45;
        g.fillStyle = '#d6332a';
        g.beginPath();
        const [a1, a2] = along(-s, -s * 0.3);
        const [b1, b2] = along(s, -s * 0.3);
        const [c1, c2] = along(s, s * 0.3);
        const [d1, d2] = along(-s, s * 0.3);
        g.moveTo(a1, a2);
        g.lineTo(b1, b2);
        g.lineTo(c1, c2);
        g.lineTo(d1, d2);
        g.closePath();
        const [e1, e2] = along(-s * 0.3, -s);
        const [f1, f2] = along(s * 0.3, -s);
        const [h1, h2] = along(s * 0.3, s);
        const [i1, i2] = along(-s * 0.3, s);
        g.moveTo(e1, e2);
        g.lineTo(f1, f2);
        g.lineTo(h1, h2);
        g.lineTo(i1, i2);
        g.closePath();
        g.fill('nonzero');
        break;
      }
      case 'station':
      case 'warehouse': {
        g.strokeStyle = 'rgba(0,0,0,0.18)';
        g.lineWidth = 0.5 * k;
        g.beginPath();
        for (let u = -box.hw + 1; u < box.hw; u += 2) line(u, -box.hh * 0.95, u, box.hh * 0.95);
        g.stroke();
        break;
      }
      case 'mall': {
        g.fillStyle = '#b9bcc2';
        for (let u = -box.hw + 4; u < box.hw - 3; u += 7)
          for (let v = -box.hh + 4; v < box.hh - 3; v += 7) {
            const [x, y] = along(u, v);
            g.fillRect(x - 0.8 * k, y - 0.6 * k, 1.6 * k, 1.2 * k);
          }
        break;
      }
      case 'tower': {
        if (Math.min(box.hw, box.hh) > 7) {
          g.strokeStyle = '#ffd23f';
          g.lineWidth = 0.4 * k;
          g.beginPath();
          g.arc(centre[0], centre[1], Math.min(box.hw, box.hh) * 0.55 * k, 0, Math.PI * 2);
          g.stroke();
          const s = Math.min(box.hw, box.hh) * 0.25 * k;
          g.beginPath();
          g.moveTo(centre[0] - s * 0.6, centre[1] - s);
          g.lineTo(centre[0] - s * 0.6, centre[1] + s);
          g.moveTo(centre[0] + s * 0.6, centre[1] - s);
          g.lineTo(centre[0] + s * 0.6, centre[1] + s);
          g.moveTo(centre[0] - s * 0.6, centre[1]);
          g.lineTo(centre[0] + s * 0.6, centre[1]);
          g.stroke();
        }
        break;
      }
    }

    // roof clutter: black water tanks, AC units, skylights
    const d = b.details;
    for (let i = 0; i < d.length; i += 4) {
      const [x, y] = this.px(d[i + 1], d[i + 2], k);
      const s = d[i + 3] * k;
      if (d[i] === 1) {
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.beginPath();
        g.arc(x + s * 0.25, y + s * 0.3, s, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#24262d';
        g.beginPath();
        g.arc(x, y, s, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#454953';
        g.lineWidth = s * 0.18;
        g.beginPath();
        g.arc(x, y, s * 0.55, 0, Math.PI * 2);
        g.stroke();
      } else if (d[i] === 2) {
        g.fillStyle = '#b9bcc2';
        g.fillRect(x - s, y - s * 0.7, s * 2, s * 1.4);
        g.fillStyle = '#6a6e76';
        g.beginPath();
        g.arc(x, y, s * 0.45, 0, Math.PI * 2);
        g.fill();
      } else {
        g.fillStyle = '#8fb3c9';
        g.fillRect(x - s, y - s * 0.7, s * 2, s * 1.4);
        g.strokeStyle = style.parapet;
        g.lineWidth = 0.15 * k;
        g.strokeRect(x - s, y - s * 0.7, s * 2, s * 1.4);
      }
    }
  }
}

/** Draws tree canopies (and palms) for the trees inside the view. */
export function drawTrees(
  g: CanvasRenderingContext2D,
  trees: Float32Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  for (let i = 0; i < trees.length; i += 4) {
    const x = trees[i],
      y = trees[i + 1],
      r = trees[i + 2],
      kind = trees[i + 3];
    if (x < x0 - r || x > x1 + r || y < y0 - r || y > y1 + r) continue;
    if (kind === 2) {
      g.strokeStyle = '#3f7a35';
      g.lineWidth = 0.55;
      g.lineCap = 'round';
      g.beginPath();
      for (let a = 0; a < 10; a++) {
        const ang = (a / 10) * Math.PI * 2 + x;
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(ang) * r, y + Math.sin(ang) * r);
      }
      g.stroke();
      g.strokeStyle = '#6aa64d';
      g.lineWidth = 0.22;
      g.stroke();
      g.fillStyle = '#8a6a3a';
      g.beginPath();
      g.arc(x, y, 0.45, 0, Math.PI * 2);
      g.fill();
      continue;
    }
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.beginPath();
    g.arc(x + r * 0.25, y + r * 0.3, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = kind === 1 ? '#2a4f25' : '#2f5a2a';
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = kind === 1 ? '#365f2f' : '#3f7334';
    g.beginPath();
    g.arc(x - r * 0.25, y - r * 0.25, r * 0.62, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#5d9446';
    g.beginPath();
    g.arc(x - r * 0.35, y - r * 0.4, r * 0.22, 0, Math.PI * 2);
    g.fill();
  }
}
