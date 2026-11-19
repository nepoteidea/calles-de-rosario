// A tiny synthetic city for tests: one 64×64-tile chunk (256 m square) with a
// two-way avenue running east–west and a one-way street running south–north,
// crossing at the centre. Everything else is buildings with sidewalks around
// the roads.

import { Tile, packTile, type ChunkData, type Edge, type MapMeta } from '../../src/game/map/format.ts';
import { World } from '../../src/game/world/world.ts';

export const SIZE = 64;
export const TILE_M = 4;
export const MID = 128; // metres

export function edge(id: number, from: number, to: number, pts: number[], opts: Partial<Edge> = {}): Edge {
  return {
    id,
    from,
    to,
    name: 1,
    cls: 2,
    lanes: 2,
    oneway: false,
    width: 8,
    pts: Float32Array.from(pts),
    ...opts,
  };
}

/** Node 0 = west end, 1 = centre, 2 = east end, 3 = south end, 4 = north end. */
export function testEdges(): Edge[] {
  return [
    edge(0, 0, 1, [0, MID, MID, MID], { name: 1 }),
    edge(1, 1, 2, [MID, MID, 256, MID], { name: 1 }),
    edge(2, 3, 1, [MID, 256, MID, MID], { name: 2, oneway: true }),
    edge(3, 1, 4, [MID, MID, MID, 0], { name: 2, oneway: true }),
  ];
}

export function testChunk(): ChunkData {
  const tiles = new Uint8Array(SIZE * SIZE).fill(packTile(Tile.Building, 3));
  const heights = new Uint8Array(SIZE * SIZE).fill(3);
  const mid = MID / TILE_M;
  for (let i = 0; i < SIZE; i++) {
    for (let d = -3; d < 3; d++) {
      const road = d >= -1 && d < 1;
      const t = road ? Tile.Road : Tile.Sidewalk;
      tiles[(mid + d) * SIZE + i] = t;
      heights[(mid + d) * SIZE + i] = 0;
      tiles[i * SIZE + mid + d] = tiles[i * SIZE + mid + d] === Tile.Road ? Tile.Road : t;
      heights[i * SIZE + mid + d] = 0;
    }
  }
  return { cx: 0, cy: 0, tiles, heights, edges: testEdges() };
}

export function testMeta(overrides: Partial<MapMeta> = {}): MapMeta {
  return {
    version: 'test',
    attribution: '© OpenStreetMap contributors (ODbL)',
    bbox: [-32.96, -60.66, -32.93, -60.62],
    tileM: TILE_M,
    chunk: SIZE,
    width: SIZE,
    height: SIZE,
    chunks: ['0_0'],
    names: ['', 'Avenida Pellegrini', 'Laprida'],
    places: {
      start: { label: 'Inicio', x: MID - 8, y: MID + 8 },
      monumento: { label: 'Monumento', x: 230, y: MID },
      taller: { label: 'Taller', x: 20, y: MID },
      laprida_cordoba: { label: 'Laprida y Córdoba', x: MID + 8, y: 60 },
      oronio_rioja: { label: 'Oroño y La Rioja', x: 60, y: MID },
      sarmiento_mendoza: { label: 'Sarmiento y Mendoza', x: MID - 8, y: 200 },
      balcarce_jujuy: { label: 'Balcarce y Jujuy', x: 200, y: MID + 8 },
      francia_salta: { label: 'Francia y Salta', x: 40, y: MID - 8 },
      corrientes_pellegrini: { label: 'Corrientes y Pellegrini', x: MID + 8, y: 230 },
      italia_tucuman: { label: 'Italia y Tucumán', x: 180, y: MID },
    },
    neighbourhoods: [
      { name: 'Centro', x: 200, y: 60 },
      { name: 'Pichincha', x: 30, y: 30 },
    ],
    phases: [
      { id: 1, name: 'Centro y Pichincha', rect: [0, 0, 256, 200] },
      { id: 2, name: 'Norte', rect: [0, 0, 256, 256] },
      { id: 3, name: 'Resto', rect: [0, 0, 256, 256] },
    ],
    overview: { cell: 16, cols: 16, rows: 16 },
    ...overrides,
  };
}

export function testWorld(meta = testMeta()): World {
  const w = new World(meta, async () => null);
  w.add(testChunk());
  return w;
}
