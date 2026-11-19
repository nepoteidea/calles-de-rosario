// Geometry on world-metre polylines and positions.

import { distToSegment2 } from '../map/raster.ts';
import type { Edge, MapMeta } from '../map/format.ts';
import type { World } from './world.ts';

export function polylineLength(pts: ArrayLike<number>): number {
  let len = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) len += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
  return len;
}

/** Point and unit direction at distance s along the polyline (clamped to its ends). */
export function pointAt(pts: ArrayLike<number>, s: number): { x: number; y: number; dx: number; dy: number } {
  let rest = Math.max(0, s);
  const last = pts.length - 4;
  for (let i = 0; i <= last; i += 2) {
    const dx = pts[i + 2] - pts[i];
    const dy = pts[i + 3] - pts[i + 1];
    const seg = Math.hypot(dx, dy);
    if (seg === 0) continue;
    if (rest <= seg || i === last) {
      const t = Math.min(1, rest / seg);
      return { x: pts[i] + dx * t, y: pts[i + 1] + dy * t, dx: dx / seg, dy: dy / seg };
    }
    rest -= seg;
  }
  return { x: pts[0], y: pts[1], dx: 1, dy: 0 };
}

/** Distance along the polyline of the point closest to (x, y), and the squared gap to it. */
export function projectOnto(pts: ArrayLike<number>, x: number, y: number): { s: number; d2: number } {
  let best = Infinity;
  let bestS = 0;
  let acc = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i];
    const ay = pts[i + 1];
    const dx = pts[i + 2] - ax;
    const dy = pts[i + 3] - ay;
    const seg = Math.hypot(dx, dy);
    const d2 = distToSegment2(x, y, ax, ay, ax + dx, ay + dy);
    if (d2 < best) {
      best = d2;
      const t = seg > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (seg * seg))) : 0;
      bestS = acc + t * seg;
    }
    acc += seg;
  }
  return { s: bestS, d2: best };
}

export function nearestEdge(
  edges: Edge[],
  x: number,
  y: number,
  maxDist = Infinity,
  filter?: (e: Edge) => boolean,
) {
  let best: Edge | null = null;
  let bestD2 = maxDist * maxDist;
  let bestS = 0;
  for (const e of edges) {
    if (filter && !filter(e)) continue;
    const p = projectOnto(e.pts, x, y);
    if (p.d2 < bestD2) {
      bestD2 = p.d2;
      best = e;
      bestS = p.s;
    }
  }
  return best ? { edge: best, s: bestS, dist: Math.sqrt(bestD2) } : null;
}

/** "LAPRIDA Y CÓRDOBA" near a corner, otherwise just the street name. */
export function streetLabel(world: World, x: number, y: number): string {
  const edges = world.edgesNear(x, y).filter((e) => e.name > 0);
  const here = nearestEdge(edges, x, y, 40);
  if (!here) return '';
  const name = world.meta.names[here.edge.name];
  const cross = nearestEdge(edges, x, y, 22, (e) => world.meta.names[e.name] !== name);
  return (
    cross ? `${shortStreet(name)} y ${shortStreet(world.meta.names[cross.edge.name])}` : shortStreet(name)
  ).toUpperCase();
}

/** How people say it: "Francisco Narciso Laprida" → "Laprida", "Avenida Pellegrini" → "Pellegrini". */
export function shortStreet(name: string): string {
  const n = name.replace(/^(Avenida|Bulevar|Calle|Pasaje|Peatonal)\s+/i, '');
  const words = n.split(/\s+/);
  if (words.length >= 3 && !/\d|\b(de|del|la|las|los|y)\b/i.test(n)) return words[words.length - 1];
  return n;
}

export function neighbourhoodAt(meta: MapMeta, x: number, y: number): string {
  let best = '';
  let bestD = Infinity;
  for (const n of meta.neighbourhoods) {
    const d = (n.x - x) ** 2 + (n.y - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = n.name;
    }
  }
  return best;
}

/** Lowest phase whose rectangle contains the point (phases are ordered 1, 2, 3). */
export function phaseAt(meta: MapMeta, x: number, y: number): number {
  for (const p of meta.phases) {
    const [x0, y0, x1, y1] = p.rect;
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return p.id;
  }
  return meta.phases[meta.phases.length - 1]?.id ?? 1;
}

export const angleDiff = (a: number, b: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
