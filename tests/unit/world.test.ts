import { describe, expect, it, vi } from 'vitest';
import { Tile, encodeChunk } from '../../src/game/map/format.ts';
import { World, fetchChunkOverHttp } from '../../src/game/world/world.ts';
import {
  angleDiff,
  nearestEdge,
  neighbourhoodAt,
  phaseAt,
  pointAt,
  polylineLength,
  projectOnto,
  shortStreet,
  streetLabel,
} from '../../src/game/world/geo.ts';
import { MID, SIZE, testChunk, testMeta, testWorld } from './helpers.ts';

describe('World', () => {
  it('answers tile queries from loaded chunks', () => {
    const w = testWorld();
    expect(w.typeAt(MID, MID)).toBe(Tile.Road);
    expect(w.typeAt(MID + 20, MID - 20)).toBe(Tile.Building);
    expect(w.typeAt(MID + 10, MID - 7)).toBe(Tile.Sidewalk);
    expect(w.isSolid(10, 10)).toBe(true);
    expect(w.isSolid(MID, 10)).toBe(false);
    expect(w.heightAt(10, 10)).toBe(3);
  });

  it('treats the outside of the map as water', () => {
    const w = testWorld();
    expect(w.typeAt(-5, 10)).toBe(Tile.Water);
    expect(w.isSolid(300, 10)).toBe(true);
    expect(w.inBounds(255, 255)).toBe(true);
  });

  it('reads unloaded chunks as open ground', () => {
    const w = new World(testMeta(), async () => null);
    expect(w.typeAt(MID, MID)).toBe(Tile.Ground);
    expect(w.heightAt(MID, MID)).toBe(0);
    expect(w.isLoaded(MID, MID)).toBe(false);
  });

  it('streams chunks through the fetcher once', async () => {
    const fetcher = vi.fn(async () => encodeChunk(testChunk(), SIZE).buffer as ArrayBuffer);
    const w = new World(testMeta(), fetcher);
    await Promise.all([w.ensureAround(MID, MID, 100), w.ensureAround(MID, MID, 100)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(w.isLoaded(MID, MID)).toBe(true);
    expect(w.typeAt(MID, MID)).toBe(Tile.Road);
    await w.ensureAround(MID, MID, 100);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('survives a failing fetch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = new World(testMeta(), async () => {
      throw new Error('offline');
    });
    await w.ensureAround(MID, MID, 10);
    expect(w.isLoaded(MID, MID)).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('builds the road graph honouring one-way streets', () => {
    const w = testWorld();
    // centre node 1: west→east edge 1, northbound edge 3, and back west on two-way edge 0
    const legal = w
      .linksFrom(1)
      .map((l) => `${l.edge.id}${l.forward ? '+' : '-'}`)
      .sort();
    expect(legal).toEqual(['0-', '1+', '3+']);
    // the police may also go south against the one-way
    const any = w
      .anyLinksFrom(1)
      .map((l) => `${l.edge.id}${l.forward ? '+' : '-'}`)
      .sort();
    expect(any).toEqual(['0-', '1+', '2-', '3+']);
    expect(w.loadedEdges()).toHaveLength(4);
    expect(w.edgesNear(MID, MID)).toHaveLength(4);
  });

  it('evicts least recently used chunks and their edges', async () => {
    const meta = testMeta({ width: SIZE * 3, height: SIZE, chunks: ['0_0', '1_0', '2_0'] });
    const make = (cx: number) => ({ ...testChunk(), cx, edges: cx === 0 ? testChunk().edges : [] });
    const w = new World(
      meta,
      async (key) => encodeChunk(make(+key.split('_')[0]), SIZE).buffer as ArrayBuffer,
      1,
    );
    await w.ensureAround(10, 10, 1);
    expect(w.linksFrom(1)).toHaveLength(3);
    await w.ensureAround(256 * 2 + 10, 10, 1);
    expect(w.getChunk(0, 0)).toBeUndefined();
    expect(w.linksFrom(1)).toHaveLength(0);
  });

  it('fetches chunks over HTTP', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(new Uint8Array([1, 2])));
    const buf = await fetchChunkOverHttp('/map')('3_4');
    expect(spy).toHaveBeenCalledWith('/map/c/3_4.bin');
    expect(buf?.byteLength).toBe(2);
    await fetchChunkOverHttp('/map', 'abc')('1_2');
    expect(spy).toHaveBeenLastCalledWith('/map/c/1_2.bin?v=abc');
    spy.mockImplementation(async () => new Response('', { status: 404 }));
    await expect(fetchChunkOverHttp('/map')('9_9')).rejects.toThrow(/404/);
    spy.mockRestore();
  });
});

describe('geometry', () => {
  const line = [0, 0, 10, 0, 10, 10];

  it('measures polylines', () => {
    expect(polylineLength(line)).toBe(20);
  });

  it('walks along polylines', () => {
    expect(pointAt(line, 5)).toMatchObject({ x: 5, y: 0, dx: 1, dy: 0 });
    expect(pointAt(line, 15)).toMatchObject({ x: 10, y: 5, dx: 0, dy: 1 });
    expect(pointAt(line, 99)).toMatchObject({ x: 10, y: 10 });
    expect(pointAt(line, -3)).toMatchObject({ x: 0, y: 0 });
  });

  it('projects points onto polylines', () => {
    const p = projectOnto(line, 12, 4);
    expect(p.s).toBeCloseTo(14);
    expect(p.d2).toBeCloseTo(4);
  });

  it('finds the nearest street and the corner', () => {
    const w = testWorld();
    const n = nearestEdge(w.edgesNear(MID, MID), 60, MID + 3);
    expect(n?.edge.id).toBe(0);
    expect(n?.dist).toBeCloseTo(3);
    expect(nearestEdge(w.edgesNear(MID, MID), 10, 10, 5)).toBeNull();
    expect(streetLabel(w, MID + 2, MID + 2)).toBe('PELLEGRINI Y LAPRIDA');
    expect(streetLabel(w, 40, MID)).toBe('PELLEGRINI');
  });

  it('shortens street names the way people say them', () => {
    expect(shortStreet('Francisco Narciso Laprida')).toBe('Laprida');
    expect(shortStreet('Avenida Carlos Pellegrini')).toBe('Carlos Pellegrini');
    expect(shortStreet('27 de Febrero')).toBe('27 de Febrero');
    expect(shortStreet('Bulevar Nicasio Oroño')).toBe('Nicasio Oroño');
  });

  it('names the neighbourhood', () => {
    const meta = testMeta();
    expect(neighbourhoodAt(meta, 210, 50)).toBe('Centro');
    expect(neighbourhoodAt(meta, 10, 10)).toBe('Pichincha');
    expect(neighbourhoodAt({ ...meta, neighbourhoods: [] }, 0, 0)).toBe('');
  });

  it('knows which phase a point is in', () => {
    const meta = testMeta();
    expect(phaseAt(meta, 100, 100)).toBe(1);
    expect(phaseAt(meta, 100, 230)).toBe(2);
    expect(phaseAt(meta, 900, 900)).toBe(3);
  });

  it('wraps angle differences', () => {
    expect(angleDiff(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(angleDiff(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
    expect(angleDiff(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2);
  });
});
