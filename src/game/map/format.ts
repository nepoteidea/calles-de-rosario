// Binary map format shared by the offline pipeline (scripts/map) and the game.
//
// A chunk file holds CHUNK×CHUNK tiles plus the road-graph edges that touch it.
// Layout (little-endian):
//   'CR01'            magic
//   u16 cx, u16 cy    chunk coordinates
//   u32 runCount      tile runs, then runCount × { u16 length, u8 tile, u8 height }
//   u32 edgeCount     edges, then edgeCount × edge record (see writeEdge)

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

export interface Edge {
  id: number;
  /** Graph node ids. Traffic may drive from → to; also to → from unless oneway. */
  from: number;
  to: number;
  name: number;
  cls: number;
  lanes: number;
  oneway: boolean;
  /** Road width in metres, as rasterised. */
  width: number;
  /** Polyline in world metres, flattened [x0, y0, x1, y1, ...]. */
  pts: Float32Array;
}

export interface ChunkData {
  cx: number;
  cy: number;
  tiles: Uint8Array;
  heights: Uint8Array;
  edges: Edge[];
}

const MAGIC = 0x31305243; // 'CR01'

export function encodeChunk(chunk: ChunkData, size: number): Uint8Array {
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
  for (const e of chunk.edges) bytes += 20 + e.pts.length * 4;

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
    v.setUint8(o + 16, e.oneway ? 1 : 0);
    v.setUint8(o + 17, Math.min(255, Math.round(e.width)));
    v.setUint16(o + 18, e.pts.length / 2, true);
    o += 20;
    for (let k = 0; k < e.pts.length; k++, o += 4) v.setFloat32(o, e.pts[k], true);
  }
  return new Uint8Array(buf);
}

export function decodeChunk(data: ArrayBuffer | Uint8Array, size: number): ChunkData {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (v.getUint32(0, true) !== MAGIC) throw new Error('Not a map chunk');
  const cx = v.getUint16(4, true);
  const cy = v.getUint16(6, true);
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
    const npts = v.getUint16(o + 18, true);
    const pts = new Float32Array(npts * 2);
    const e: Edge = {
      id: v.getUint32(o, true),
      from: v.getUint32(o + 4, true),
      to: v.getUint32(o + 8, true),
      name: v.getUint16(o + 12, true),
      cls: v.getUint8(o + 14),
      lanes: v.getUint8(o + 15),
      oneway: v.getUint8(o + 16) === 1,
      width: v.getUint8(o + 17),
      pts,
    };
    o += 20;
    for (let p = 0; p < pts.length; p++, o += 4) pts[p] = v.getFloat32(o, true);
    edges.push(e);
  }
  return { cx, cy, tiles, heights, edges };
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
  overview: { cell: number; cols: number; rows: number };
}
