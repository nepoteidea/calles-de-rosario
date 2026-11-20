import { describe, expect, it } from 'vitest';
import {
  clipPolyline,
  clipRing,
  insideRings,
  lineLength,
  offsetPolyline,
  openRing,
  orientedBox,
  ringArea,
  ringBounds,
  ringCentroid,
  segDist2,
  simplify,
} from '../../src/game/map/geometry.ts';
import {
  EdgeFlag,
  Line,
  RoadClass,
  Shape,
  Tile,
  decodeChunk,
  encodeChunk,
} from '../../src/game/map/format.ts';
import { corridorRange, defaultCorridor, lanesFor, splitCorridor } from '../../src/game/map/roads.ts';
import { prepareBuildings, prepareTrees } from '../../src/game/render/buildings.ts';
import { World } from '../../src/game/world/world.ts';
import { MID, SIZE, TILE_M, testChunk, testMeta } from './helpers.ts';

const square = [0, 0, 10, 0, 10, 10, 0, 10];

describe('polygon helpers', () => {
  it('measures area, bounds and centroid', () => {
    expect(Math.abs(ringArea(square))).toBe(100);
    expect(ringBounds(square)).toEqual([0, 0, 10, 10]);
    expect(ringCentroid(square)).toEqual([5, 5]);
    // a degenerate ring falls back to its bounding box centre
    expect(ringCentroid([0, 0, 4, 0, 8, 0])).toEqual([4, 0]);
  });

  it('tests points with the even-odd rule', () => {
    const hole = [3, 3, 7, 3, 7, 7, 3, 7];
    expect(insideRings([square], 5, 5)).toBe(true);
    expect(insideRings([square, hole], 5, 5)).toBe(false);
    expect(insideRings([square, hole], 1, 1)).toBe(true);
    expect(insideRings([square], 11, 5)).toBe(false);
  });

  it('drops the closing point of an OSM ring', () => {
    expect(openRing([0, 0, 1, 0, 1, 1, 0, 0])).toEqual([0, 0, 1, 0, 1, 1]);
    expect(openRing([0, 0, 1, 0, 1, 1])).toEqual([0, 0, 1, 0, 1, 1]);
  });

  it('simplifies nearly straight runs', () => {
    const wobbly = [0, 0, 5, 0.05, 10, 0, 10, 10];
    expect(simplify(wobbly, 0.2)).toEqual([0, 0, 10, 0, 10, 10]);
    expect(simplify([0, 0, 1, 1], 0.2)).toEqual([0, 0, 1, 1]);
  });

  it('clips a ring to a rectangle', () => {
    const clipped = clipRing(square, 5, -1, 20, 20);
    expect(Math.abs(ringArea(clipped))).toBeCloseTo(50);
    expect(clipRing(square, 20, 20, 30, 30)).toEqual([]);
  });

  it('clips a polyline into the pieces inside a rectangle', () => {
    const pieces = clipPolyline([-5, 5, 15, 5, 15, 20, -5, 20], 0, 0, 10, 10);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toEqual([0, 5, 10, 5]);
    // leaves and re-enters: two pieces
    const zig = clipPolyline([2, 2, 2, 15, 8, 15, 8, 2], 0, 0, 10, 10);
    expect(zig).toHaveLength(2);
    expect(clipPolyline([20, 20, 30, 30], 0, 0, 10, 10)).toEqual([]);
  });

  it('offsets a polyline to its right (y down)', () => {
    // heading east, the right-hand side is south (+y)
    expect(offsetPolyline([0, 0, 10, 0], 2)).toEqual([0, 2, 10, 2]);
    expect(lineLength([0, 0, 3, 4, 3, 10])).toBe(11);
  });

  it('finds the oriented box of a rotated rectangle', () => {
    const c = Math.cos(0.5),
      s = Math.sin(0.5);
    const rot = (x: number, y: number) => [x * c - y * s, x * s + y * c];
    const r = [...rot(-20, -5), ...rot(20, -5), ...rot(20, 5), ...rot(-20, 5)];
    const box = orientedBox(r);
    expect(box.hw).toBeCloseTo(20);
    expect(box.hh).toBeCloseTo(5);
    expect(box.cx).toBeCloseTo(0);
    expect(Math.abs(Math.sin(box.angle - 0.5))).toBeCloseTo(0);
  });

  it('measures point–segment distance', () => {
    expect(segDist2(5, 3, 0, 0, 10, 0)).toBe(9);
    expect(segDist2(-3, 4, 0, 0, 10, 0)).toBe(25);
  });
});

describe('street width model', () => {
  it('uses the 20-vara street for a plain calle', () => {
    expect(defaultCorridor(RoadClass.Residential, true)).toBeCloseTo(17.3);
    expect(defaultCorridor(RoadClass.Primary, false)).toBeGreaterThan(
      defaultCorridor(RoadClass.Primary, true),
    );
    expect(defaultCorridor(RoadClass.Service, false)).toBe(0);
    expect(corridorRange(RoadClass.Residential)[0]).toBeLessThan(17.3);
    expect(corridorRange(RoadClass.Service)).toEqual([8, 30]);
  });

  it('splits a corridor into asphalt and two sidewalks', () => {
    const { width, sidewalk } = splitCorridor(17.3, RoadClass.Residential);
    expect(width + sidewalk * 2).toBeCloseTo(17.3, 0);
    expect(sidewalk).toBeGreaterThan(2);
    expect(width).toBeLessThanOrEqual(11);
  });

  it('gives deep front gardens to the sidewalk band, not to the asphalt', () => {
    const { width, sidewalk } = splitCorridor(26, RoadClass.Residential);
    expect(width).toBe(11);
    expect(sidewalk).toBeGreaterThan(5);
    // a too-narrow corridor keeps a drivable minimum
    expect(splitCorridor(9, RoadClass.Residential).width).toBe(6.5);
    expect(splitCorridor(20, RoadClass.Service).width).toBeLessThanOrEqual(12);
  });

  it('fits lanes to the carriageway', () => {
    expect(lanesFor(10.7, RoadClass.Residential, true)).toBe(2); // plus a parking lane
    expect(lanesFor(20, RoadClass.Primary, false)).toBe(6);
    expect(lanesFor(7, RoadClass.Secondary, false)).toBe(2);
    expect(lanesFor(5, RoadClass.Service, false)).toBe(1);
    expect(lanesFor(30, RoadClass.Primary, true, '3')).toBe(3);
  });
});

