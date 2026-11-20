// Turns the raw OSM download (.cache/osm) into game data under public/map:
//   meta.json        world size, street names, places, neighbourhoods, phases, landmarks
//   overview.bin     coarse whole-city grid for the map screen
//   c/<cx>_<cy>.bin  tile chunks with their road-graph edges and vector shapes
//
// Street widths come from the city itself: the distance between the building
// lines on both sides of each street, measured on the OSM footprints and
// smoothed per street name. Blocks that OSM leaves empty get generated lots
// along their street fronts, so the city reads as built up the way it is.
//
// Map data © OpenStreetMap contributors, ODbL 1.0. The output is a derived
// database and stays under the ODbL (see public/map/LICENSE.md).

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { BBOX, CHUNK, LANDMARKS, PHASES, PLACES, TILE_M } from './config.ts';
import { makeProjection } from '../../src/game/map/projection.ts';
import { assembleRings, fillPolygon, strokePolyline, type Ring } from '../../src/game/map/raster.ts';
import {
  clipPolyline,
  clipRing,
  insideRings,
  lineLength,
  offsetPolyline,
  openRing,
  ringArea,
  ringBounds,
  ringCentroid,
  simplify,
} from '../../src/game/map/geometry.ts';
import {
  EdgeFlag,
  Line,
  RoadClass,
  Shape,
  Tile,
  encodeChunk,
  encodeOverview,
  packTile,
  tileType,
  type Edge,
  type Landmark,
  type LineData,
  type MapMeta,
  type ShapeData,
} from '../../src/game/map/format.ts';
import {
  buildGraph,
  corridorRange,
  defaultCorridor,
  isPedestrianWay,
  lanesFor,
  nameMatches,
  splitCorridor,
  type Tags,
  type WayInput,
} from '../../src/game/map/roads.ts';

const SRC = '.cache/osm';
const OUT = 'public/map';
const OVERVIEW_CELL = 4; // tiles per overview cell (16 m)
const FINE = 2; // metres per cell of the fine masks used for measuring and lot placement

interface LatLon {
  lat: number;
  lon: number;
}
interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  geometry?: (LatLon | null)[];
  members?: { type: string; role: string; geometry?: (LatLon | null)[] }[];
  tags?: Tags;
}

