// Polygon and polyline helpers shared by the map pipeline and the game.
// Points are flattened [x0, y0, x1, y1, ...] in world metres.

type Pts = ArrayLike<number>;

/** Signed area (positive when the ring runs clockwise on screen, y down). */
export function ringArea(r: Pts): number {
  let a = 0;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) a += r[j * 2] * r[i * 2 + 1] - r[i * 2] * r[j * 2 + 1];
  return a / 2;
}

export function ringBounds(r: Pts): [number, number, number, number] {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    if (r[i] < x0) x0 = r[i];
    if (r[i] > x1) x1 = r[i];
    if (r[i + 1] < y0) y0 = r[i + 1];
    if (r[i + 1] > y1) y1 = r[i + 1];
  }
  return [x0, y0, x1, y1];
}

/** Area-weighted centroid of a ring. */
export function ringCentroid(r: Pts): [number, number] {
  let a = 0,
    cx = 0,
    cy = 0;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const f = r[j * 2] * r[i * 2 + 1] - r[i * 2] * r[j * 2 + 1];
    a += f;
    cx += (r[j * 2] + r[i * 2]) * f;
    cy += (r[j * 2 + 1] + r[i * 2 + 1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const [x0, y0, x1, y1] = ringBounds(r);
    return [(x0 + x1) / 2, (y0 + y1) / 2];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Even-odd point-in-polygon over several rings. */
export function insideRings(rings: Pts[], x: number, y: number): boolean {
  let inside = false;
  for (const r of rings) {
    const n = r.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = r[i * 2 + 1];
      const yj = r[j * 2 + 1];
      if (yi > y !== yj > y && x < ((r[j * 2] - r[i * 2]) * (y - yi)) / (yj - yi) + r[i * 2])
        inside = !inside;
    }
  }
  return inside;
}

/** Drops the duplicated closing point of an OSM ring, if present. */
export function openRing(r: number[]): number[] {
  const n = r.length;
  if (n >= 4 && r[0] === r[n - 2] && r[1] === r[n - 1]) return r.slice(0, n - 2);
  return r;
}

/** Douglas–Peucker simplification of an open polyline or ring. */
export function simplify(pts: number[], tol: number): number[] {
  const n = pts.length / 2;
  if (n <= 3) return pts;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1,
      bestD = t2;
    const ax = pts[a * 2],
      ay = pts[a * 2 + 1],
      bx = pts[b * 2],
      by = pts[b * 2 + 1];
    for (let i = a + 1; i < b; i++) {
      const d = segDist2(pts[i * 2], pts[i * 2 + 1], ax, ay, bx, by);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

export function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + t * dx - px;
  const ey = ay + t * dy - py;
  return ex * ex + ey * ey;
}

/** Sutherland–Hodgman clip of a ring to an axis-aligned rectangle. */
export function clipRing(r: number[], x0: number, y0: number, x1: number, y1: number): number[] {
  let pts = r;
  const edges: [
    (x: number, y: number) => boolean,
    (ax: number, ay: number, bx: number, by: number) => [number, number],
  ][] = [
    [(x) => x >= x0, (ax, ay, bx, by) => [x0, ay + ((x0 - ax) * (by - ay)) / (bx - ax)]],
    [(x) => x <= x1, (ax, ay, bx, by) => [x1, ay + ((x1 - ax) * (by - ay)) / (bx - ax)]],
    [(_, y) => y >= y0, (ax, ay, bx, by) => [ax + ((y0 - ay) * (bx - ax)) / (by - ay), y0]],
    [(_, y) => y <= y1, (ax, ay, bx, by) => [ax + ((y1 - ay) * (bx - ax)) / (by - ay), y1]],
  ];
  for (const [inside, cut] of edges) {
    const n = pts.length / 2;
    if (n === 0) break;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + n - 1) % n;
      const ax = pts[j * 2],
        ay = pts[j * 2 + 1],
        bx = pts[i * 2],
        by = pts[i * 2 + 1];
      const ain = inside(ax, ay);
      const bin = inside(bx, by);
      if (bin) {
        if (!ain) out.push(...cut(ax, ay, bx, by));
        out.push(bx, by);
      } else if (ain) out.push(...cut(ax, ay, bx, by));
    }
    pts = out;
  }
  return pts;
}

/** Clips a polyline to a rectangle; returns the pieces that remain inside. */
export function clipPolyline(p: Pts, x0: number, y0: number, x1: number, y1: number): number[][] {
  const pieces: number[][] = [];
  let cur: number[] | null = null;
  for (let i = 0; i + 3 < p.length; i += 2) {
    let ax = p[i],
      ay = p[i + 1],
      bx = p[i + 2],
      by = p[i + 3];
    // Liang–Barsky
    let t0 = 0,
      t1 = 1;
    const dx = bx - ax,
      dy = by - ay;
    let ok = true;
    for (const [pp, qq] of [
      [-dx, ax - x0],
      [dx, x1 - ax],
      [-dy, ay - y0],
      [dy, y1 - ay],
    ]) {
      if (pp === 0) {
        if (qq < 0) ok = false;
      } else {
        const t = qq / pp;
        if (pp < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
      }
    }
    if (!ok || t0 > t1) {
      cur = null;
      continue;
    }
    const sx = ax + dx * t0,
      sy = ay + dy * t0;
    bx = ax + dx * t1;
    by = ay + dy * t1;
    ax = sx;
    ay = sy;
    if (!cur || t0 > 0) {
      cur = [ax, ay];
      pieces.push(cur);
    }
    cur.push(bx, by);
    if (t1 < 1) cur = null;
  }
  return pieces.filter((c) => c.length >= 4);
}

/** Offsets a polyline sideways by d metres (positive = to the right of travel, y down). */
export function offsetPolyline(p: Pts, d: number): number[] {
  const n = p.length / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    let dx = p[b * 2] - p[a * 2];
    let dy = p[b * 2 + 1] - p[a * 2 + 1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    out.push(p[i * 2] - dy * d, p[i * 2 + 1] + dx * d);
  }
  return out;
}

/** Length of a polyline. */
export function lineLength(p: Pts): number {
  let len = 0;
  for (let i = 0; i + 3 < p.length; i += 2) len += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
  return len;
}

/** Oriented bounding box from the longest edge direction: centre, axis angle, half sizes. */
export function orientedBox(r: Pts): { cx: number; cy: number; angle: number; hw: number; hh: number } {
  const n = r.length / 2;
  let best = 0,
    angle = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = r[j * 2] - r[i * 2];
    const dy = r[j * 2 + 1] - r[i * 2 + 1];
    const l = dx * dx + dy * dy;
    if (l > best) {
      best = l;
      angle = Math.atan2(dy, dx);
    }
  }
  const c = Math.cos(angle),
    s = Math.sin(angle);
  let u0 = Infinity,
    u1 = -Infinity,
    v0 = Infinity,
    v1 = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    const u = r[i] * c + r[i + 1] * s;
    const v = -r[i] * s + r[i + 1] * c;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  const um = (u0 + u1) / 2,
    vm = (v0 + v1) / 2;
  return { cx: um * c - vm * s, cy: um * s + vm * c, angle, hw: (u1 - u0) / 2, hh: (v1 - v0) / 2 };
}
