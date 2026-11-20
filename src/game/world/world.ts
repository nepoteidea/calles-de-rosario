// The streamed city: chunk loading, tile queries and the road graph of loaded chunks.

import {
  decodeChunk,
  tileType,
  Shape,
  Tile,
  type ChunkData,
  type Edge,
  type MapMeta,
} from '../map/format.ts';
import { fillPolygon, strokePolyline } from '../map/raster.ts';
import { ringBounds } from '../map/geometry.ts';

export type ChunkFetcher = (key: string) => Promise<ArrayBuffer | null>;

export const fetchChunkOverHttp =
  (base: string, version = ''): ChunkFetcher =>
  async (key) => {
    const res = await fetch(`${base}/c/${key}.bin${version ? `?v=${version}` : ''}`);
    if (!res.ok) throw new Error(`chunk ${key}: HTTP ${res.status}`);
    return res.arrayBuffer();
  };

/** Metres per cell of the collision mask. */
const MASK_M = 1;

export interface NodeLink {
  edge: Edge;
  /** true when the edge is driven from → to, false for to → from. */
  forward: boolean;
}

export class World {
  readonly meta: MapMeta;
  readonly chunkM: number;
  private readonly present: Set<string>;
  private readonly chunks = new Map<string, ChunkData>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly lastUsed = new Map<string, number>();
  private frame = 0;
  /** Graph of loaded chunks: node id → links leaving that node. */
  private readonly out = new Map<number, NodeLink[]>();
  /** Same graph ignoring one-way rules (the police don't care). */
  private readonly both = new Map<number, NodeLink[]>();
  private readonly edgeRefs = new Map<number, { edge: Edge; refs: number }>();
  /** Bumped whenever a chunk loads or unloads. */
  version = 0;

  private readonly fetcher: ChunkFetcher;
  private readonly maxChunks: number;

  constructor(meta: MapMeta, fetcher: ChunkFetcher, maxChunks = 36) {
    this.meta = meta;
    this.fetcher = fetcher;
    this.maxChunks = maxChunks;
    this.chunkM = meta.chunk * meta.tileM;
    this.present = new Set(meta.chunks);
  }

  get widthM() {
    return this.meta.width * this.meta.tileM;
  }
  get heightM() {
    return this.meta.height * this.meta.tileM;
  }

  chunkKeyAt(x: number, y: number) {
    return `${Math.floor(x / this.chunkM)}_${Math.floor(y / this.chunkM)}`;
  }

  getChunk(cx: number, cy: number): ChunkData | undefined {
    return this.chunks.get(`${cx}_${cy}`);
  }

  isLoaded(x: number, y: number) {
    const key = this.chunkKeyAt(x, y);
    return this.chunks.has(key) || (!this.present.has(key) && this.inBounds(x, y));
  }

  inBounds(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.widthM && y < this.heightM;
  }