const t0 = Date.now();
const log = (msg: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

// ---- load and dedupe ----------------------------------------------------------
const byKey = new Map<string, OsmElement>();
for (const f of (await readdir(SRC)).filter((f) => f.endsWith('.json')).sort()) {
  const json = JSON.parse(await readFile(`${SRC}/${f}`, 'utf8')) as { elements: OsmElement[] };
  for (const e of json.elements) {
    const k = `${e.type}/${e.id}`;
    const prev = byKey.get(k);
    // keep the copy with geometry (tag-only copies come from narrower queries)
    if (!prev || (!prev.geometry && !prev.members)) byKey.set(k, e);
  }
}
const elements = [...byKey.values()];
log(`${elements.length} unique OSM elements`);

const proj = makeProjection(BBOX);
const [maxX] = proj.toWorld(BBOX[0], BBOX[3]);
const [, maxY] = proj.toWorld(BBOX[0], BBOX[1]);
const cols = Math.ceil(maxX / TILE_M / CHUNK) * CHUNK;
const rows = Math.ceil(maxY / TILE_M / CHUNK) * CHUNK;
const grid = { cols, rows, tileM: TILE_M };
const tiles = new Uint8Array(cols * rows); // Tile.Ground everywhere
const heights = new Uint8Array(cols * rows);
const widthM = cols * TILE_M;
const heightM = rows * TILE_M;
log(`grid ${cols}×${rows} tiles (${widthM / 1000}×${heightM / 1000} km)`);

const toPts = (geom: (LatLon | null)[] | undefined): number[] => {
  const out: number[] = [];
  for (const g of geom ?? []) {
    if (!g) continue;
    const [x, y] = proj.toWorld(g.lat, g.lon);
    out.push(x, y);
  }
  return out;
};
const isClosed = (p: number[]) => p.length >= 8 && p[0] === p[p.length - 2] && p[1] === p[p.length - 1];

const ringsOf = (e: OsmElement): Ring[] => {
  if (e.type === 'way') {
    const p = toPts(e.geometry);
    return isClosed(p) ? [p] : [];
  }
  if (e.type === 'relation') {
    return assembleRings(
      (e.members ?? []).filter((m) => m.type === 'way').map((m) => toPts(m.geometry)),
    ).filter((r) => r.length >= 6);
  }
  return [];
};

const hash = (n: number) => {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
};
/** Deterministic pseudo-random stream, so a rebuild gives the same city. */
let seed = 20250;
const rnd = () => {
  seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
  return seed / 4294967296;
};

const set =
  (type: number, variant = 0, guard?: (cur: number) => boolean) =>
  (c: number, r: number) => {
    const i = r * cols + c;
    if (guard && !guard(tileType(tiles[i]))) return;
    tiles[i] = packTile(type, variant);
    if (type !== Tile.Building) heights[i] = 0;
  };

const [p1s, p1w, p1n, p1e] = PHASES[0].rect;
const [cx0, cy0] = proj.toWorld(p1n, p1w);
const [cx1, cy1] = proj.toWorld(p1s, p1e);
const inCentro = (x: number, y: number) => x >= cx0 && x <= cx1 && y >= cy0 && y <= cy1;

// ---- landmarks ------------------------------------------------------------------
const landmarkOf = new Map<string, number>(); // "way/123" → 1-based landmark index
LANDMARKS.forEach((l, i) => {
  for (const ref of l.osm) landmarkOf.set(`${ref[0] === 'w' ? 'way' : 'relation'}/${ref.slice(1)}`, i + 1);
});
const BUILDING_KINDS = new Set([
  'church',
  'civic',
  'museum',
  'theatre',
  'stadium',
  'arena',
  'silos',
  'warehouse',
  'station',
  'mall',
  'tower',
  'hospital',
]);
const KIND_HEIGHT: Record<string, number> = {
  church: 24,
  civic: 18,
  museum: 12,
  theatre: 16,
  stadium: 20,
  arena: 16,
  silos: 34,
  warehouse: 9,
  station: 12,
  mall: 12,
  tower: 90,
  hospital: 18,
};

// ---- shapes ---------------------------------------------------------------------
interface AreaRec {
  kind: number;
  rings: number[][];
  landmark: number;
  variant: number;
}
interface BuildingRec {
  rings: number[][];
  height: number;
  variant: number;
  landmark: number;
}
const areas: AreaRec[] = [];
const buildings: BuildingRec[] = [];
const lines: LineData[] = [];
const landmarkPoint = new Map<number, [number, number]>();

const tag = (e: OsmElement, k: string) => e.tags?.[k] ?? '';
const areaKind = (e: OsmElement): number => {
  const leisure = tag(e, 'leisure');
  const landuse = tag(e, 'landuse');
  const natural = tag(e, 'natural');
  if (natural === 'water' || tag(e, 'waterway') === 'riverbank' || (e.type === 'relation' && tag(e, 'water')))
    return Shape.Water;
  if (/^(sand|beach)$/.test(natural)) return Shape.Sand;
  if (landuse === 'cemetery') return Shape.Cemetery;
  if (leisure === 'pitch') return Shape.Pitch;
  if (leisure === 'track' && tag(e, 'area') === 'yes') return Shape.Track;
  if (leisure === 'stadium') return Shape.Grass;
  if (tag(e, 'aeroway') === 'apron') return Shape.Apron;
  if (tag(e, 'aeroway') === 'aerodrome') return Shape.Grass;
  if (tag(e, 'man_made') === 'bridge') return Shape.Bridge;
  if (tag(e, 'amenity') === 'parking') return Shape.Parking;
  if (tag(e, 'highway') === 'pedestrian' && tag(e, 'area') === 'yes') return Shape.Plaza;
  if (/^(park|garden|playground|common|nature_reserve)$/.test(leisure)) return Shape.Park;
  if (/^(grass|recreation_ground|village_green|meadow)$/.test(landuse)) return Shape.Park;
  if (/^(forest)$/.test(landuse) || /^(wood|scrub)$/.test(natural)) return Shape.Park;
  if (/^(grassland|wetland)$/.test(natural)) return Shape.Grass;
  if (tag(e, 'place') === 'islet') return Shape.Grass;
  return 0;
};
const AREA_ORDER = [
  Shape.Grass,
  Shape.Park,
  Shape.Cemetery,
  Shape.Sand,
  Shape.Water,
  Shape.Apron,
  Shape.Parking,
  Shape.Plaza,
  Shape.Pitch,
  Shape.Track,
  Shape.Bridge,
];
const AREA_TILE: Record<number, [number, number]> = {
  [Shape.Grass]: [Tile.Park, 2],
  [Shape.Park]: [Tile.Park, 0],
  [Shape.Cemetery]: [Tile.Park, 4],
  [Shape.Sand]: [Tile.Sand, 0],
  [Shape.Water]: [Tile.Water, 0],
  [Shape.Apron]: [Tile.Plaza, 2],
  [Shape.Parking]: [Tile.Plaza, 1],
  [Shape.Plaza]: [Tile.Plaza, 0],
  [Shape.Pitch]: [Tile.Park, 1],
  [Shape.Track]: [Tile.Sand, 1],
  [Shape.Bridge]: [Tile.Plaza, 3],
};
const LANDMARK_AREA: Record<string, number> = {
  park: Shape.Park,
  garden: Shape.Park,
  beach: Shape.Sand,
  plaza: Shape.Plaza,
  cemetery: Shape.Cemetery,
  airport: Shape.Grass,
  racecourse: Shape.Grass,
  sport: Shape.Grass,
  bridge: Shape.Bridge,
  district: 0,
};

const pendingAreas: AreaRec[] = [];
for (const e of elements) {
  const key = `${e.type}/${e.id}`;
  const lm = landmarkOf.get(key) ?? 0;
  const conf = lm ? LANDMARKS[lm - 1] : null;
  if (conf && (BUILDING_KINDS.has(conf.kind) || conf.kind === 'monument')) continue;
  if (e.tags?.building && !conf) continue;
  const kind = conf ? LANDMARK_AREA[conf.kind] || areaKind(e) : areaKind(e);
  if (!kind) continue;
  const rings = ringsOf(e).map((r) => simplify(openRing(r), kind === Shape.Water ? 1.5 : 0.6));
  if (!rings.length) continue;
  pendingAreas.push({
    kind,
    rings,
    landmark: lm,
    variant: /forest|wood/.test(tag(e, 'landuse') + tag(e, 'natural')) ? 1 : 0,
  });
}
for (const k of AREA_ORDER) for (const a of pendingAreas) if (a.kind === k) areas.push(a);
for (const a of areas) {
  const [t, v] = AREA_TILE[a.kind];
  fillPolygon(
    a.rings,
    grid,
    set(t, v, a.kind === Shape.Bridge ? undefined : (cur) => a.kind === Shape.Water || cur !== Tile.Water),
  );
}
// rivers and streams drawn as lines in OSM
for (const e of elements) {
  if (e.type !== 'way' || !e.tags?.waterway || e.tags.tunnel) continue;
  const half = ({ river: 15, canal: 5, stream: 3 } as Record<string, number>)[e.tags.waterway];
  if (!half) continue;
  const pts = toPts(e.geometry);
  strokePolyline(pts, half, grid, set(Tile.Water));
  for (const ring of strokeOutline(pts, half))
    areas.push({ kind: Shape.Water, rings: [ring], landmark: 0, variant: 0 });
}
log(`${areas.length} areas`);

/** A thick polyline as one quad per segment, good enough for rivers and streams. */
function strokeOutline(pts: number[], half: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const seg = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
    const a = offsetPolyline(seg, half);
    const b = offsetPolyline(seg, -half);
    out.push([a[0], a[1], a[2], a[3], b[2], b[3], b[0], b[1]]);
  }
  return out;
}

