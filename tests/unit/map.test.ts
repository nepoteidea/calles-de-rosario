import { describe, expect, it } from 'vitest';
import {
  Tile,
  decodeChunk,
  decodeOverview,
  encodeChunk,
  encodeOverview,
  packTile,
  tileType,
  tileVariant,
} from '../../src/game/map/format.ts';
import { makeProjection } from '../../src/game/map/projection.ts';
import {
  assembleRings,
  distToSegment2,
  fillPolygon,
  reversePts,
  strokePolyline,
} from '../../src/game/map/raster.ts';
import {
  buildGraph,
  cruiseSpeed,
  isPedestrianWay,
  laneCount,
  nameMatches,
  normalizeName,
  onewayDir,
  roadClass,
  roadWidth,
} from '../../src/game/map/roads.ts';
import { SIZE, testChunk } from './helpers.ts';

describe('tile bytes', () => {
  it('packs type and variant into one byte', () => {
    const b = packTile(Tile.Building, 5);
    expect(tileType(b)).toBe(Tile.Building);
    expect(tileVariant(b)).toBe(5);
  });
});

describe('chunk codec', () => {
  it('round-trips tiles, heights and edges', () => {
    const chunk = testChunk();
    const bin = encodeChunk(chunk, SIZE);
    const back = decodeChunk(bin, SIZE);
    expect(back.cx).toBe(0);
    expect(back.tiles).toEqual(chunk.tiles);
    expect(back.heights).toEqual(chunk.heights);
    expect(back.edges).toHaveLength(4);
    expect(back.edges[2].oneway).toBe(true);
    expect(Array.from(back.edges[0].pts)).toEqual(Array.from(chunk.edges[0].pts));
  });

  it('compresses uniform chunks to a handful of bytes', () => {
    const tiles = new Uint8Array(SIZE * SIZE);
    const bin = encodeChunk({ cx: 3, cy: 4, tiles, heights: new Uint8Array(SIZE * SIZE), edges: [] }, SIZE);
    expect(bin.length).toBeLessThan(32);
    expect(decodeChunk(bin.buffer as ArrayBuffer, SIZE).cy).toBe(4);
  });

  it('rejects data that is not a chunk', () => {
    expect(() => decodeChunk(new Uint8Array(16), SIZE)).toThrow(/Not a map chunk/);
  });

  it('rejects a chunk of the wrong size', () => {
    const bin = encodeChunk(testChunk(), SIZE);
    expect(() => decodeChunk(bin, 32)).toThrow(/expected/);
  });

  it('round-trips the overview grid', () => {
    const cells = Uint8Array.from({ length: 1000 }, (_, i) => (i < 600 ? 0 : i % 3));
    expect(decodeOverview(encodeOverview(cells), cells.length)).toEqual(cells);
  });
});

describe('projection', () => {
  const p = makeProjection([-33.035, -60.79, -32.87, -60.61]);

  it('puts the north-west corner at the origin', () => {
    const [x, y] = p.toWorld(-32.87, -60.79);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
  });

  it('measures a degree of latitude as about 111 km', () => {
    const [, y] = p.toWorld(-33.87, -60.79);
    expect(y / 1000).toBeCloseTo(111.2, 0);
  });

  it('round-trips coordinates', () => {
    const [x, y] = p.toWorld(-32.9477, -60.6303);
    const [lat, lon] = p.toLatLon(x, y);
    expect(lat).toBeCloseTo(-32.9477, 6);
    expect(lon).toBeCloseTo(-60.6303, 6);
  });

  it('places the Monumento east of Bv. Oroño', () => {
    const [mx] = p.toWorld(-32.9477, -60.6303);
    const [ox] = p.toWorld(-32.9477, -60.6497);
    expect(mx - ox).toBeGreaterThan(1500);
  });
});

describe('rasterising', () => {
  const g = { cols: 10, rows: 10, tileM: 4 };
  const collect = (fn: (cb: (c: number, r: number) => void) => void) => {
    const out: string[] = [];
    fn((c, r) => out.push(`${c},${r}`));
    return out;
  };

  it('fills tiles whose centres are inside a polygon', () => {
    const tiles = collect((cb) => fillPolygon([[0, 0, 8, 0, 8, 8, 0, 8, 0, 0]], g, cb));
    expect(tiles.sort()).toEqual(['0,0', '0,1', '1,0', '1,1']);
  });

  it('leaves holes empty (even-odd)', () => {
    const outer = [0, 0, 24, 0, 24, 24, 0, 24, 0, 0];
    const hole = [8, 8, 16, 8, 16, 16, 8, 16, 8, 8];
    const tiles = collect((cb) => fillPolygon([outer, hole], g, cb));
    expect(tiles).toHaveLength(36 - 4);
    expect(tiles).not.toContain('2,2');
  });

  it('clips polygons to the grid', () => {
    const tiles = collect((cb) => fillPolygon([[-100, -100, 100, -100, 100, 100, -100, 100]], g, cb));
    expect(tiles).toHaveLength(100);
  });

  it('strokes a thick line', () => {
    const tiles = collect((cb) => strokePolyline([0, 18, 40, 18], 2, g, cb));
    expect(tiles.every((t) => t.endsWith(',4'))).toBe(true);
    expect(tiles).toHaveLength(10);
  });

  it('measures distance to a segment', () => {
    expect(distToSegment2(5, 3, 0, 0, 10, 0)).toBe(9);
    expect(distToSegment2(-3, 4, 0, 0, 10, 0)).toBe(25);
    expect(distToSegment2(1, 1, 0, 0, 0, 0)).toBe(2);
  });

  it('joins multipolygon members into closed rings, whatever their direction', () => {
    const a = [0, 0, 10, 0, 10, 10];
    const b = [0, 0, 0, 10, 10, 10]; // shares both ends with a, drawn the other way
    const rings = assembleRings([a, b]);
    expect(rings).toHaveLength(1);
    const r = rings[0];
    expect(r[0]).toBe(r[r.length - 2]);
    expect(r[1]).toBe(r[r.length - 1]);
    expect(r.length).toBe(10);
  });

  it('reverses point lists', () => {
    expect(reversePts([1, 2, 3, 4, 5, 6])).toEqual([5, 6, 3, 4, 1, 2]);
  });
});

