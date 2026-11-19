// Traffic and police drivers. Traffic follows the OSM road graph (lanes, one-way
// streets); police plan over the same graph ignoring one-way rules and go
// straight for the player once they can see them.

import type { Edge } from '../map/format.ts';
import type { CarControls } from '../physics/car.ts';
import { forwardSpeed } from '../physics/car.ts';
import { angleDiff, pointAt, polylineLength, projectOnto } from '../world/geo.ts';
import type { NodeLink, World } from '../world/world.ts';
import type { DriverAI, Vehicle } from '../entities.ts';
import { cruiseSpeed } from '../map/roads.ts';

const reversed = new WeakMap<Edge, Float32Array>();
const lengths = new WeakMap<Edge, number>();

export function travelPts(edge: Edge, forward: boolean): Float32Array {
  if (forward) return edge.pts;
  let r = reversed.get(edge);
  if (!r) {
    r = new Float32Array(edge.pts.length);
    for (let i = 0; i < edge.pts.length; i += 2) {
      r[edge.pts.length - 2 - i] = edge.pts[i];
      r[edge.pts.length - 1 - i] = edge.pts[i + 1];
    }
    reversed.set(edge, r);
  }
  return r;
}

export function edgeLength(edge: Edge): number {
  let l = lengths.get(edge);
  if (l === undefined) {
    l = polylineLength(edge.pts);
    lengths.set(edge, l);
  }
  return l;
}

export const endNode = (l: { edge: Edge; forward: boolean }) => (l.forward ? l.edge.to : l.edge.from);
export const startNode = (l: { edge: Edge; forward: boolean }) => (l.forward ? l.edge.from : l.edge.to);

/** Metres right of the centre line for a car on this edge (we drive on the right). */
export function laneOffset(edge: Edge, rnd = Math.random()): number {
  if (!edge.oneway) return Math.min(edge.width / 4, 2.2);
  if (edge.lanes <= 1) return 0;
  const lane = Math.floor(rnd * edge.lanes);
  return ((lane + 0.5) / edge.lanes - 0.5) * edge.width * 0.75;
}

/** Random next link out of the node at the end of `l`, avoiding U-turns when possible. */
export function pickNext(world: World, l: NodeLink, rnd = Math.random): NodeLink | null {
  const options = world.linksFrom(endNode(l));
  const onward = options.filter((o) => o.edge.id !== l.edge.id);
  const list = onward.length ? onward : options;
  if (!list.length) return null;
  return list[Math.floor(rnd() * list.length)];
}

/** A* over loaded edges, ignoring one-way rules. Returns the links to drive, in order. */
export function planPath(
  world: World,
  from: number,
  to: number,
  nodePos: (n: number) => [number, number] | null,
  maxExpand = 3000,
): NodeLink[] {
  if (from === to) return [];
  const goal = nodePos(to);
  if (!goal) return [];
  const h = (n: number) => {
    const p = nodePos(n);
    return p ? Math.hypot(p[0] - goal[0], p[1] - goal[1]) : Infinity;
  };
  const g = new Map<number, number>([[from, 0]]);
  const came = new Map<number, NodeLink>();
  const open: [number, number][] = [[h(from), from]];
  const closed = new Set<number>();
  let expanded = 0;
  while (open.length && expanded < maxExpand) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [, node] = open.splice(bi, 1)[0];
    if (node === to) break;
    if (closed.has(node)) continue;
    closed.add(node);
    expanded++;
    for (const link of world.anyLinksFrom(node)) {
      const nb = endNode(link);
      const cost = g.get(node)! + edgeLength(link.edge);
      if (cost < (g.get(nb) ?? Infinity)) {
        g.set(nb, cost);
        came.set(nb, link);
        open.push([cost + h(nb), nb]);
      }
    }
  }
  if (!came.has(to)) return [];
  const path: NodeLink[] = [];
  let n = to;
  while (n !== from) {
    const link = came.get(n)!;
    path.unshift(link);
    n = startNode(link);
  }
  return path;
}

export function makeDriver(edge: Edge, forward: boolean, mode: DriverAI['mode'] = 'traffic'): DriverAI {
  return {
    mode,
    edge,
    forward,
    next: null,
    lane: laneOffset(edge),
    cruise: cruiseSpeed(edge.cls) * (0.85 + Math.random() * 0.3),
    path: [],
    repath: 0,
    stuck: 0,
    reversing: 0,
    fireCooldown: 1,
  };
}

export interface DriveContext {
  world: World;
  /** Distance to the closest thing in front of the car, or Infinity. */
  clearance(v: Vehicle): number;
  /** Chase target (the player), when chasing. */
  target: { x: number; y: number } | null;
  /** On foot the police pull up next to you instead of running you over. */
  targetOnFoot?: boolean;
  /** Can the driver see the target directly? */
  canSee(v: Vehicle): boolean;
  chaseSpeed: number;
}