describe('chunk codec v2', () => {
  it('round-trips widths, flags, shapes and lines', () => {
    const chunk = testChunk();
    chunk.cx = 2;
    chunk.cy = 1;
    const ox = 2 * SIZE * TILE_M,
      oy = SIZE * TILE_M;
    chunk.edges[0].flags = EdgeFlag.Dual;
    chunk.edges[0].width = 7.3;
    chunk.edges[0].sidewalk = 3.4;
    chunk.shapes.push({
      kind: Shape.Water,
      height: 0,
      variant: 0,
      landmark: 2,
      rings: [Float32Array.from([ox + 1.25, oy + 2, ox + 20, oy + 2, ox + 20, oy + 30])],
    });
    chunk.lines.push({ kind: Line.Rail, width: 3, pts: Float32Array.from([ox - 5, oy, ox + 300, oy + 10]) });
    const back = decodeChunk(encodeChunk(chunk, SIZE, TILE_M), SIZE, TILE_M);
    expect(back.edges[0].width).toBeCloseTo(7.3);
    expect(back.edges[0].sidewalk).toBeCloseTo(3.4);
    expect(back.edges[0].flags & EdgeFlag.Dual).toBeTruthy();
    expect(back.edges[2].oneway).toBe(true);
    const water = back.shapes.find((s) => s.kind === Shape.Water)!;
    expect(water.landmark).toBe(2);
    expect(water.rings[0][0]).toBeCloseTo(ox + 1.3, 1);
    expect(back.shapes.filter((s) => s.kind === Shape.Building)).toHaveLength(4);
    expect(back.lines[0].kind).toBe(Line.Rail);
    expect(back.lines[0].pts[2]).toBeCloseTo(ox + 300, 1);
  });
});

describe('collision mask', () => {
  it('stops at the wall drawn, to the metre', () => {
    const w = new World(testMeta(), async () => null);
    w.add(testChunk());
    // the block's east face is at MID − 12
    expect(w.isSolid(MID - 12.5, MID - 30)).toBe(true);
    expect(w.isSolid(MID - 11.5, MID - 30)).toBe(false);
    expect(w.isSolid(MID, MID)).toBe(false);
    expect(w.isSolid(-1, 10)).toBe(true);
  });

  it('keeps the carriageway drivable even under a footprint', () => {
    const chunk = testChunk();
    chunk.shapes.push({
      kind: Shape.Building,
      height: 6,
      variant: 0,
      landmark: 0,
      rings: [
        Float32Array.from([MID - 30, MID - 2, MID - 20, MID - 2, MID - 20, MID + 2, MID - 30, MID + 2]),
      ],
    });
    const w = new World(testMeta(), async () => null);
    w.add(chunk);
    expect(w.isSolid(MID - 25, MID)).toBe(false);
  });

  it('rebuilds when a neighbouring chunk brings a building across the edge', () => {
    const meta = testMeta({ width: SIZE * 2, chunks: ['0_0', '1_0'] });
    const w = new World(meta, async () => null);
    const a = testChunk();
    a.shapes = [];
    w.add(a);
    expect(w.isSolid(250, 20)).toBe(false);
    const b = testChunk();
    b.cx = 1;
    b.edges = [];
    b.shapes = [
      {
        kind: Shape.Building,
        height: 9,
        variant: 0,
        landmark: 0,
        rings: [Float32Array.from([245, 10, 300, 10, 300, 30, 245, 30])],
      },
    ];
    w.add(b);
    expect(w.isSolid(250, 20)).toBe(true);
  });
});

describe('render preparation', () => {
  it('turns building shapes into views with roof clutter', () => {
    const views = prepareBuildings(testChunk(), testMeta().landmarks);
    expect(views).toHaveLength(4);
    expect(views[0].h).toBe(9);
    expect(views.some((v) => v.details.length > 0)).toBe(true);
    for (const v of views) expect(Math.abs(v.wind)).toBe(1);
  });

  it('styles landmark buildings by kind', () => {
    const chunk = testChunk();
    chunk.shapes[0].landmark = 1;
    const views = prepareBuildings(chunk, testMeta().landmarks);
    expect(views[0].kind).toBe('monument');
    expect(views[0].details).toEqual([]);
  });

  it('plants street trees on the sidewalks', () => {
    const w = new World(testMeta(), async () => null);
    const chunk = testChunk();
    w.add(chunk);
    const trees = prepareTrees(chunk, (x, y) => w.tileAt(x, y), 256);
    expect(trees.length % 4).toBe(0);
    expect(trees.length).toBeGreaterThan(0);
    for (let i = 0; i < trees.length; i += 4) expect(w.typeAt(trees[i], trees[i + 1])).toBe(Tile.Sidewalk);
  });
});
