// Road tagging rules and the road-graph builder used by the map pipeline.

import { RoadClass } from './format.ts';

export type Tags = Record<string, string | undefined>;

const CLASS_BY_HIGHWAY: Record<string, number> = {
  motorway: RoadClass.Motorway,
  motorway_link: RoadClass.Motorway,
  trunk: RoadClass.Motorway,
  trunk_link: RoadClass.Motorway,
  primary: RoadClass.Primary,
  primary_link: RoadClass.Primary,
  secondary: RoadClass.Secondary,
  secondary_link: RoadClass.Secondary,
  tertiary: RoadClass.Tertiary,
  tertiary_link: RoadClass.Tertiary,
  unclassified: RoadClass.Residential,
  residential: RoadClass.Residential,
  living_street: RoadClass.Residential,
  road: RoadClass.Residential,
  service: RoadClass.Service,
};

const PED_HIGHWAYS = new Set(['pedestrian', 'footway', 'path', 'steps', 'cycleway', 'track']);

/** Road class for drivable ways, or null for anything traffic should not use. */
export function roadClass(tags: Tags): number | null {
  const hw = tags.highway;
  if (!hw) return null;
  if (tags.area === 'yes') return null;
  if (hw === 'service' && /parking_aisle|driveway|drive-through/.test(tags.service ?? '')) return null;
  if (tags.access === 'no' || tags.access === 'private') return null;
  return CLASS_BY_HIGHWAY[hw] ?? null;
}

export function isPedestrianWay(tags: Tags): boolean {
  return PED_HIGHWAYS.has(tags.highway ?? '');
}

/** 1 = forward only, -1 = against the drawn direction only, 0 = both ways. */
export function onewayDir(tags: Tags): -1 | 0 | 1 {
  const o = tags.oneway;
  if (o === '-1' || o === 'reverse') return -1;
  if (o === 'yes' || o === 'true' || o === '1') return 1;
  if (o === 'no') return 0;
  if (tags.junction === 'roundabout' || tags.junction === 'circular') return 1;
  if (tags.highway === 'motorway' || tags.highway === 'motorway_link') return 1;
  return 0;
}

export function laneCount(tags: Tags, cls: number, oneway: boolean): number {
  const n = parseInt(tags.lanes ?? '', 10);
  if (n > 0 && n < 12) return n;
  if (cls === RoadClass.Motorway) return oneway ? 2 : 4;
  if (cls === RoadClass.Primary) return oneway ? 3 : 4;
  if (cls === RoadClass.Secondary || cls === RoadClass.Tertiary) return oneway ? 2 : 2;
  if (cls === RoadClass.Service) return 1;
  return 2;
}

/** Carriageway width in metres. A bit wider than real life so cars fit side by side. */
export function roadWidth(lanes: number): number {
  return Math.min(22, Math.max(7, lanes * 3.5 + 1));
}

/** Cruise speed for traffic, in m/s. */
export function cruiseSpeed(cls: number): number {
  return [22, 14, 13, 12, 10, 6][cls] ?? 10;
}

export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(avenida|av\.?|bulevar|boulevard|bv\.?|calle|pasaje|pje\.?|peatonal)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the OSM street name matches a short query like "Oroño" or "La Rioja". */
export function nameMatches(osmName: string, query: string): boolean {
  const a = ` ${normalizeName(osmName)} `;
  const q = normalizeName(query);
  return q.length > 0 && a.includes(` ${q} `);
}

export interface WayInput {
  nodes: number[];
  /** World metres, flattened. Same length as nodes × 2. */
  pts: number[];
  tags: Tags;
}

export interface GraphEdge {
  from: number;
  to: number;
  pts: number[];
  name: string;
  cls: number;
  lanes: number;
  oneway: boolean;
  width: number;
}

/**
 * Splits drivable ways at shared nodes (intersections) into graph edges.
 * Node ids in the result are compact indexes; `nodePos` gives their positions.
 */
export function buildGraph(ways: WayInput[]) {
  const drivable = ways
    .map((w) => ({ w, cls: roadClass(w.tags) }))
    .filter((d): d is { w: WayInput; cls: number } => d.cls !== null && d.w.nodes.length >= 2);

  const uses = new Map<number, number>();
  for (const { w } of drivable) {
    w.nodes.forEach((id, i) => {
      // a way's own endpoints always split
      const add = i === 0 || i === w.nodes.length - 1 ? 2 : 1;
      uses.set(id, (uses.get(id) ?? 0) + add);
    });
  }

  const index = new Map<number, number>();
  const nodePos: number[] = [];
  const nodeId = (osm: number, x: number, y: number) => {
    let id = index.get(osm);
    if (id === undefined) {
      id = index.size;
      index.set(osm, id);
      nodePos.push(x, y);
    }
    return id;
  };

  const edges: GraphEdge[] = [];
  for (const { w, cls } of drivable) {
    const dir = onewayDir(w.tags);
    const lanes = laneCount(w.tags, cls, dir !== 0);
    const name = w.tags.name ?? w.tags.ref ?? '';
    let start = 0;
    for (let i = 1; i < w.nodes.length; i++) {
      if ((uses.get(w.nodes[i]) ?? 0) < 2 && i < w.nodes.length - 1) continue;
      let pts = w.pts.slice(start * 2, i * 2 + 2);
      let a = w.nodes[start];
      let b = w.nodes[i];
      if (dir === -1) {
        const rev: number[] = [];
        for (let k = pts.length - 2; k >= 0; k -= 2) rev.push(pts[k], pts[k + 1]);
        pts = rev;
        [a, b] = [b, a];
      }
      const from = nodeId(a, pts[0], pts[1]);
      const to = nodeId(b, pts[pts.length - 2], pts[pts.length - 1]);
      if (from !== to || pts.length > 4) {
        edges.push({ from, to, pts, name, cls, lanes, oneway: dir !== 0, width: roadWidth(lanes) });
      }
      start = i;
    }
  }
  return { edges, nodePos };
}
