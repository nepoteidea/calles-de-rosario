// Paints the ground layer of the city (everything that has no height) into
// small cached tiles: land cover, parks, water, sidewalks with curbs, asphalt,
// lane markings, zebra crossings, rail lines. Buildings and trees are drawn
// per frame on top (see buildings.ts), so they can lean with the camera.

import { offsetPolyline, orientedBox } from '../map/geometry.ts';
import { Line, RoadClass, Shape, type ChunkData, type Edge, type ShapeData } from '../map/format.ts';
import { makeTextures, type TextureName } from './textures.ts';

/** Side of a ground tile in metres. Chunks (256 m) split evenly into these. */
export const GROUND_TILE_M = 32;

const CURB = '#ddd8c8';
const LANE_WHITE = 'rgba(236,234,226,0.85)';
const LANE_YELLOW = 'rgba(240,196,60,0.9)';

export class GroundPainter {
  readonly ppm: number;
  private readonly textures: ReturnType<typeof makeTextures>;
  private readonly patterns = new Map<string, CanvasPattern>();
  private g!: CanvasRenderingContext2D;

  constructor(ppm: number) {
    this.ppm = ppm;
    this.textures = makeTextures(ppm);
  }

  private pattern(name: TextureName): CanvasPattern | string {
    let p = this.patterns.get(name);
    if (!p) {
      p = this.g.createPattern(this.textures[name], 'repeat')!;
      // one texture pixel per canvas pixel, anchored to the world origin
      p.setTransform(new DOMMatrix([1 / this.ppm, 0, 0, 1 / this.ppm, 0, 0]));
      this.patterns.set(name, p);
    }
    return p;
  }

  /** Paints the ground tile whose top-left corner is (x0, y0) in world metres. */
  paint(chunk: ChunkData, x0: number, y0: number): HTMLCanvasElement {
    const size = Math.round(GROUND_TILE_M * this.ppm);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d')!;
    this.g = g;
    this.patterns.clear();
    g.setTransform(this.ppm, 0, 0, this.ppm, -x0 * this.ppm, -y0 * this.ppm);
    g.lineJoin = 'round';
    g.lineCap = 'round';

    g.fillStyle = this.pattern('patio');
    g.fillRect(x0, y0, GROUND_TILE_M, GROUND_TILE_M);

    const pad = 30;
    const near = (b: ArrayLike<number>) => {
      for (let i = 0; i < b.length; i += 2) {
        if (
          b[i] > x0 - pad &&
          b[i] < x0 + GROUND_TILE_M + pad &&
          b[i + 1] > y0 - pad &&
          b[i + 1] < y0 + GROUND_TILE_M + pad
        )
          return true;
      }
      return false;
    };
    const shapeNear = (s: ShapeData) => s.rings.some((r) => r.length > 0) && this.inside(s, x0, y0);
    for (const s of chunk.shapes) if (s.kind !== Shape.Building && shapeNear(s)) this.area(s);

    const lines = chunk.lines.filter((l) => near(l.pts) || l.pts.length > 40);
    for (const l of lines)
      if (l.kind === Line.Footway || l.kind === Line.Path) this.footway(l.kind, l.width, l.pts);

    const edges = chunk.edges;
    // sidewalks
    for (const e of edges) {
      if (e.sidewalk <= 0) continue;
      g.strokeStyle = this.pattern('stone');
      g.lineWidth = e.width + e.sidewalk * 2;
      this.trace(e.pts);
      g.stroke();
    }
    // boulevard medians
    for (const l of lines) {
      if (l.kind !== Line.Median) continue;
      g.strokeStyle = CURB;
      g.lineWidth = l.width + 0.6;
      g.lineCap = 'butt';
      this.trace(l.pts);
      g.stroke();
      g.strokeStyle = this.pattern('grass');
      g.lineWidth = l.width - 0.2;
      g.stroke();
      g.lineCap = 'round';
    }
    // curbs, then asphalt over all of them so intersections stay clean
    for (const e of edges) {
      if (e.sidewalk <= 0 && e.cls !== RoadClass.Motorway) continue;
      g.strokeStyle = CURB;
      g.lineWidth = e.width + 0.7;
      this.trace(e.pts);
      g.stroke();
    }
    for (const e of edges) {
      g.strokeStyle = '#3b3e4d';
      g.lineWidth = e.width + 0.1;
      this.trace(e.pts);
      g.stroke();
    }
    for (const e of edges) {
      g.strokeStyle = this.pattern(e.cls <= RoadClass.Primary ? 'avenue' : 'asphalt');
      g.lineWidth = Math.max(2, e.width - 0.5);
      this.trace(e.pts);
      g.stroke();
    }
    this.markings(edges);
    this.crossings(edges);
    for (const l of lines) {
      if (l.kind === Line.Rail) this.rail(l.pts);
      else if (l.kind === Line.Runway) this.runway(l.width, l.pts);
      else if (l.kind === Line.Track) this.track(l.width, l.pts);
    }
    return canvas;
  }