// ---- buildings ------------------------------------------------------------------
const floorsDefault = (x: number, y: number, n: number) => {
  const r = (hash(n) % 1000) / 1000;
  if (inCentro(x, y)) return r < 0.3 ? 2 : r < 0.6 ? 3 + (n % 3) : r < 0.88 ? 6 + (n % 6) : 12 + (n % 10);
  return r < 0.55 ? 1 : r < 0.88 ? 2 : 3 + (n % 3);
};
const addBuilding = (rings: number[][], h: number, variant: number, landmark: number) => {
  const rs = rings.map((r) => simplify(openRing(r), 0.25)).filter((r) => r.length >= 6);
  if (!rs.length) return;
  buildings.push({ rings: rs, height: Math.max(3, Math.min(250, Math.round(h))), variant, landmark });
  fillPolygon(rs, grid, (c, r) => {
    const i = r * cols + c;
    if (tileType(tiles[i]) === Tile.Water) return;
    tiles[i] = packTile(Tile.Building, variant & 7);
    heights[i] = Math.min(255, Math.round(h / 3));
  });
};
const tagHeight = (e: OsmElement) => {
  const levels = parseFloat(e.tags?.['building:levels'] ?? '');
  const metres = parseFloat(e.tags?.height ?? '');
  return metres > 0 ? metres : levels > 0 ? levels * 3.1 : 0;
};
let osmBuildings = 0;
for (const e of elements) {
  const lm = landmarkOf.get(`${e.type}/${e.id}`) ?? 0;
  if (lm) continue;
  if (!e.tags?.building || e.tags.building === 'roof') continue;
  const rings = ringsOf(e);
  if (!rings.length) continue;
  const [x, y] = ringCentroid(rings[0]);
  const h = tagHeight(e) || floorsDefault(x, y, e.id) * 3;
  addBuilding(rings, h, hash(e.id) % 16, 0);
  osmBuildings++;
}
// landmark buildings and the Monumento
/** Building variant that marks the Monumento's tower (the rest of the precinct is stone). */
const TOWER_VARIANT = 200;
let monumentPrecinct: { rings: number[][]; lm: number } | null = null;
for (const e of elements) {
  const lm = landmarkOf.get(`${e.type}/${e.id}`) ?? 0;
  if (!lm) continue;
  const conf = LANDMARKS[lm - 1];
  const rings = ringsOf(e);
  if (!rings.length) {
    // a line (a pedestrian passage): label its middle
    const pts = toPts(e.geometry);
    const k = Math.floor(pts.length / 4) * 2;
    if (pts.length >= 2 && !landmarkPoint.has(lm)) landmarkPoint.set(lm, [pts[k], pts[k + 1]]);
    continue;
  }
  const biggest = rings.reduce((a, b) => (Math.abs(ringArea(b)) > Math.abs(ringArea(a)) ? b : a));
  let [lx, ly] = ringCentroid(biggest);
  if (!insideRings(rings, lx, ly)) {
    const [bx0, by0, bx1, by1] = ringBounds(biggest);
    [lx, ly] = [(bx0 + bx1) / 2, (by0 + by1) / 2];
  }
  if (conf.kind === 'monument') {
    // The memorial: a travertine courtyard (Patio Cívico) and the 70 m tower at
    // its river end. OSM maps the whole precinct as one polygon.
    areas.push({
      kind: Shape.Plaza,
      rings: rings.map((r) => simplify(openRing(r), 0.5)),
      landmark: lm,
      variant: 5,
    });
    fillPolygon(rings, grid, set(Tile.Plaza, 5));
    let ex = -Infinity,
      ey = 0;
    for (const r of rings)
      for (let i = 0; i < r.length; i += 2)
        if (r[i] > ex) {
          ex = r[i];
          ey = r[i + 1];
        }
    const tx = ex - 22;
    const ty = (ey + ly) / 2;
    const s = 9;
    addBuilding([[tx - s, ty - s, tx + s, ty - s, tx + s, ty + s, tx - s, ty + s]], 70, TOWER_VARIANT, lm);
    landmarkPoint.set(lm, [tx, ty]);
    monumentPrecinct = { rings, lm };
    continue;
  }
  if (BUILDING_KINDS.has(conf.kind))
    addBuilding(rings, tagHeight(e) || KIND_HEIGHT[conf.kind], hash(e.id) % 16, lm);
  if (!landmarkPoint.has(lm)) landmarkPoint.set(lm, [lx, ly]);
}
// the other buildings of the precinct (the Propileo, the halls) wear the same stone
if (monumentPrecinct) {
  for (const b of buildings) {
    if (b.landmark) continue;
    const [x, y] = ringCentroid(b.rings[0]);
    if (insideRings(monumentPrecinct.rings, x, y)) {
      b.landmark = monumentPrecinct.lm;
      b.height = Math.max(b.height, 12);
    }
  }
}
log(`${osmBuildings} OSM buildings, ${buildings.length - osmBuildings} landmark buildings`);

