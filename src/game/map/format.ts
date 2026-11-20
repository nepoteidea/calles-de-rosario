// Binary map format shared by the offline pipeline (scripts/map) and the game.
//
// A chunk file holds CHUNK×CHUNK tiles, the road-graph edges that touch it, and
// the vector shapes drawn in it (buildings, parks, water, rail lines...).
// Layout (little-endian):
//   'CR02'            magic
//   u16 cx, u16 cy    chunk coordinates
//   u32 runCount      tile runs, then runCount × { u16 length, u8 tile, u8 height }
//   u32 edgeCount     edges, then edgeCount × edge record (see encodeChunk)
//   u32 shapeCount    polygons: { u8 kind, u8 height m, u8 variant, u8 landmark, u8 rings,
//                     rings × { u16 n, n × (i16 x, i16 y) } }
//   u32 lineCount     polylines: { u8 kind, u16 width dm, u16 n, n × (i16 x, i16 y) }
// Shape and line points are decimetres relative to the chunk's top-left corner.

export const Tile = {
  Ground: 0,
  Road: 1,
  Sidewalk: 2,
  Building: 3,
  Park: 4,
  Water: 5,
  Rail: 6,
  Plaza: 7,
  Sand: 8,
} as const;
export type TileType = (typeof Tile)[keyof typeof Tile];

/** A tile byte packs the type (low nibble) and a cosmetic variant (high nibble). */
export const tileType = (b: number): TileType => (b & 0x0f) as TileType;
export const tileVariant = (b: number): number => b >> 4;
export const packTile = (type: number, variant = 0): number => (type & 0x0f) | ((variant & 0x0f) << 4);

/** Road classes, ordered from biggest to smallest. */
export const RoadClass = {
  Motorway: 0,
  Primary: 1,
  Secondary: 2,
  Tertiary: 3,
  Residential: 4,
  Service: 5,
} as const;

/** Vector polygon kinds. */
export const Shape = {
  Building: 1,
  Park: 2,
  Water: 3,
  Sand: 4,
  Plaza: 5,
  Pitch: 6,
  Parking: 7,
  Stadium: 8,
  Cemetery: 9,
  Track: 10,
  Grass: 11,
  Bridge: 12,
  Apron: 13,
} as const;

/** Vector polyline kinds. */
export const Line = {
  Rail: 1,
  Footway: 2,
  Path: 3,
  Median: 4,
  Runway: 5,
  /** A racetrack drawn as a closed line (leisure=track). */
  Track: 6,
} as const;

/** Edge flag bits. */
export const EdgeFlag = {
  Oneway: 1,
  /** One half of a dual carriageway (a boulevard with a median). */
  Dual: 2,
  Bridge: 4,
} as const;

export interface Edge {
  id: number;
  /** Graph node ids. Traffic may drive from → to; also to → from unless oneway. */
  from: number;
  to: number;
  name: number;
  cls: number;
  lanes: number;
  oneway: boolean;
  /** Carriageway width in metres. */
  width: number;
  /** Sidewalk width on each side in metres (0: none). */
  sidewalk: number;
  flags: number;
  /** Polyline in world metres, flattened [x0, y0, x1, y1, ...]. */
  pts: Float32Array;
}

export interface ShapeData {
  kind: number;
  /** Metres; buildings only. */
  height: number;
  variant: number;
  /** 1-based index into MapMeta.landmarks, 0 for none. */
  landmark: number;
  /** World metres, flattened. Several rings fill with the even-odd rule. */
  rings: Float32Array[];
}

export interface LineData {
  kind: number;
  width: number;
  pts: Float32Array;
}

export interface ChunkData {
  cx: number;
  cy: number;
  tiles: Uint8Array;
  heights: Uint8Array;
  edges: Edge[];
  shapes: ShapeData[];
  lines: LineData[];
}

const MAGIC = 0x32305243; // 'CR02'
const q = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v * 10)));