  /** Requests every chunk within `radius` metres of (x, y). Resolves when all are in. */
  ensureAround(x: number, y: number, radius: number): Promise<void> {
    this.frame++;
    const jobs: Promise<void>[] = [];
    const c0 = Math.floor((x - radius) / this.chunkM);
    const c1 = Math.floor((x + radius) / this.chunkM);
    const r0 = Math.floor((y - radius) / this.chunkM);
    const r1 = Math.floor((y + radius) / this.chunkM);
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const key = `${cx}_${cy}`;
        if (!this.present.has(key)) continue;
        this.lastUsed.set(key, this.frame);
        if (this.chunks.has(key)) continue;
        jobs.push(this.load(key));
      }
    }
    return Promise.all(jobs).then(() => undefined);
  }

  private load(key: string): Promise<void> {
    let p = this.pending.get(key);
    if (!p) {
      p = this.fetcher(key)
        .then((buf) => {
          if (buf) this.add(decodeChunk(buf, this.meta.chunk, this.meta.tileM));
        })
        .catch((err) => console.warn(err))
        .finally(() => this.pending.delete(key));
      this.pending.set(key, p);
    }
    return p;
  }

  /** Adds a decoded chunk directly (used by loaders and tests). */
  add(chunk: ChunkData) {
    const key = `${chunk.cx}_${chunk.cy}`;
    if (this.chunks.has(key)) return;
    this.chunks.set(key, chunk);
    this.lastUsed.set(key, this.frame);
    this.touchMasks(chunk.cx, chunk.cy);
    for (const e of chunk.edges) {
      const ref = this.edgeRefs.get(e.id);
      if (ref) {
        ref.refs++;
        continue;
      }
      this.edgeRefs.set(e.id, { edge: e, refs: 1 });
      this.link(this.out, e.from, { edge: e, forward: true });
      if (!e.oneway) this.link(this.out, e.to, { edge: e, forward: false });
      this.link(this.both, e.from, { edge: e, forward: true });
      this.link(this.both, e.to, { edge: e, forward: false });
    }
    this.version++;
    this.evict();
  }

  private link(map: Map<number, NodeLink[]>, node: number, l: NodeLink) {
    const list = map.get(node);
    if (list) list.push(l);
    else map.set(node, [l]);
  }

  private evict() {
    if (this.chunks.size <= this.maxChunks) return;
    const old = [...this.chunks.keys()].sort(
      (a, b) => (this.lastUsed.get(a) ?? 0) - (this.lastUsed.get(b) ?? 0),
    );
    for (const key of old.slice(0, this.chunks.size - this.maxChunks)) {
      const chunk = this.chunks.get(key)!;
      this.chunks.delete(key);
      this.masks.delete(key);
      this.touchMasks(chunk.cx, chunk.cy);
      for (const e of chunk.edges) {
        const ref = this.edgeRefs.get(e.id);
        if (!ref || --ref.refs > 0) continue;
        this.edgeRefs.delete(e.id);
        for (const map of [this.out, this.both]) {
          this.unlink(map, e.from, e);
          this.unlink(map, e.to, e);
        }
      }
    }
    this.version++;
  }

  private unlink(map: Map<number, NodeLink[]>, node: number, e: Edge) {
    const list = map.get(node);
    if (!list) return;
    const kept = list.filter((l) => l.edge !== e);
    if (kept.length) map.set(node, kept);
    else map.delete(node);
  }

  /** Raw tile byte at a world position. Unloaded or missing chunks read as ground. */
  tileAt(x: number, y: number): number {
    if (!this.inBounds(x, y)) return Tile.Water;
    const { chunk, tileM } = this.meta;
    const cx = Math.floor(x / this.chunkM);
    const cy = Math.floor(y / this.chunkM);
    const c = this.chunks.get(`${cx}_${cy}`);
    if (!c) return Tile.Ground;
    const col = Math.floor(x / tileM) - cx * chunk;
    const row = Math.floor(y / tileM) - cy * chunk;
    return c.tiles[row * chunk + col];
  }

  typeAt(x: number, y: number) {
    return tileType(this.tileAt(x, y));
  }

  heightAt(x: number, y: number): number {
    const { chunk, tileM } = this.meta;
    const cx = Math.floor(x / this.chunkM);
    const cy = Math.floor(y / this.chunkM);
    const c = this.chunks.get(`${cx}_${cy}`);
    if (!c) return 0;
    return c.heights[(Math.floor(y / tileM) - cy * chunk) * chunk + (Math.floor(x / tileM) - cx * chunk)];
  }

  /**
   * Buildings and water block everything; out-of-bounds counts as water. Uses a
   * 1 m mask drawn from the same footprints the renderer shows, so a car stops
   * at the wall it hits.
   */
  isSolid(x: number, y: number) {
    if (!this.inBounds(x, y)) return true;
    const cx = Math.floor(x / this.chunkM);
    const cy = Math.floor(y / this.chunkM);
    const mask = this.maskFor(cx, cy);
    if (!mask) {
      const t = this.typeAt(x, y);
      return t === Tile.Building || t === Tile.Water;
    }
    const n = this.chunkM / MASK_M;
    const col = Math.floor((x - cx * this.chunkM) / MASK_M);
    const row = Math.floor((y - cy * this.chunkM) / MASK_M);
    return mask[row * n + col] === 1;
  }

  private readonly masks = new Map<string, Uint8Array>();
  private readonly dirtyMasks = new Set<string>();

  private touchMasks(cx: number, cy: number) {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) this.dirtyMasks.add(`${cx + dx}_${cy + dy}`);
  }

  /** The collision mask of a loaded chunk, (re)built on demand. */
  maskFor(cx: number, cy: number): Uint8Array | null {
    const key = `${cx}_${cy}`;
    const chunk = this.chunks.get(key);
    if (!chunk) return null;
    let mask = this.masks.get(key);
    if (mask && !this.dirtyMasks.has(key)) return mask;
    const n = this.chunkM / MASK_M;
    mask = new Uint8Array(n * n);
    const ox = cx * this.chunkM;
    const oy = cy * this.chunkM;
    const grid = { cols: n, rows: n, tileM: MASK_M };
    const local = (r: Float32Array) => {
      const out = new Array<number>(r.length);
      for (let i = 0; i < r.length; i += 2) {
        out[i] = r[i] - ox;
        out[i + 1] = r[i + 1] - oy;
      }
      return out;
    };
    const solid = (c: number, r: number) => (mask![r * n + c] = 1);
    const clear = (c: number, r: number) => (mask![r * n + c] = 0);
    for (const s of chunk.shapes) if (s.kind === Shape.Water) fillPolygon(s.rings.map(local), grid, solid);
    // buildings belong to the chunk holding their centre but may reach into this one
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.chunks.get(`${cx + dx}_${cy + dy}`);
        if (!c) continue;
        for (const s of c.shapes) {
          if (s.kind !== Shape.Building) continue;
          const [x0, y0, x1, y1] = ringBounds(s.rings[0]);
          if (x1 < ox || y1 < oy || x0 > ox + this.chunkM || y0 > oy + this.chunkM) continue;
          fillPolygon(s.rings.map(local), grid, solid);
        }
      }
    }
    // roads always stay drivable (bridges over the river, footprints drawn over a street)
    for (const s of chunk.shapes) if (s.kind === Shape.Bridge) fillPolygon(s.rings.map(local), grid, clear);
    for (const e of chunk.edges) strokePolyline(local(e.pts), Math.max(1.5, e.width / 2 - 0.4), grid, clear);
    this.masks.set(key, mask);
    this.dirtyMasks.delete(key);
    return mask;
  }

  /** Legal ways out of a node, honouring one-way streets. */
  linksFrom(node: number): NodeLink[] {
    return this.out.get(node) ?? [];
  }

  /** Every way out of a node, against the traffic too. */
  anyLinksFrom(node: number): NodeLink[] {
    return this.both.get(node) ?? [];
  }

  loadedEdges(): Edge[] {
    return [...this.edgeRefs.values()].map((r) => r.edge);
  }

  /** Edges stored in the chunks around (x, y) — the candidates for nearest-road queries. */
  edgesNear(x: number, y: number): Edge[] {
    const cx = Math.floor(x / this.chunkM);
    const cy = Math.floor(y / this.chunkM);
    const seen = new Set<number>();
    const out: Edge[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.chunks.get(`${cx + dx}_${cy + dy}`);
        if (!c) continue;
        for (const e of c.edges) {
          if (seen.has(e.id)) continue;
          seen.add(e.id);
          out.push(e);
        }
      }
    }
    return out;
  }
}