// ---- ways -----------------------------------------------------------------------
const highways: (WayInput & { id: number })[] = [];
for (const e of elements) {
  if (e.type !== 'way' || !e.tags?.highway || !e.nodes) continue;
  const pts = toPts(e.geometry);
  if (pts.length / 2 !== e.nodes.length) continue;
  highways.push({ id: e.id, nodes: e.nodes, pts, tags: e.tags });
}
const { edges: graphEdges } = buildGraph(highways.filter((w) => !w.tags.tunnel));
log(`${graphEdges.length} road edges`);

// ---- fine building mask, for measuring street widths -------------------------
const fcols = Math.ceil(widthM / FINE);
const frows = Math.ceil(heightM / FINE);
const fgrid = { cols: fcols, rows: frows, tileM: FINE };
const fine = new Uint8Array(fcols * frows); // 1 = building, 2 = street corridor, 3 = other use
for (const b of buildings) fillPolygon(b.rings, fgrid, (c, r) => (fine[r * fcols + c] = 1));
const fineAt = (x: number, y: number) => {
  const c = Math.floor(x / FINE);
  const r = Math.floor(y / FINE);
  return c < 0 || r < 0 || c >= fcols || r >= frows ? 3 : fine[r * fcols + c];
};
const tileAt = (x: number, y: number) => {
  const c = Math.floor(x / TILE_M);
  const r = Math.floor(y / TILE_M);
  return c < 0 || r < 0 || c >= cols || r >= rows ? Tile.Water : tileType(tiles[r * cols + c]);
};

/** Distances from a polyline to the first building on each side, sampled every 5 m. */
function measure(pts: ArrayLike<number>): { left: number[]; right: number[] } {
  const left: number[] = [];
  const right: number[] = [];
  const total = lineLength(pts);
  let walked = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i],
      ay = pts[i + 1];
    const dx = pts[i + 2] - ax,
      dy = pts[i + 3] - ay;
    const len = Math.hypot(dx, dy);
    if (len < 0.1) continue;
    const ux = dx / len,
      uy = dy / len;
    for (let t = 2.5; t < len; t += 5) {
      const along = walked + t;
      if (along < 14 || along > total - 14) continue; // keep clear of the crossing streets
      const px = ax + ux * t,
        py = ay + uy * t;
      for (const [side, out] of [
        [1, right],
        [-1, left],
      ] as const) {
        const nx = -uy * side,
          ny = ux * side;
        for (let d = 2; d <= 32; d += 0.5) {
          const qx = px + nx * d,
            qy = py + ny * d;
          if (tileAt(qx, qy) === Tile.Water) break;
          if (fineAt(qx, qy) === 1) {
            out.push(d);
            break;
          }
        }
      }
    }
    walked += len;
  }
  return { left, right };
}
const median = (a: number[]) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

// ---- dual carriageways (boulevards) -------------------------------------------
interface Dual {
  partner: number;
  gap: number;
  side: number;
}
function segNear(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax,
    dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx,
    y = ay + t * dy;
  return { d: (x - px) ** 2 + (y - py) ** 2, x, y };
}
const dual = new Map<number, Dual>();
{
  const byName = new Map<string, number[]>();
  graphEdges.forEach((e, i) => {
    if (!e.oneway || !e.name || e.cls > RoadClass.Tertiary || e.cls === RoadClass.Motorway) return;
    const list = byName.get(e.name) ?? [];
    list.push(i);
    byName.set(e.name, list);
  });
  const mid = (p: number[]) => {
    const n = p.length / 2;
    const k = Math.max(0, Math.floor((n - 2) / 2));
    return [
      (p[k * 2] + p[k * 2 + 2]) / 2,
      (p[k * 2 + 1] + p[k * 2 + 3]) / 2,
      p[k * 2 + 2] - p[k * 2],
      p[k * 2 + 3] - p[k * 2 + 1],
    ];
  };
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    for (const i of list) {
      const a = graphEdges[i];
      const [mx, my, dx, dy] = mid(a.pts);
      const len = Math.hypot(dx, dy) || 1;
      let best: Dual | null = null;
      for (const j of list) {
        if (j === i) continue;
        const b = graphEdges[j];
        let bestD = Infinity,
          bx = 0,
          by = 0,
          bdx = 0,
          bdy = 0;
        for (let k = 0; k + 3 < b.pts.length; k += 2) {
          const d2 = segNear(mx, my, b.pts[k], b.pts[k + 1], b.pts[k + 2], b.pts[k + 3]);
          if (d2.d < bestD) {
            bestD = d2.d;
            bx = d2.x;
            by = d2.y;
            bdx = b.pts[k + 2] - b.pts[k];
            bdy = b.pts[k + 3] - b.pts[k + 1];
          }
        }
        const gap = Math.sqrt(bestD);
        if (gap < 6 || gap > 70) continue;
        const cos = (dx * bdx + dy * bdy) / (len * (Math.hypot(bdx, bdy) || 1));
        if (cos > -0.9) continue; // must run the other way, side by side
        const side = Math.sign(-dy * (bx - mx) + dx * (by - my)) || 1;
        if (!best || gap < best.gap) best = { partner: j, gap, side };
      }
      if (best) dual.set(i, best);
    }
  }
}
log(`${dual.size} boulevard carriageways`);