export function encodeChunk(chunk: ChunkData, size: number, tileM = 4): Uint8Array {
  const ox = chunk.cx * size * tileM;
  const oy = chunk.cy * size * tileM;
  const runs: number[] = [];
  const n = size * size;
  let i = 0;
  while (i < n) {
    const t = chunk.tiles[i];
    const h = chunk.heights[i];
    let len = 1;
    while (i + len < n && len < 0xffff && chunk.tiles[i + len] === t && chunk.heights[i + len] === h) len++;
    runs.push(len, t, h);
    i += len;
  }
  let bytes = 4 + 4 + 4 + (runs.length / 3) * 4 + 4;
  for (const e of chunk.edges) bytes += 22 + e.pts.length * 4;
  bytes += 4;
  for (const s of chunk.shapes) {
    bytes += 5;
    for (const r of s.rings) bytes += 2 + r.length * 2;
  }
  bytes += 4;
  for (const l of chunk.lines) bytes += 5 + l.pts.length * 2;

  const buf = new ArrayBuffer(bytes);
  const v = new DataView(buf);
  let o = 0;
  v.setUint32(o, MAGIC, true);
  v.setUint16(o + 4, chunk.cx, true);
  v.setUint16(o + 6, chunk.cy, true);
  v.setUint32(o + 8, runs.length / 3, true);
  o = 12;
  for (let r = 0; r < runs.length; r += 3) {
    v.setUint16(o, runs[r], true);
    v.setUint8(o + 2, runs[r + 1]);
    v.setUint8(o + 3, runs[r + 2]);
    o += 4;
  }
  v.setUint32(o, chunk.edges.length, true);
  o += 4;
  for (const e of chunk.edges) {
    v.setUint32(o, e.id, true);
    v.setUint32(o + 4, e.from, true);
    v.setUint32(o + 8, e.to, true);
    v.setUint16(o + 12, e.name, true);
    v.setUint8(o + 14, e.cls);
    v.setUint8(o + 15, e.lanes);
    v.setUint8(o + 16, (e.flags & ~EdgeFlag.Oneway) | (e.oneway ? EdgeFlag.Oneway : 0));
    v.setUint8(o + 17, Math.min(255, Math.round(e.sidewalk * 10)));
    v.setUint16(o + 18, Math.min(65535, Math.round(e.width * 10)), true);
    v.setUint16(o + 20, e.pts.length / 2, true);
    o += 22;
    for (let k = 0; k < e.pts.length; k++, o += 4) v.setFloat32(o, e.pts[k], true);
  }
  v.setUint32(o, chunk.shapes.length, true);
  o += 4;
  for (const s of chunk.shapes) {
    v.setUint8(o, s.kind);
    v.setUint8(o + 1, Math.min(255, Math.round(s.height)));
    v.setUint8(o + 2, s.variant);
    v.setUint8(o + 3, s.landmark);
    v.setUint8(o + 4, s.rings.length);
    o += 5;
    for (const r of s.rings) {
      v.setUint16(o, r.length / 2, true);
      o += 2;
      for (let k = 0; k < r.length; k += 2, o += 4) {
        v.setInt16(o, q(r[k] - ox), true);
        v.setInt16(o + 2, q(r[k + 1] - oy), true);
      }
    }
  }
  v.setUint32(o, chunk.lines.length, true);
  o += 4;
  for (const l of chunk.lines) {
    v.setUint8(o, l.kind);
    v.setUint16(o + 1, Math.min(65535, Math.round(l.width * 10)), true);
    v.setUint16(o + 3, l.pts.length / 2, true);
    o += 5;
    for (let k = 0; k < l.pts.length; k += 2, o += 4) {
      v.setInt16(o, q(l.pts[k] - ox), true);
      v.setInt16(o + 2, q(l.pts[k + 1] - oy), true);
    }
  }
  return new Uint8Array(buf);
}

