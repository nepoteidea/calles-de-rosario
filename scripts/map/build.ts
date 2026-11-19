// Turns the raw OSM download (.cache/osm) into game data under public/map:
//   meta.json      world size, street names, places, neighbourhoods, phases
//   overview.bin   coarse whole-city grid for the map screen
//   c/<cx>_<cy>.bin  tile chunks with their road-graph edges
//
// Map data © OpenStreetMap contributors, ODbL 1.0. The output is a derived
// database and stays under the ODbL (see public/map/LICENSE.md).

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { BBOX, CHUNK, PHASES, PLACES, TILE_M } from './config.ts';
import { makeProjection } from '../../src/game/map/projection.ts';
import { assembleRings, fillPolygon, strokePolyline, type Ring } from '../../src/game/map/raster.ts';
import {
  Tile,
  encodeChunk,
  encodeOverview,
  packTile,
  tileType,
  type Edge,
  type MapMeta,
} from '../../src/game/map/format.ts';
import {
  buildGraph,
  isPedestrianWay,
  nameMatches,
  type Tags,
  type WayInput,
} from '../../src/game/map/roads.ts';

const SRC = '.cache/osm';
const OUT = 'public/map';
const OVERVIEW_CELL = 4; // tiles per overview cell (16 m)

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
  for (const e of json.elements) byKey.set(`${e.type}/${e.id}`, e);
}
const elements = [...byKey.values()];
log(`${elements.length} unique OSM elements`);

const proj = makeProjection(BBOX);
const [, , , east] = BBOX;
const [maxX] = proj.toWorld(BBOX[0], east);
const [, maxY] = proj.toWorld(BBOX[0], BBOX[1]);
const cols = Math.ceil(maxX / TILE_M / CHUNK) * CHUNK;
const rows = Math.ceil(maxY / TILE_M / CHUNK) * CHUNK;
const grid = { cols, rows, tileM: TILE_M };
const tiles = new Uint8Array(cols * rows); // Tile.Ground everywhere
const heights = new Uint8Array(cols * rows);
log(`grid ${cols}×${rows} tiles (${(cols * TILE_M) / 1000}×${(rows * TILE_M) / 1000} km)`);

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
    return assembleRings((e.members ?? []).filter((m) => m.type === 'way').map((m) => toPts(m.geometry)));
  }
  return [];
};

const hash = (n: number) => {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
};

const set =
  (type: number, variant = 0, guard?: (cur: number) => boolean) =>
  (c: number, r: number) => {
    const i = r * cols + c;
    if (guard && !guard(tileType(tiles[i]))) return;
    tiles[i] = packTile(type, variant);
    if (type !== Tile.Building) heights[i] = 0;
  };

// ---- land cover ---------------------------------------------------------------
const tag = (e: OsmElement, k: string) => e.tags?.[k] ?? '';
const isPark = (e: OsmElement) =>
  /^(park|garden|pitch|playground|stadium|common)$/.test(tag(e, 'leisure')) ||
  /^(grass|recreation_ground|forest|meadow|village_green|cemetery)$/.test(tag(e, 'landuse')) ||
  /^(wood|scrub|grassland|wetland)$/.test(tag(e, 'natural'));
const isWater = (e: OsmElement) =>
  tag(e, 'natural') === 'water' ||
  tag(e, 'waterway') === 'riverbank' ||
  (e.type === 'relation' && !!tag(e, 'water'));

for (const e of elements)
  if (isPark(e)) fillPolygon(ringsOf(e), grid, set(Tile.Park, tag(e, 'leisure') === 'pitch' ? 1 : 0));
log('parks');
for (const e of elements)
  if (/^(sand|beach)$/.test(tag(e, 'natural'))) fillPolygon(ringsOf(e), grid, set(Tile.Sand));
for (const e of elements) if (isWater(e)) fillPolygon(ringsOf(e), grid, set(Tile.Water));
for (const e of elements) {
  if (e.type !== 'way' || !e.tags?.waterway || e.tags.tunnel) continue;
  const half = { river: 15, canal: 5, stream: 3 }[e.tags.waterway] ?? 3;
  strokePolyline(toPts(e.geometry), half, grid, set(Tile.Water));
}
for (const e of elements) if (tag(e, 'place') === 'islet') fillPolygon(ringsOf(e), grid, set(Tile.Park, 2));
for (const e of elements) {
  if (tag(e, 'amenity') === 'parking' || (tag(e, 'highway') === 'pedestrian' && tag(e, 'area') === 'yes')) {
    fillPolygon(
      ringsOf(e),
      grid,
      set(Tile.Plaza, 1, (t) => t !== Tile.Water),
    );
  }
}
log('water and plazas');