  private inside(s: ShapeData, x0: number, y0: number) {
    for (const r of s.rings) {
      let ax = Infinity,
        ay = Infinity,
        bx = -Infinity,
        by = -Infinity;
      for (let i = 0; i < r.length; i += 2) {
        if (r[i] < ax) ax = r[i];
        if (r[i] > bx) bx = r[i];
        if (r[i + 1] < ay) ay = r[i + 1];
        if (r[i + 1] > by) by = r[i + 1];
      }
      if (bx >= x0 && ax <= x0 + GROUND_TILE_M && by >= y0 && ay <= y0 + GROUND_TILE_M) return true;
    }
    return false;
  }

  private trace(pts: ArrayLike<number>) {
    const g = this.g;
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  }

  private rings(rings: Float32Array[]) {
    const g = this.g;
    g.beginPath();
    for (const r of rings) {
      g.moveTo(r[0], r[1]);
      for (let i = 2; i < r.length; i += 2) g.lineTo(r[i], r[i + 1]);
      g.closePath();
    }
  }

  private area(s: ShapeData) {
    const g = this.g;
    const fill = (style: string | CanvasPattern, edge?: string, edgeW = 0.5) => {
      this.rings(s.rings);
      g.fillStyle = style;
      g.fill('evenodd');
      if (edge) {
        g.strokeStyle = edge;
        g.lineWidth = edgeW;
        g.stroke();
      }
    };
    switch (s.kind) {
      case Shape.Park:
        fill(this.pattern(s.variant === 1 ? 'forest' : 'park'), 'rgba(40,70,30,0.6)', 0.4);
        break;
      case Shape.Grass:
        fill(this.pattern('grass'));
        break;
      case Shape.Water:
        fill(this.pattern('water'), 'rgba(205,220,212,0.45)', 1);
        break;
      case Shape.Sand:
        fill(this.pattern('sand'));
        break;
      case Shape.Plaza:
        fill(this.pattern(s.variant === 5 ? 'travertine' : 'plaza'), CURB, 0.35);
        break;
      case Shape.Bridge:
      case Shape.Apron:
        fill(this.pattern('concrete'), '#55575f', 0.6);
        break;
      case Shape.Parking:
        fill(this.pattern('asphalt'), CURB, 0.4);
        this.stripes(s, 2.6, 'rgba(236,234,226,0.7)', 0.12, 0.8);
        break;
      case Shape.Pitch:
        this.pitch(s);
        break;
      case Shape.Track:
        fill('#a65a3c', 'rgba(255,255,255,0.7)', 0.25);
        break;
      case Shape.Cemetery:
        fill(this.pattern('grass'), '#8a8578', 0.8);
        this.stripes(s, 2.4, 'rgba(190,188,180,0.95)', 1.0, 0.55, true);
        break;
      default:
        fill(this.pattern('grass'));
    }
  }

