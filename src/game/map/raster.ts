// Rasterisation helpers used by the map pipeline. Coordinates are world metres;
// a tile (col, row) covers [col·tileM, (col+1)·tileM) and is sampled at its centre.

export type Ring = number[]; // flattened [x0, y0, x1, y1, ...]

export interface GridSpec {
  cols: number;
  rows: number;
  tileM: number;
}

/** Calls fn(col, row) for every tile whose centre lies inside the rings (even-odd rule). */
export function fillPolygon(rings: Ring[], g: GridSpec, fn: (col: number, row: number) => void) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of rings) {
    for (let i = 1; i < r.length; i += 2) {
      if (r[i] < minY) minY = r[i];
      if (r[i] > maxY) maxY = r[i];
    }
  }
  const r0 = Math.max(0, Math.floor(minY / g.tileM - 0.5));
  const r1 = Math.min(g.rows - 1, Math.ceil(maxY / g.tileM - 0.5));
  const xs: number[] = [];
  for (let row = r0; row <= r1; row++) {
    const y = (row + 0.5) * g.tileM;
    xs.length = 0;
    for (const r of rings) {
      const n = r.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const yi = r[i * 2 + 1];
        const yj = r[j * 2 + 1];
        if (yi > y !== yj > y) {
          const xi = r[i * 2];
          const xj = r[j * 2];
          xs.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
        }
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil(xs[k] / g.tileM - 0.5));
      const c1 = Math.min(g.cols - 1, Math.floor(xs[k + 1] / g.tileM - 0.5));
      for (let col = c0; col <= c1; col++) fn(col, row);
    }
  }
}

/** Calls fn(col, row) for every tile whose centre is within halfWidth of the polyline. */
export function strokePolyline(
  pts: ArrayLike<number>,
  halfWidth: number,
  g: GridSpec,
  fn: (col: number, row: number) => void,
) {
  const r2 = halfWidth * halfWidth;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i];
    const ay = pts[i + 1];
    const bx = pts[i + 2];
    const by = pts[i + 3];
    const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - halfWidth) / g.tileM));
    const c1 = Math.min(g.cols - 1, Math.floor((Math.max(ax, bx) + halfWidth) / g.tileM));
    const q0 = Math.max(0, Math.floor((Math.min(ay, by) - halfWidth) / g.tileM));
    const q1 = Math.min(g.rows - 1, Math.floor((Math.max(ay, by) + halfWidth) / g.tileM));
    for (let row = q0; row <= q1; row++) {
      const py = (row + 0.5) * g.tileM;
      for (let col = c0; col <= c1; col++) {
        const px = (col + 0.5) * g.tileM;
        if (distToSegment2(px, py, ax, ay, bx, by) <= r2) fn(col, row);
      }
    }
  }
}

export function distToSegment2(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + t * dx - px;
  const ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

/**
 * Joins the member ways of a multipolygon into closed rings. Ways are point lists
 * whose ends meet; open leftovers are closed as-is so a clipped relation still fills.
 */
export function assembleRings(ways: Ring[]): Ring[] {
  const same = (r: Ring, i: number, s: Ring, j: number) =>
    Math.abs(r[i] - s[j]) < 1e-6 && Math.abs(r[i + 1] - s[j + 1]) < 1e-6;
  const pending = ways.filter((w) => w.length >= 4).map((w) => w.slice());
  const rings: Ring[] = [];
  while (pending.length) {
    let ring = pending.pop()!;
    let grew = true;
    while (!same(ring, 0, ring, ring.length - 2) && grew) {
      grew = false;
      const end = ring.length - 2;
      for (let k = 0; k < pending.length; k++) {
        const w = pending[k];
        const wEnd = w.length - 2;
        let add: Ring | null = null;
        if (same(ring, end, w, 0)) add = w.slice(2);
        else if (same(ring, end, w, wEnd)) add = reversePts(w).slice(2);
        else if (same(ring, 0, w, wEnd)) ring = w.concat(ring.slice(2));
        else if (same(ring, 0, w, 0)) ring = reversePts(w).concat(ring.slice(2));
        else continue;
        if (add) ring = ring.concat(add);
        pending.splice(k, 1);
        grew = true;
        break;
      }
    }
    rings.push(ring);
  }
  return rings;
}

export function reversePts(pts: Ring): Ring {
  const out: Ring = new Array(pts.length);
  for (let i = 0; i < pts.length; i += 2) {
    out[pts.length - 2 - i] = pts[i];
    out[pts.length - 1 - i] = pts[i + 1];
  }
  return out;
}