// ---- buildings ------------------------------------------------------------------
let buildingCount = 0;
for (const e of elements) {
  if (!e.tags?.building || e.tags.building === 'roof') continue;
  const levels = parseFloat(e.tags['building:levels'] ?? '');
  const metres = parseFloat(e.tags.height ?? '');
  let h = levels > 0 ? levels : metres > 0 ? metres / 3 : 2 + (hash(e.id) % 3);
  h = Math.max(1, Math.min(60, Math.round(h)));
  const variant = hash(e.id) % 8;
  fillPolygon(ringsOf(e), grid, (c, r) => {
    const i = r * cols + c;
    if (tileType(tiles[i]) === Tile.Water) return;
    tiles[i] = packTile(Tile.Building, variant);
    heights[i] = h;
  });
  buildingCount++;
}
log(`${buildingCount} buildings`);

// ---- ways: sidewalks, footpaths, rail, roads ---------------------------------
const highways: (WayInput & { id: number })[] = [];
for (const e of elements) {
  if (e.type !== 'way' || !e.tags?.highway || !e.nodes) continue;
  const pts = toPts(e.geometry);
  if (pts.length / 2 !== e.nodes.length) continue;
  highways.push({ id: e.id, nodes: e.nodes, pts, tags: e.tags });
}

const { edges: graphEdges, nodePos } = buildGraph(highways.filter((w) => !w.tags.tunnel));
log(`${graphEdges.length} road edges, ${nodePos.length / 2} nodes`);

// Real blocks have ~3 m sidewalks; carve them out of buildings so people can walk.
for (const e of graphEdges) {
  if (e.cls === 0) continue;
  strokePolyline(
    e.pts,
    e.width / 2 + 3.5,
    grid,
    set(Tile.Sidewalk, 0, (t) => t !== Tile.Water),
  );
}
for (const w of highways) {
  if (!isPedestrianWay(w.tags) || w.tags.tunnel || w.tags.area === 'yes') continue;
  const wide = w.tags.highway === 'pedestrian';
  strokePolyline(
    w.pts,
    wide ? 4 : 1.5,
    grid,
    set(Tile.Plaza, 0, (t) => t !== Tile.Water && (wide || t !== Tile.Building)),
  );
}
for (const e of elements) {
  if (tag(e, 'railway') !== 'rail' || e.tags?.tunnel) continue;
  strokePolyline(
    toPts(e.geometry),
    2,
    grid,
    set(Tile.Rail, 0, (t) => t !== Tile.Building && t !== Tile.Water),
  );
}
for (const e of graphEdges) {
  strokePolyline(e.pts, e.width / 2, grid, set(Tile.Road, e.cls <= 1 ? 1 : 0));
}
log('roads');

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
  return {
    id,
    from: e.from,
    to: e.to,
    name: n,
    cls: e.cls,
    lanes: e.lanes,
    oneway: e.oneway,
    width: e.width,
    pts: Float32Array.from(e.pts),
  };
});

// ---- chunks -------------------------------------------------------------------
await rm(`${OUT}/c`, { recursive: true, force: true });
await mkdir(`${OUT}/c`, { recursive: true });
const ccols = cols / CHUNK;
const crows = rows / CHUNK;
const chunkM = CHUNK * TILE_M;
const edgesByChunk = new Map<string, Edge[]>();
for (const e of edges) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (let i = 0; i < e.pts.length; i += 2) {
    x0 = Math.min(x0, e.pts[i]);
    x1 = Math.max(x1, e.pts[i]);
    y0 = Math.min(y0, e.pts[i + 1]);
    y1 = Math.max(y1, e.pts[i + 1]);
  }
  const pad = e.width;
  for (
    let cy = Math.max(0, Math.floor((y0 - pad) / chunkM));
    cy <= Math.min(crows - 1, Math.floor((y1 + pad) / chunkM));
    cy++
  ) {
    for (
      let cx = Math.max(0, Math.floor((x0 - pad) / chunkM));
      cx <= Math.min(ccols - 1, Math.floor((x1 + pad) / chunkM));
      cx++
    ) {
      const k = `${cx}_${cy}`;
      if (!edgesByChunk.has(k)) edgesByChunk.set(k, []);
      edgesByChunk.get(k)!.push(e);
    }
  }
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
    const key = `${cx}_${cy}`;
    const chunkEdges = edgesByChunk.get(key) ?? [];
    if (empty && chunkEdges.length === 0) continue;
    const bin = encodeChunk({ cx, cy, tiles: ct, heights: ch, edges: chunkEdges }, CHUNK);
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
const [p1s, p1w, p1n, p1e] = PHASES[0].rect;
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
  .filter((n) => n.x >= 0 && n.y >= 0 && n.x <= cols * TILE_M && n.y <= rows * TILE_M)
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
  overview: { cell: OVERVIEW_CELL * TILE_M, cols: ocols, rows: orows },
};
await writeFile(`${OUT}/meta.json`, JSON.stringify(meta));
await copyFile('scripts/map/LICENSE.md', `${OUT}/LICENSE.md`);
log('done');