// ---- street widths ----------------------------------------------------------------
interface Width {
  width: number;
  sidewalk: number;
}
const widths: Width[] = [];
{
  const own: (number | null)[] = [];
  const byName = new Map<string, { v: number; w: number }[]>();
  graphEdges.forEach((e, i) => {
    own[i] = null;
    if (dual.has(i) || e.cls === RoadClass.Motorway || e.cls === RoadClass.Service) return;
    const { left, right } = measure(e.pts);
    if (left.length < 3 || right.length < 3) return;
    const corr = median(left) + median(right);
    const [lo, hi] = corridorRange(e.cls);
    if (corr < lo * 0.8 || corr > hi * 1.2) return;
    own[i] = corr;
    const key = `${e.name}|${e.cls}`;
    const list = byName.get(key) ?? [];
    list.push({ v: corr, w: Math.min(left.length, right.length) });
    byName.set(key, list);
  });
  const nameMedian = new Map<string, number>();
  for (const [k, list] of byName) {
    if (list.reduce((s, x) => s + x.w, 0) < 8) continue;
    const exp: number[] = [];
    for (const x of list) for (let n = 0; n < x.w; n++) exp.push(x.v);
    nameMedian.set(k, median(exp));
  }
  let measured = 0,
    fromName = 0;
  graphEdges.forEach((e, i) => {
    if (e.cls === RoadClass.Motorway) {
      widths[i] = { width: Math.max(7, e.lanes * 3.6 + 2), sidewalk: 0 };
      return;
    }
    if (e.cls === RoadClass.Service) {
      widths[i] = { width: 5, sidewalk: 0 };
      return;
    }
    if (dual.has(i)) {
      widths[i] = { width: Math.max(7, Math.min(13, (e.lanes || 2) * 3.3)), sidewalk: 4 };
      return;
    }
    const [lo, hi] = corridorRange(e.cls);
    const nm = nameMedian.get(`${e.name}|${e.cls}`);
    const mine = own[i];
    let corr = mine ?? nm ?? defaultCorridor(e.cls, e.oneway);
    if (mine !== null && nm !== undefined) corr = 0.6 * mine + 0.4 * nm; // smooth block-to-block jumps
    corr = Math.max(lo, Math.min(hi, corr));
    if (mine !== null) measured++;
    else if (nm !== undefined) fromName++;
    widths[i] = splitCorridor(corr, e.cls);
  });
  log(
    `widths: ${measured} measured, ${fromName} from the street's other blocks, ${graphEdges.length - measured - fromName} default`,
  );
}

// ---- rasterise streets ----------------------------------------------------------
const medians: { pts: number[]; width: number }[] = [];
for (const [i, d] of dual) {
  if (i > d.partner && dual.get(d.partner)?.partner === i) continue; // one median per pair
  const a = graphEdges[i];
  const wa = widths[i].width;
  const wb = widths[d.partner].width;
  const w = d.gap - (wa + wb) / 2;
  if (w < 1.2) continue;
  medians.push({ pts: offsetPolyline(a.pts, d.side * (wa / 2 + w / 2)), width: w });
}
graphEdges.forEach((e, i) => {
  const { width, sidewalk } = widths[i];
  if (sidewalk > 0)
    strokePolyline(
      e.pts,
      width / 2 + sidewalk,
      grid,
      set(Tile.Sidewalk, 0, (t) => t !== Tile.Water),
    );
});
for (const m of medians)
  strokePolyline(
    m.pts,
    m.width / 2,
    grid,
    set(Tile.Park, 3, (t) => t !== Tile.Water),
  );
const pedestrian: { pts: number[]; width: number; kind: number }[] = [];
for (const w of highways) {
  if (!isPedestrianWay(w.tags) || w.tags.tunnel || w.tags.area === 'yes') continue;
  if (/^(sidewalk|crossing)$/.test(w.tags.footway ?? '')) continue;
  if (w.tags.highway === 'steps') continue;
  let width = w.tags.highway === 'pedestrian' ? 12 : w.tags.highway === 'cycleway' ? 2.5 : 2;
  if (w.tags.highway === 'pedestrian') {
    const { left, right } = measure(w.pts);
    if (left.length >= 3 && right.length >= 3)
      width = Math.max(6, Math.min(24, median(left) + median(right)));
  }
  const unpaved = !/^(paved|asphalt|concrete|paving_stones)$/.test(w.tags.surface ?? '');
  const kind = /^(path|track)$/.test(w.tags.highway ?? '') && unpaved ? Line.Path : Line.Footway;
  pedestrian.push({ pts: w.pts, width, kind });
  const wide = w.tags.highway === 'pedestrian';
  strokePolyline(
    w.pts,
    width / 2,
    grid,
    set(Tile.Plaza, 0, (t) => t !== Tile.Water && (wide || t !== Tile.Building)),
  );
}
for (const p of pedestrian) lines.push({ kind: p.kind, width: p.width, pts: Float32Array.from(p.pts) });
for (const m of medians) lines.push({ kind: Line.Median, width: m.width, pts: Float32Array.from(m.pts) });
for (const e of elements) {
  if (tag(e, 'railway') === 'rail' && !e.tags?.tunnel) {
    const pts = toPts(e.geometry);
    strokePolyline(
      pts,
      2,
      grid,
      set(Tile.Rail, 0, (t) => t !== Tile.Building && t !== Tile.Water),
    );
    lines.push({ kind: Line.Rail, width: 3, pts: Float32Array.from(pts) });
  }
  if (tag(e, 'leisure') === 'track' && tag(e, 'area') !== 'yes' && e.type === 'way') {
    const pts = toPts(e.geometry);
    const w = parseFloat(tag(e, 'width')) || 12;
    strokePolyline(
      pts,
      w / 2,
      grid,
      set(Tile.Sand, 1, (t) => t !== Tile.Building && t !== Tile.Water),
    );
    lines.push({ kind: Line.Track, width: w, pts: Float32Array.from(pts) });
  }
  if (tag(e, 'aeroway') === 'runway' && e.type === 'way') {
    const pts = toPts(e.geometry);
    const w = parseFloat(tag(e, 'width')) || 45;
    strokePolyline(pts, w / 2, grid, set(Tile.Road, 1));
    lines.push({ kind: Line.Runway, width: w, pts: Float32Array.from(pts) });
  }
}
graphEdges.forEach((e, i) =>
  strokePolyline(e.pts, widths[i].width / 2, grid, set(Tile.Road, e.cls <= 1 ? 1 : 0)),
);
log('streets');

