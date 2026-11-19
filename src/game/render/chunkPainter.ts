// Paints one map chunk into an offscreen canvas: tiles, building roofs and
// shadows, trees, water ripples and road markings. Done once per chunk.

import { RoadClass, Tile, tileType, tileVariant, type ChunkData } from '../map/format.ts';
import { C, ROOFS } from './palette.ts';

/** Painted resolution: pixels per metre in the chunk cache. */
export const CACHE_PPM = 4;

const rnd = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

export function paintChunk(chunk: ChunkData, size: number, tileM: number): HTMLCanvasElement {
  const T = tileM * CACHE_PPM;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size * T;
  const g = canvas.getContext('2d')!;
  const at = (c: number, r: number) =>
    c < 0 || r < 0 || c >= size || r >= size ? -1 : tileType(chunk.tiles[r * size + c]);
  const ox = chunk.cx * size;
  const oy = chunk.cy * size;

  // base layer
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const b = chunk.tiles[r * size + c];
      const t = tileType(b);
      const x = c * T;
      const y = r * T;
      const n = rnd((ox + c) * 7919 + (oy + r));
      switch (t) {
        case Tile.Road:
          g.fillStyle = tileVariant(b) === 1 ? C.avenue : C.road;
          g.fillRect(x, y, T, T);
          break;
        case Tile.Sidewalk:
          g.fillStyle = C.sidewalk;
          g.fillRect(x, y, T, T);
          break;
        case Tile.Park:
          g.fillStyle = tileVariant(b) === 1 ? C.pitch : C.park;
          g.fillRect(x, y, T, T);
          break;
        case Tile.Water:
          g.fillStyle = C.water;
          g.fillRect(x, y, T, T);
          if (n < 0.25) {
            g.fillStyle = 'rgba(255,255,255,0.08)';
            g.fillRect(x + 2, y + ((n * 40) % T), T - 4, 2);
          }
          break;
        case Tile.Rail:
          g.fillStyle = C.rail;
          g.fillRect(x, y, T, T);
          g.fillStyle = '#4a4038';
          for (let k = 0; k < T; k += 5) g.fillRect(x, y + k, T, 2);
          break;
        case Tile.Plaza:
          g.fillStyle = C.plaza;
          g.fillRect(x, y, T, T);
          break;
        case Tile.Sand:
          g.fillStyle = C.sand;
          g.fillRect(x, y, T, T);
          break;
        case Tile.Building:
          break;
        default:
          g.fillStyle = n < 0.5 ? C.ground : '#857f74';
          g.fillRect(x, y, T, T);
      }
    }
  }

  // smooth roads and sidewalks drawn from the graph over the 4 m tiles
  const trace = (pts: Float32Array) => {
    g.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      const px = (pts[i] - ox * tileM) * CACHE_PPM;
      const py = (pts[i + 1] - oy * tileM) * CACHE_PPM;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
  };
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const e of chunk.edges) {
    if (e.cls === RoadClass.Motorway) continue;
    g.strokeStyle = C.sidewalk;
    g.lineWidth = (e.width + 5) * CACHE_PPM;
    trace(e.pts);
    g.stroke();
  }
  for (const e of chunk.edges) {
    g.strokeStyle = e.cls <= RoadClass.Primary ? C.avenue : C.road;
    g.lineWidth = e.width * CACHE_PPM;
    trace(e.pts);
    g.stroke();
  }

  // road markings
  g.lineCap = 'butt';
  for (const e of chunk.edges) {
    if (e.cls > RoadClass.Residential) continue;
    const lines: { off: number; color: string }[] = [];
    if (!e.oneway) lines.push({ off: 0, color: C.laneYellow });
    else
      for (let l = 1; l < e.lanes; l++)
        lines.push({ off: (l / e.lanes - 0.5) * e.width, color: C.laneWhite });
    for (const { off, color } of lines) {
      g.strokeStyle = color;
      g.lineWidth = 0.3 * CACHE_PPM;
      g.setLineDash([3 * CACHE_PPM, 3 * CACHE_PPM]);
      g.beginPath();
      for (let i = 0; i + 1 < e.pts.length; i += 2) {
        const j = Math.min(i + 2, e.pts.length - 2);
        const k = Math.max(i - 2, 0);
        const dx = e.pts[j] - e.pts[k];
        const dy = e.pts[j + 1] - e.pts[k + 1];
        const len = Math.hypot(dx, dy) || 1;
        const px = (e.pts[i] - (dy / len) * off - ox * tileM) * CACHE_PPM;
        const py = (e.pts[i + 1] + (dx / len) * off - oy * tileM) * CACHE_PPM;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
    }
  }
  g.setLineDash([]);

  // building shadows fall to the south-east, longer for taller buildings
  g.fillStyle = C.shadow;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (at(c, r) === Tile.Building) continue;
      for (let k = 1; k <= 3; k++) {
        const t = at(c - k, r - k);
        if (t === Tile.Building && chunk.heights[(r - k) * size + (c - k)] >= k * 3) {
          g.fillRect(c * T, r * T, T, T);
          break;
        }
        if (at(c - k, r) === Tile.Building || at(c, r - k) === Tile.Building) {
          if (k === 1) {
            g.fillRect(c * T, r * T, T, T);
            break;
          }
        }
      }
    }
  }

  // roofs, with a lit north edge and a shaded south edge
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const b = chunk.tiles[r * size + c];
      if (tileType(b) !== Tile.Building) continue;
      const [base, hi, lo] = ROOFS[tileVariant(b) % ROOFS.length];
      const x = c * T;
      const y = r * T;
      const same = (cc: number, rr: number) =>
        at(cc, rr) === Tile.Building && tileVariant(chunk.tiles[rr * size + cc]) === tileVariant(b);
      g.fillStyle = base;
      g.fillRect(x, y, T, T);
      g.fillStyle = hi;
      if (!same(c, r - 1)) g.fillRect(x, y, T, 3);
      if (!same(c - 1, r)) g.fillRect(x, y, 2, T);
      g.fillStyle = lo;
      if (!same(c, r + 1)) g.fillRect(x, y + T - 4, T, 4);
      if (!same(c + 1, r)) g.fillRect(x + T - 3, y, 3, T);
      // rooftop clutter on tall blocks
      const h = chunk.heights[r * size + c];
      if (h > 6 && rnd((ox + c) * 31 + (oy + r) * 17) < 0.06) {
        g.fillStyle = lo;
        g.fillRect(x + 4, y + 4, T - 8, T - 8);
      }
    }
  }

  // trees
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (at(c, r) !== Tile.Park) continue;
      const n = rnd((ox + c) * 131 + (oy + r) * 977);
      if (n > 0.3) continue;
      const rad = 4 + n * 18;
      const cx = c * T + T / 2 + (n - 0.15) * 20;
      const cy = r * T + T / 2 + (0.15 - n) * 16;
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.beginPath();
      g.arc(cx + 2, cy + 3, rad, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = C.tree[Math.floor(n * 10) % 3];
      g.beginPath();
      g.arc(cx, cy, rad, 0, Math.PI * 2);
      g.fill();
    }
  }
  return canvas;
}