  /** Parallel marks inside a shape, aligned with its longest side. */
  private stripes(s: ShapeData, step: number, color: string, width: number, len: number, dashed = false) {
    const g = this.g;
    const box = orientedBox(s.rings[0]);
    g.save();
    this.rings(s.rings);
    g.clip('evenodd');
    g.translate(box.cx, box.cy);
    g.rotate(box.angle);
    g.fillStyle = color;
    for (let u = -box.hw; u <= box.hw; u += step) {
      if (dashed) for (let v = -box.hh; v < box.hh; v += 1.8) g.fillRect(u, v, width, len);
      else g.fillRect(u, -box.hh, width, box.hh * 2 * len);
    }
    g.restore();
  }

  private pitch(s: ShapeData) {
    const g = this.g;
    const box = orientedBox(s.rings[0]);
    g.save();
    this.rings(s.rings);
    g.fillStyle = '#4f9a45';
    g.fill('evenodd');
    g.clip('evenodd');
    g.translate(box.cx, box.cy);
    g.rotate(box.angle);
    g.fillStyle = '#5aa94f';
    const band = Math.max(3, box.hw / 6);
    for (let u = -box.hw; u < box.hw; u += band * 2) g.fillRect(u, -box.hh, band, box.hh * 2);
    const hw = box.hw - 1.2,
      hh = box.hh - 1.2;
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 0.15;
    g.strokeRect(-hw, -hh, hw * 2, hh * 2);
    if (hw > 10 && hh > 6) {
      g.beginPath();
      g.moveTo(0, -hh);
      g.lineTo(0, hh);
      g.stroke();
      g.beginPath();
      g.arc(0, 0, Math.min(9.15, hh * 0.35), 0, Math.PI * 2);
      g.stroke();
      const bd = Math.min(16.5, hw * 0.3),
        bw = Math.min(20, hh * 0.6);
      g.strokeRect(-hw, -bw, bd, bw * 2);
      g.strokeRect(hw - bd, -bw, bd, bw * 2);
    }
    g.restore();
  }

  private footway(kind: number, width: number, pts: ArrayLike<number>) {
    const g = this.g;
    g.strokeStyle = kind === Line.Path ? this.pattern('dirt') : this.pattern(width > 5 ? 'plaza' : 'sand');
    g.lineWidth = width;
    this.trace(pts);
    g.stroke();
  }

  private markings(edges: Edge[]) {
    const g = this.g;
    g.lineCap = 'butt';
    g.lineWidth = 0.15;
    for (const e of edges) {
      if (e.cls === RoadClass.Service || e.width < 5.5) continue;
      const pts = trim(e.pts, 9);
      if (!pts) continue;
      if (!e.oneway) {
        g.strokeStyle = LANE_YELLOW;
        g.setLineDash(e.cls <= RoadClass.Secondary ? [] : [3, 3]);
        this.trace(pts);
        g.stroke();
        const per = Math.max(1, e.lanes / 2);
        const lw = e.width / 2 / per;
        g.strokeStyle = LANE_WHITE;
        g.setLineDash([3, 4.5]);
        for (let i = 1; i < per; i++) {
          for (const sgn of [1, -1]) {
            this.trace(offsetPolyline(pts, sgn * i * lw));
            g.stroke();
          }
        }
      } else if (e.lanes > 1) {
        const park = e.cls >= RoadClass.Tertiary ? 2.4 : 0;
        const lw = (e.width - park) / e.lanes;
        g.strokeStyle = LANE_WHITE;
        g.setLineDash([3, 4.5]);
        for (let i = 1; i < e.lanes; i++) {
          this.trace(offsetPolyline(pts, -e.width / 2 + park + i * lw));
          g.stroke();
        }
      }
    }
    g.setLineDash([]);
    g.lineCap = 'round';
  }