// ---- generated lots ---------------------------------------------------------------
// Fine mask: 1 building, 2 street corridor, 3 anything else that isn't a lot.
{
  graphEdges.forEach((e, i) =>
    strokePolyline(e.pts, widths[i].width / 2 + widths[i].sidewalk + 0.4, fgrid, (c, r) => {
      if (fine[r * fcols + c] === 0) fine[r * fcols + c] = 2;
    }),
  );
  for (const m of medians) strokePolyline(m.pts, m.width / 2, fgrid, (c, r) => (fine[r * fcols + c] ||= 2));
  for (const p of pedestrian)
    strokePolyline(p.pts, p.width / 2 + 0.5, fgrid, (c, r) => (fine[r * fcols + c] ||= 2));
  for (let r = 0; r < frows; r++) {
    for (let c = 0; c < fcols; c++) {
      const i = r * fcols + c;
      if (fine[i]) continue;
      const t = tileAt((c + 0.5) * FINE, (r + 0.5) * FINE);
      if (t !== Tile.Ground && t !== Tile.Building) fine[i] = 3;
    }
  }
}
// where people actually live: residential, commercial and retail land use
const urban = new Uint8Array(cols * rows);
for (const e of elements) {
  if (!/^(residential|commercial|retail)$/.test(tag(e, 'landuse'))) continue;
  fillPolygon(ringsOf(e), grid, (c, r) => (urban[r * cols + c] = 1));
}
const isUrban = (x: number, y: number) => {
  if (inCentro(x, y)) return true;
  const c = Math.floor(x / TILE_M),
    r = Math.floor(y / TILE_M);
  return c >= 0 && r >= 0 && c < cols && r < rows && urban[r * cols + c] === 1;
};
let lots = 0;
{
  const free = (q: number[]) => {
    // sample the quad on a 1.5 m lattice
    const [ax, ay, bx, by, , , dx, dy] = q;
    const ux = bx - ax,
      uy = by - ay,
      vx = dx - ax,
      vy = dy - ay;
    const nu = Math.max(2, Math.ceil(Math.hypot(ux, uy) / 1.5));
    const nv = Math.max(2, Math.ceil(Math.hypot(vx, vy) / 1.5));
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j <= nv; j++) {
        const s = 0.04 + (0.92 * i) / nu,
          t = 0.04 + (0.92 * j) / nv;
        const x = ax + ux * s + vx * t,
          y = ay + uy * s + vy * t;
        if (fineAt(x, y) !== 0 || !isUrban(x, y)) return false;
      }
    }
    return true;
  };
  graphEdges.forEach((e, i) => {
    if (e.cls === RoadClass.Motorway || e.cls === RoadClass.Service) return;
    const { width, sidewalk } = widths[i];
    const pts = e.pts;
    for (const side of [1, -1]) {
      for (let k = 0; k + 3 < pts.length; k += 2) {
        const ax = pts[k],
          ay = pts[k + 1];
        const len = Math.hypot(pts[k + 2] - ax, pts[k + 3] - ay);
        if (len < 7) continue;
        const ux = (pts[k + 2] - ax) / len,
          uy = (pts[k + 3] - ay) / len;
        const nx = -uy * side,
          ny = ux * side;
        const centro = inCentro(ax, ay);
        const off = width / 2 + sidewalk + 0.5 + (centro ? 0 : rnd() < 0.4 ? rnd() * 3 : 0);
        let t = 0;
        while (t < len - 5) {
          const r = rnd();
          const front = Math.min(len - t, r < 0.55 ? 8.66 : r < 0.8 ? 12 : r < 0.93 ? 17.3 : 26);
          if (front < 5) break;
          let placed = false;
          const deep = centro ? 16 + rnd() * 18 : 9 + rnd() * 12;
          for (const depth of [deep, deep * 0.6, 7]) {
            const p0x = ax + ux * t + nx * off,
              p0y = ay + uy * t + ny * off;
            const q = [
              p0x,
              p0y,
              p0x + ux * front,
              p0y + uy * front,
              p0x + ux * front + nx * depth,
              p0y + uy * front + ny * depth,
              p0x + nx * depth,
              p0y + ny * depth,
            ];
            if (!free(q)) continue;
            const fr = rnd();
            const avenue = e.cls <= RoadClass.Secondary;
            let floors: number;
            if (centro)
              floors =
                fr < 0.3
                  ? 1 + (fr < 0.12 ? 0 : 1)
                  : fr < 0.62
                    ? 3 + Math.floor(rnd() * 3)
                    : fr < 0.9
                      ? 6 + Math.floor(rnd() * 7)
                      : 13 + Math.floor(rnd() * 14);
            else
              floors =
                fr < 0.58
                  ? 1
                  : fr < 0.88
                    ? 2
                    : fr < 0.97
                      ? 3 + Math.floor(rnd() * 2)
                      : 5 + Math.floor(rnd() * 6);
            if (avenue && floors < 3 && rnd() < 0.4) floors += 2;
            const h = floors * 3 + (floors === 1 ? 0.5 : 0);
            const variant = Math.floor(rnd() * 16) | (floors <= 2 && rnd() < 0.45 ? 16 : 0);
            addBuilding([q], h, variant, 0);
            fillPolygon([q], fgrid, (c, rr) => (fine[rr * fcols + c] = 1));
            lots++;
            placed = true;
            break;
          }
          t += placed ? front + (!centro && rnd() < 0.12 ? 3 + rnd() * 6 : 0) : 3;
        }
      }
    }
  });
}
log(`${lots} generated lots`);