export function decodeChunk(data: ArrayBuffer | Uint8Array, size: number, tileM = 4): ChunkData {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (v.getUint32(0, true) !== MAGIC) throw new Error('Not a map chunk');
  const cx = v.getUint16(4, true);
  const cy = v.getUint16(6, true);
  const ox = cx * size * tileM;
  const oy = cy * size * tileM;
  const runCount = v.getUint32(8, true);
  const tiles = new Uint8Array(size * size);
  const heights = new Uint8Array(size * size);
  let o = 12;
  let i = 0;
  for (let r = 0; r < runCount; r++, o += 4) {
    const len = v.getUint16(o, true);
    tiles.fill(v.getUint8(o + 2), i, i + len);
    heights.fill(v.getUint8(o + 3), i, i + len);
    i += len;
  }
  if (i !== size * size) throw new Error(`Chunk ${cx},${cy} has ${i} tiles, expected ${size * size}`);
  const edgeCount = v.getUint32(o, true);
  o += 4;
  const edges: Edge[] = [];
  for (let k = 0; k < edgeCount; k++) {
    const npts = v.getUint16(o + 20, true);
    const pts = new Float32Array(npts * 2);
    const flags = v.getUint8(o + 16);
    const e: Edge = {
      id: v.getUint32(o, true),
      from: v.getUint32(o + 4, true),
      to: v.getUint32(o + 8, true),
      name: v.getUint16(o + 12, true),
      cls: v.getUint8(o + 14),
      lanes: v.getUint8(o + 15),
      oneway: (flags & EdgeFlag.Oneway) !== 0,
      flags,
      sidewalk: v.getUint8(o + 17) / 10,
      width: v.getUint16(o + 18, true) / 10,
      pts,
    };
    o += 22;
    for (let p = 0; p < pts.length; p++, o += 4) pts[p] = v.getFloat32(o, true);
    edges.push(e);
  }
  const shapes: ShapeData[] = [];
  const shapeCount = v.getUint32(o, true);
  o += 4;
  for (let k = 0; k < shapeCount; k++) {
    const s: ShapeData = {
      kind: v.getUint8(o),
      height: v.getUint8(o + 1),
      variant: v.getUint8(o + 2),
      landmark: v.getUint8(o + 3),
      rings: [],
    };
    const nr = v.getUint8(o + 4);
    o += 5;
    for (let r = 0; r < nr; r++) {
      const n = v.getUint16(o, true);
      o += 2;
      const ring = new Float32Array(n * 2);
      for (let p = 0; p < n; p++, o += 4) {
        ring[p * 2] = ox + v.getInt16(o, true) / 10;
        ring[p * 2 + 1] = oy + v.getInt16(o + 2, true) / 10;
      }
      s.rings.push(ring);
    }
    shapes.push(s);
  }
  const lines: LineData[] = [];
  const lineCount = v.getUint32(o, true);
  o += 4;
  for (let k = 0; k < lineCount; k++) {
    const kind = v.getUint8(o);
    const width = v.getUint16(o + 1, true) / 10;
    const n = v.getUint16(o + 3, true);
    o += 5;
    const pts = new Float32Array(n * 2);
    for (let p = 0; p < n; p++, o += 4) {
      pts[p * 2] = ox + v.getInt16(o, true) / 10;
      pts[p * 2 + 1] = oy + v.getInt16(o + 2, true) / 10;
    }
    lines.push({ kind, width, pts });
  }
  return { cx, cy, tiles, heights, edges, shapes, lines };
}

/** Coarse whole-city grid for the map screen: one byte (tile type) per cell, RLE. */
export function encodeOverview(cells: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < cells.length) {
    let len = 1;
    while (i + len < cells.length && len < 255 && cells[i + len] === cells[i]) len++;
    out.push(len, cells[i]);
    i += len;
  }
  return Uint8Array.from(out);
}

export function decodeOverview(data: Uint8Array, length: number): Uint8Array {
  const cells = new Uint8Array(length);
  let i = 0;
  for (let o = 0; o < data.length; o += 2) {
    cells.fill(data[o + 1], i, i + data[o]);
    i += data[o];
  }
  return cells;
}

export interface Landmark {
  id: string;
  label: string;
  kind: string;
  /** Label point in world metres. */
  x: number;
  y: number;
  colors?: [string, string];
}

export interface Place {
  label: string;
  x: number;
  y: number;
}

/** public/map/meta.json */
export interface MapMeta {
  /** Content hash of the chunks; added to chunk URLs so caches never serve an old map. */
  version: string;
  attribution: string;
  bbox: [number, number, number, number];
  tileM: number;
  chunk: number;
  /** World size in tiles. */
  width: number;
  height: number;
  /** "cx_cy" keys of chunks that exist; missing chunks are open ground. */
  chunks: string[];
  names: string[];
  places: Record<string, Place>;
  neighbourhoods: { name: string; x: number; y: number }[];
  /** Phase rectangles in world metres: [x0, y0, x1, y1]. */
  phases: { id: number; name: string; rect: [number, number, number, number] }[];
  /** Recognisable places, drawn in their own style and labelled in the game and on the map. */
  landmarks: Landmark[];
  overview: { cell: number; cols: number; rows: number };
}
