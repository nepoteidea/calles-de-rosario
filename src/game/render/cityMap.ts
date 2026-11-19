// Whole-city map for the MAPA screen, drawn from the coarse overview grid.

import { decodeOverview, type MapMeta } from '../map/format.ts';
import { MAP_COLORS } from './palette.ts';

let overviewPromise: Promise<Uint8Array> | null = null;

export function loadOverview(base: string, meta: MapMeta): Promise<Uint8Array> {
  overviewPromise ??= fetch(`${base}/overview.bin`)
    .then((r) => {
      if (!r.ok) throw new Error(`overview.bin: HTTP ${r.status}`);
      return r.arrayBuffer();
    })
    .then((buf) => decodeOverview(new Uint8Array(buf), meta.overview.cols * meta.overview.rows));
  return overviewPromise;
}

/** Paints the overview into a canvas, one pixel per cell. Locked phases are dimmed. */
export function paintCityMap(canvas: HTMLCanvasElement, meta: MapMeta, cells: Uint8Array, unlocked: number) {
  const { cols, rows, cell } = meta.overview;
  canvas.width = cols;
  canvas.height = rows;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(cols, rows);
  const rgb = new Map<number, number[]>();
  for (const [k, hex] of Object.entries(MAP_COLORS)) {
    const n = parseInt(hex.slice(1), 16);
    rgb.set(+k, [n >> 16, (n >> 8) & 255, n & 255]);
  }
  const open = meta.phases.find((p) => p.id === unlocked)?.rect;
  const all = unlocked >= meta.phases.length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [R, G, B] = rgb.get(cells[r * cols + c]) ?? [42, 44, 51];
      const x = (c + 0.5) * cell;
      const y = (r + 0.5) * cell;
      const lit = all || (open && x >= open[0] && x <= open[2] && y >= open[1] && y <= open[3]);
      const k = lit ? 1 : 0.42;
      const i = (r * cols + c) * 4;
      img.data[i] = R * k;
      img.data[i + 1] = G * k;
      img.data[i + 2] = B * k;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

/** World metres → fraction of the map image (0..1), for positioning HTML markers. */
export function mapFraction(meta: MapMeta, x: number, y: number) {
  const { cols, rows, cell } = meta.overview;
  return { fx: x / (cols * cell), fy: y / (rows * cell) };
}