// ---- graph edges with names ---------------------------------------------------
const names = [''];
const nameIndex = new Map<string, number>([['', 0]]);
const edges: Edge[] = graphEdges.map((e, id) => {
  let n = nameIndex.get(e.name);
  if (n === undefined) {
    n = names.length;
    names.push(e.name);
    nameIndex.set(e.name, n);
  }
  const { width, sidewalk } = widths[id];
  return {
    id,
    from: e.from,
    to: e.to,
    name: n,
    cls: e.cls,
    lanes: e.cls === RoadClass.Motorway ? e.lanes : lanesFor(width, e.cls, e.oneway),
    oneway: e.oneway,
    width,
    sidewalk,
    flags: (dual.has(id) ? EdgeFlag.Dual : 0) | (e.oneway ? EdgeFlag.Oneway : 0),
    pts: Float32Array.from(e.pts),
  };
});

// ---- chunks -------------------------------------------------------------------
await rm(`${OUT}/c`, { recursive: true, force: true });
await mkdir(`${OUT}/c`, { recursive: true });
const ccols = cols / CHUNK;
const crows = rows / CHUNK;
const chunkM = CHUNK * TILE_M;
const keyOf = (cx: number, cy: number) => `${cx}_${cy}`;
const forChunks = (
  b: [number, number, number, number],
  pad: number,
  fn: (cx: number, cy: number) => void,
) => {
  const ya = Math.max(0, Math.floor((b[1] - pad) / chunkM));
  const yb = Math.min(crows - 1, Math.floor((b[3] + pad) / chunkM));
  const xa = Math.max(0, Math.floor((b[0] - pad) / chunkM));
  const xb = Math.min(ccols - 1, Math.floor((b[2] + pad) / chunkM));
  for (let cy = ya; cy <= yb; cy++) for (let cx = xa; cx <= xb; cx++) fn(cx, cy);
};
const push = <T>(m: Map<string, T[]>, k: string, v: T) => {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
};
const unionBounds = (rings: ArrayLike<number>[]): [number, number, number, number] => {
  const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings) {
    const [a, c, d, e] = ringBounds(r);
    b[0] = Math.min(b[0], a);
    b[1] = Math.min(b[1], c);
    b[2] = Math.max(b[2], d);
    b[3] = Math.max(b[3], e);
  }
  return b;
};

const edgesByChunk = new Map<string, Edge[]>();
for (const e of edges)
  forChunks(ringBounds(e.pts), e.width / 2 + e.sidewalk + 2, (cx, cy) =>
    push(edgesByChunk, keyOf(cx, cy), e),
  );

const shapesByChunk = new Map<string, ShapeData[]>();
for (const a of areas) {
  forChunks(unionBounds(a.rings), 0, (cx, cy) => {
    const x0 = cx * chunkM - 0.5,
      y0 = cy * chunkM - 0.5;
    const rings = a.rings
      .map((r) => clipRing(r, x0, y0, x0 + chunkM + 1, y0 + chunkM + 1))
      .filter((r) => r.length >= 6 && Math.abs(ringArea(r)) > 0.5)
      .map((r) => Float32Array.from(r));
    if (rings.length)
      push(shapesByChunk, keyOf(cx, cy), {
        kind: a.kind,
        height: 0,
        variant: a.variant,
        landmark: a.landmark,
        rings,
      });
  });
}
for (const b of buildings) {
  const [x, y] = ringCentroid(b.rings[0]);
  const cx = Math.floor(x / chunkM),
    cy = Math.floor(y / chunkM);
  if (cx < 0 || cy < 0 || cx >= ccols || cy >= crows) continue;
  push(shapesByChunk, keyOf(cx, cy), {
    kind: Shape.Building,
    height: b.height,
    variant: b.variant,
    landmark: b.landmark,
    rings: b.rings.map((r) => Float32Array.from(r)),
  });
}
const linesByChunk = new Map<string, LineData[]>();
for (const l of lines) {
  forChunks(ringBounds(l.pts), l.width, (cx, cy) => {
    const pad = l.width + 2;
    const x0 = cx * chunkM - pad,
      y0 = cy * chunkM - pad;
    for (const piece of clipPolyline(l.pts, x0, y0, x0 + chunkM + pad * 2, y0 + chunkM + pad * 2))
      push(linesByChunk, keyOf(cx, cy), { kind: l.kind, width: l.width, pts: Float32Array.from(piece) });
  });
}