describe('road tagging', () => {
  it('classifies drivable roads and skips the rest', () => {
    expect(roadClass({ highway: 'primary' })).toBe(1);
    expect(roadClass({ highway: 'residential' })).toBe(4);
    expect(roadClass({ highway: 'footway' })).toBeNull();
    expect(roadClass({ highway: 'service', service: 'parking_aisle' })).toBeNull();
    expect(roadClass({ highway: 'residential', access: 'private' })).toBeNull();
    expect(roadClass({ highway: 'pedestrian', area: 'yes' })).toBeNull();
    expect(roadClass({})).toBeNull();
  });

  it('knows pedestrian ways', () => {
    expect(isPedestrianWay({ highway: 'pedestrian' })).toBe(true);
    expect(isPedestrianWay({ highway: 'primary' })).toBe(false);
  });

  it('reads one-way tags', () => {
    expect(onewayDir({ highway: 'residential', oneway: 'yes' })).toBe(1);
    expect(onewayDir({ highway: 'residential', oneway: '-1' })).toBe(-1);
    expect(onewayDir({ highway: 'residential' })).toBe(0);
    expect(onewayDir({ highway: 'primary', junction: 'roundabout' })).toBe(1);
    expect(onewayDir({ highway: 'motorway' })).toBe(1);
    expect(onewayDir({ highway: 'motorway', oneway: 'no' })).toBe(0);
  });

  it('counts lanes from tags or defaults', () => {
    expect(laneCount({ lanes: '3' }, 4, true)).toBe(3);
    expect(laneCount({}, 1, false)).toBe(4);
    expect(laneCount({}, 0, true)).toBe(2);
    expect(laneCount({}, 5, false)).toBe(1);
    expect(laneCount({}, 4, false)).toBe(2);
  });

  it('keeps roads wide enough for two cars', () => {
    expect(roadWidth(1)).toBe(7);
    expect(roadWidth(2)).toBe(8);
    expect(roadWidth(10)).toBe(22);
    expect(cruiseSpeed(4)).toBeLessThan(cruiseSpeed(1));
  });

  it('matches Rosario street names loosely', () => {
    expect(normalizeName('Bulevar Oroño')).toBe('orono');
    expect(nameMatches('Avenida Carlos Pellegrini', 'Pellegrini')).toBe(true);
    expect(nameMatches('La Rioja', 'Rioja')).toBe(true);
    expect(nameMatches('Córdoba', 'Cordoba')).toBe(true);
    expect(nameMatches('Riojana', 'Rioja')).toBe(false);
    expect(nameMatches('Laprida', '')).toBe(false);
  });
});

describe('road graph', () => {
  it('splits ways at shared nodes', () => {
    const { edges, nodePos } = buildGraph([
      { nodes: [1, 2, 3], pts: [0, 0, 10, 0, 20, 0], tags: { highway: 'residential', name: 'Laprida' } },
      { nodes: [4, 2, 5], pts: [10, -10, 10, 0, 10, 10], tags: { highway: 'residential', name: 'Córdoba' } },
      { nodes: [6, 7], pts: [0, 0, 1, 1], tags: { highway: 'footway' } },
    ]);
    expect(edges).toHaveLength(4);
    expect(new Set(edges.map((e) => e.name))).toEqual(new Set(['Laprida', 'Córdoba']));
    // the crossing node is shared
    const centre = edges.filter((e) => e.from === edges[0].to || e.to === edges[0].to);
    expect(centre.length).toBeGreaterThanOrEqual(3);
    expect(nodePos.length).toBe(5 * 2);
  });

  it('flips ways tagged oneway=-1 so edges always run with traffic', () => {
    const { edges } = buildGraph([
      { nodes: [1, 2], pts: [0, 0, 10, 0], tags: { highway: 'residential', oneway: '-1' } },
    ]);
    expect(edges[0].oneway).toBe(true);
    expect(edges[0].pts[0]).toBe(10);
  });
});