  /** Zebra crossings at the corners of every junction. */
  private crossings(edges: Edge[]) {
    const g = this.g;
    const degree = new Map<number, number>();
    const reach = new Map<number, number>();
    for (const e of edges) {
      for (const n of [e.from, e.to]) {
        degree.set(n, (degree.get(n) ?? 0) + 1);
        reach.set(n, Math.max(reach.get(n) ?? 0, e.width / 2 + e.sidewalk));
      }
    }
    g.fillStyle = 'rgba(240,238,230,0.88)';
    for (const e of edges) {
      if (e.cls === RoadClass.Motorway || e.cls === RoadClass.Service || e.sidewalk <= 0) continue;
      for (const [node, fromStart] of [
        [e.from, true],
        [e.to, false],
      ] as const) {
        if ((degree.get(node) ?? 0) < 3) continue;
        const at = alongFromEnd(e.pts, (reach.get(node) ?? 6) + 0.8, fromStart);
        if (!at) continue;
        g.save();
        g.translate(at.x, at.y);
        g.rotate(at.angle);
        // +x points away from the junction
        const half = e.width / 2 - 0.3;
        for (let v = -half; v < half - 0.3; v += 1) g.fillRect(0, v, 3, 0.5);
        g.fillRect(3.6, -half, 0.4, half * 2);
        g.restore();
      }
    }
  }

  private rail(pts: ArrayLike<number>) {
    const g = this.g;
    g.lineCap = 'butt';
    g.strokeStyle = '#7b7166';
    g.lineWidth = 3.4;
    this.trace(pts);
    g.stroke();
    g.strokeStyle = '#5a4632';
    g.lineWidth = 2.6;
    g.setLineDash([0.25, 0.45]);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = '#c9c9cf';
    g.lineWidth = 0.18;
    for (const d of [0.72, -0.72]) {
      this.trace(offsetPolyline(pts, d));
      g.stroke();
    }
    g.lineCap = 'round';
  }

  private track(width: number, pts: ArrayLike<number>) {
    const g = this.g;
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = width + 0.6;
    this.trace(pts);
    g.stroke();
    g.strokeStyle = this.pattern('dirt');
    g.lineWidth = width;
    g.stroke();
  }

  private runway(width: number, pts: ArrayLike<number>) {
    const g = this.g;
    g.lineCap = 'butt';
    g.strokeStyle = this.pattern('avenue');
    g.lineWidth = width;
    this.trace(pts);
    g.stroke();
    g.strokeStyle = 'rgba(240,240,240,0.9)';
    g.lineWidth = 1;
    g.setLineDash([30, 20]);
    g.stroke();
    g.setLineDash([]);
    g.lineCap = 'round';
  }
}

/** Cuts `d` metres off both ends of a polyline; null when nothing is left. */
function trim(pts: Float32Array, d: number): number[] | null {
  const n = pts.length / 2;
  let total = 0;
  for (let i = 1; i < n; i++)
    total += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
  if (total <= d * 2 + 2) return null;
  const out: number[] = [];
  let walked = 0;
  for (let i = 1; i < n; i++) {
    const ax = pts[i * 2 - 2],
      ay = pts[i * 2 - 1],
      bx = pts[i * 2],
      by = pts[i * 2 + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const s0 = Math.max(0, d - walked),
      s1 = Math.min(len, total - d - walked);
    if (s1 > s0) {
      if (!out.length) out.push(ax + ((bx - ax) * s0) / len, ay + ((by - ay) * s0) / len);
      out.push(ax + ((bx - ax) * s1) / len, ay + ((by - ay) * s1) / len);
    }
    walked += len;
  }
  return out.length >= 4 ? out : null;
}

/** Point and heading `d` metres into a polyline from one of its ends. */
function alongFromEnd(pts: Float32Array, d: number, fromStart: boolean) {
  const n = pts.length / 2;
  let walked = 0;
  for (let k = 1; k < n; k++) {
    const i = fromStart ? k - 1 : n - k;
    const j = fromStart ? k : n - k - 1;
    const ax = pts[i * 2],
      ay = pts[i * 2 + 1],
      bx = pts[j * 2],
      by = pts[j * 2 + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (walked + len >= d) {
      const t = (d - walked) / len;
      const ang = Math.atan2(by - ay, bx - ax);
      return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, angle: fromStart ? ang : ang + Math.PI };
    }
    walked += len;
  }
  return null;
}
