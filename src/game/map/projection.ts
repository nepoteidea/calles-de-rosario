// Local equirectangular projection. World metres: x grows east from the bbox's
// west edge, y grows south from its north edge (screen orientation).
// Over ~20 km the error against UTM is well under a tile.

const R = 6_371_008.8;
const RAD = Math.PI / 180;

export interface Projection {
  toWorld(lat: number, lon: number): [number, number];
  toLatLon(x: number, y: number): [number, number];
}

/** bbox = [south, west, north, east] */
export function makeProjection(bbox: readonly [number, number, number, number]): Projection {
  const [s, w, n] = bbox;
  const kx = R * RAD * Math.cos(((s + n) / 2) * RAD);
  const ky = R * RAD;
  return {
    toWorld: (lat, lon) => [(lon - w) * kx, (n - lat) * ky],
    toLatLon: (x, y) => [n - y / ky, w + x / kx],
  };
}