/** Computes this tick's controls for an AI-driven vehicle. Returns null to despawn it. */
export function driveAI(v: Vehicle, dt: number, ctx: DriveContext, depth = 0): CarControls | null {
  const ai = v.ai!;
  const speed = forwardSpeed(v);
  const ctl: CarControls = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  if (ai.mode === 'parked') {
    ctl.brake = speed > 0.2 ? 1 : 0;
    return ctl;
  }

  // getting unstuck: back up with the wheel turned the other way
  if (ai.reversing > 0) {
    ai.reversing -= dt;
    ctl.brake = 1;
    ctl.steer = ai.lane >= 0 ? -1 : 1;
    return ctl;
  }

  let tx: number;
  let ty: number;
  let wanted = ai.cruise;

  if (ai.mode === 'chase' && ctx.target && ctx.canSee(v)) {
    tx = ctx.target.x;
    ty = ctx.target.y;
    wanted = ctx.chaseSpeed;
    if (ctx.targetOnFoot) {
      const d = Math.hypot(tx - v.x, ty - v.y);
      wanted = Math.min(wanted, Math.max(0, (d - 4.5) * 1.3));
    }
    ai.path = [];
  } else {
    if (ai.mode === 'chase') {
      ai.repath -= dt;
      wanted = ctx.chaseSpeed * 0.85;
    }
    const pts = travelPts(ai.edge, ai.forward);
    const len = edgeLength(ai.edge);
    const { s } = projectOnto(pts, v.x, v.y);
    const look = 4 + Math.abs(speed) * 0.55;
    if (s >= len - 0.5) {
      const nxt = ai.next ?? choose(ai, ctx);
      if (!nxt) return null;
      ai.edge = nxt.edge;
      ai.forward = nxt.forward;
      ai.next = null;
      if (ai.mode === 'traffic') ai.lane = laneOffset(nxt.edge);
      else ai.lane = 0;
      ai.cruise = cruiseSpeed(nxt.edge.cls) * (0.85 + Math.random() * 0.3);
      return depth < 4 ? driveAI(v, dt, ctx, depth + 1) : ctl;
    }
    let p: { x: number; y: number; dx: number; dy: number };
    if (s + look > len) {
      ai.next ??= choose(ai, ctx);
      if (ai.next) {
        p = pointAt(travelPts(ai.next.edge, ai.next.forward), s + look - len);
        // slow down for the corner
        const here = pointAt(pts, len - 0.1);
        const turn = Math.abs(angleDiff(Math.atan2(here.dy, here.dx), Math.atan2(p.dy, p.dx)));
        if (turn > 0.5) wanted = Math.min(wanted, ai.mode === 'chase' ? 11 : 6.5);
      } else {
        p = pointAt(pts, len);
        wanted = Math.min(wanted, Math.max(0, (len - s) * 0.8));
      }
    } else {
      p = pointAt(pts, s + look);
    }
    tx = p.x - p.dy * ai.lane;
    ty = p.y + p.dx * ai.lane;
  }

  const desired = Math.atan2(ty - v.y, tx - v.x);
  const err = angleDiff(v.heading, desired);
  ctl.steer = Math.max(-1, Math.min(1, err * 2.5));
  if (Math.abs(err) > 1.2) wanted = Math.min(wanted, 5);

  if (ai.mode === 'traffic') {
    const gap = ctx.clearance(v);
    if (gap < 3 + speed * 1.1) wanted = 0;
  }

  if (speed < wanted - 0.5) ctl.throttle = Math.min(1, (wanted - speed) / 3 + 0.3);
  else if (speed > wanted + 1) ctl.brake = Math.min(1, (speed - wanted) / 4);

  // stuck against something while trying to move
  if (ctl.throttle > 0 && Math.abs(speed) < 0.6) {
    ai.stuck += dt;
    if (ai.stuck > (ai.mode === 'chase' ? 0.9 : 2.5)) {
      ai.stuck = 0;
      ai.reversing = 1.1;
    }
  } else {
    ai.stuck = Math.max(0, ai.stuck - dt);
  }
  return ctl;
}

function choose(ai: DriverAI, ctx: DriveContext): NodeLink | null {
  const here = { edge: ai.edge, forward: ai.forward };
  if (ai.mode === 'chase' && ctx.target) {
    if (ai.path.length && ai.path[0].edge.id === ai.edge.id) ai.path.shift();
    if (!ai.path.length || ai.repath <= 0) {
      ai.repath = 1.5;
      const goal = nearestNode(ctx.world, ctx.target.x, ctx.target.y);
      if (goal !== null)
        ai.path = planPath(ctx.world, endNode(here), goal, (n) => nodePosition(ctx.world, n));
    }
    if (ai.path.length && startNode(ai.path[0]) === endNode(here)) return ai.path.shift()!;
    const any = ctx.world.anyLinksFrom(endNode(here)).filter((l) => l.edge.id !== ai.edge.id);
    if (any.length) return any[Math.floor(Math.random() * any.length)];
  }
  return pickNext(ctx.world, here);
}

export function nodePosition(world: World, node: number): [number, number] | null {
  const links = world.anyLinksFrom(node);
  if (!links.length) return null;
  const l = links[0];
  const pts = l.edge.pts;
  return l.forward ? [pts[0], pts[1]] : [pts[pts.length - 2], pts[pts.length - 1]];
}

export function nearestNode(world: World, x: number, y: number): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (const e of world.edgesNear(x, y)) {
    const n = e.pts.length;
    const da = (e.pts[0] - x) ** 2 + (e.pts[1] - y) ** 2;
    const db = (e.pts[n - 2] - x) ** 2 + (e.pts[n - 1] - y) ** 2;
    if (da < bestD) {
      bestD = da;
      best = e.from;
    }
    if (db < bestD) {
      bestD = db;
      best = e.to;
    }
  }
  return best;
}