const present: string[] = [];
const digest = createHash('sha256');
let totalBytes = 0;
for (let cy = 0; cy < crows; cy++) {
  for (let cx = 0; cx < ccols; cx++) {
    const ct = new Uint8Array(CHUNK * CHUNK);
    const ch = new Uint8Array(CHUNK * CHUNK);
    let empty = true;
    for (let r = 0; r < CHUNK; r++) {
      const src = (cy * CHUNK + r) * cols + cx * CHUNK;
      ct.set(tiles.subarray(src, src + CHUNK), r * CHUNK);
      ch.set(heights.subarray(src, src + CHUNK), r * CHUNK);
    }
    for (let i = 0; i < ct.length && empty; i++) if (ct[i] !== 0) empty = false;
    const key = keyOf(cx, cy);
    const chunkEdges = edgesByChunk.get(key) ?? [];
    const shapes = shapesByChunk.get(key) ?? [];
    if (empty && chunkEdges.length === 0 && shapes.length === 0) continue;
    const bin = encodeChunk(
      { cx, cy, tiles: ct, heights: ch, edges: chunkEdges, shapes, lines: linesByChunk.get(key) ?? [] },
      CHUNK,
      TILE_M,
    );
    await writeFile(`${OUT}/c/${key}.bin`, bin);
    digest.update(key).update(bin);
    totalBytes += bin.length;
    present.push(key);
  }
}
log(`${present.length} chunks, ${(totalBytes / 1e6).toFixed(1)} MB`);

// ---- overview -----------------------------------------------------------------
const ocols = cols / OVERVIEW_CELL;
const orows = rows / OVERVIEW_CELL;
const overview = new Uint8Array(ocols * orows);
const counts = new Uint16Array(16);
for (let oy = 0; oy < orows; oy++) {
  for (let ox = 0; ox < ocols; ox++) {
    counts.fill(0);
    for (let r = 0; r < OVERVIEW_CELL; r++) {
      for (let c = 0; c < OVERVIEW_CELL; c++) {
        counts[tileType(tiles[(oy * OVERVIEW_CELL + r) * cols + ox * OVERVIEW_CELL + c])]++;
      }
    }
    let best = 0;
    for (let t = 1; t < 16; t++) if (counts[t] > counts[best]) best = t;
    if (counts[Tile.Road] >= OVERVIEW_CELL) best = Tile.Road;
    overview[oy * ocols + ox] = best;
  }
}
await writeFile(`${OUT}/overview.bin`, encodeOverview(overview));

// ---- places -------------------------------------------------------------------
const nodeNames = new Map<number, Set<string>>();
const nodeXY = new Map<number, [number, number]>();
for (const w of highways) {
  const name = w.tags.name;
  if (!name) continue;
  w.nodes.forEach((id, i) => {
    if (!nodeNames.has(id)) nodeNames.set(id, new Set());
    nodeNames.get(id)!.add(name);
    nodeXY.set(id, [w.pts[i * 2], w.pts[i * 2 + 1]]);
  });
}
const [c1x, c1y] = proj.toWorld((p1s + p1n) / 2, (p1w + p1e) / 2);
const places: MapMeta['places'] = {};
for (const [id, p] of Object.entries(PLACES)) {
  let xy: [number, number] | null = null;
  if (typeof p.at[0] === 'number') {
    xy = proj.toWorld(p.at[0], p.at[1] as number);
  } else {
    const [a, b] = p.at as [string, string];
    let best = Infinity;
    for (const [nid, set] of nodeNames) {
      const list = [...set];
      if (!list.some((n) => nameMatches(n, a)) || !list.some((n) => nameMatches(n, b))) continue;
      const [x, y] = nodeXY.get(nid)!;
      const d = Math.hypot(x - c1x, y - c1y);
      if (d < best) {
        best = d;
        xy = [x, y];
      }
    }
  }
  if (!xy) throw new Error(`Could not place "${id}" (${p.label}) on the map`);
  places[id] = { label: p.label, x: Math.round(xy[0] * 10) / 10, y: Math.round(xy[1] * 10) / 10 };
}
log(`places: ${Object.keys(places).join(', ')}`);

const neighbourhoods = elements
  .filter((e) => e.type === 'node' && e.tags?.place && e.tags.name && e.lat !== undefined)
  .map((e) => {
    const [x, y] = proj.toWorld(e.lat!, e.lon!);
    return { name: e.tags!.name!, x: Math.round(x), y: Math.round(y) };
  })
  .filter((n) => n.x >= 0 && n.y >= 0 && n.x <= widthM && n.y <= heightM)
  .sort((a, b) => a.name.localeCompare(b.name));
log(`${neighbourhoods.length} neighbourhoods`);

const phases = PHASES.map((ph) => {
  const [s, w, n, e] = ph.rect;
  const [x0, y0] = proj.toWorld(n, w);
  const [x1, y1] = proj.toWorld(s, e);
  return {
    id: ph.id,
    name: ph.name,
    rect: [x0, y0, x1, y1].map((v) => Math.round(Math.max(0, v))) as [number, number, number, number],
  };
});

const landmarks: Landmark[] = LANDMARKS.map((l, i) => {
  const p = landmarkPoint.get(i + 1);
  if (!p) throw new Error(`Landmark "${l.id}" has no geometry in the OSM download`);
  const x = Math.max(0, Math.min(widthM, p[0]));
  const y = Math.max(0, Math.min(heightM, p[1]));
  return {
    id: l.id,
    label: l.label,
    kind: l.kind,
    x: Math.round(x),
    y: Math.round(y),
    ...(l.colors ? { colors: l.colors } : {}),
  };
});
log(`${landmarks.length} landmarks`);

const meta: MapMeta = {
  version: digest.digest('hex').slice(0, 12),
  attribution: '© OpenStreetMap contributors (ODbL)',
  bbox: BBOX,
  tileM: TILE_M,
  chunk: CHUNK,
  width: cols,
  height: rows,
  chunks: present,
  names,
  places,
  neighbourhoods,
  phases,
  landmarks,
  overview: { cell: OVERVIEW_CELL * TILE_M, cols: ocols, rows: orows },
};
await writeFile(`${OUT}/meta.json`, JSON.stringify(meta));
await copyFile('scripts/map/LICENSE.md', `${OUT}/LICENSE.md`);
log('done');
