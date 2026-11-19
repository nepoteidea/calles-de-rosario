// Shared settings for the map pipeline. The game reads the same values back from
// public/map/meta.json, so change them here and rebuild the map.

/** [south, west, north, east] in degrees: the whole city plus a strip of the Paraná. */
export const BBOX: [number, number, number, number] = [-33.035, -60.79, -32.87, -60.61];

/** Metres per tile. */
export const TILE_M = 4;

/** Tiles per chunk side. */
export const CHUNK = 64;

/**
 * Unlockable zones. A point belongs to the first phase whose test matches.
 * Phase 1: Centro + Pichincha (just west of Av. Francia to the river, Av. Pellegrini to the north shore).
 * Phase 2: Echesortu, Alberdi, Arroyito (the north and west belt).
 * Phase 3: everything else: Fisherton, Sur, Saladillo.
 */
export const PHASES: { id: number; name: string; rect: [number, number, number, number] }[] = [
  { id: 1, name: 'Centro y Pichincha', rect: [-32.9575, -60.666, -32.925, -60.61] },
  { id: 2, name: 'Echesortu, Alberdi, Arroyito', rect: [-32.966, -60.705, -32.87, -60.61] },
  { id: 3, name: 'Fisherton, Sur, Saladillo', rect: [-33.035, -60.79, -32.87, -60.61] },
];

/**
 * Named spots used by missions, phone booths, the paint shop and the hideout.
 * `at` is either [lat, lon] or two street names; for street pairs the pipeline
 * finds their real intersection in the OSM road graph.
 */
export const PLACES: Record<string, { label: string; at: [number, number] | [string, string] }> = {
  monumento: { label: 'Monumento a la Bandera', at: [-32.94765, -60.63065] },
  plaza25: { label: 'Plaza 25 de Mayo', at: [-32.9466, -60.6339] },
  laprida_cordoba: { label: 'Laprida y Córdoba', at: ['Laprida', 'Córdoba'] },
  oronio_pellegrini: { label: 'Oroño y Pellegrini', at: ['Oroño', 'Pellegrini'] },
  francia_salta: { label: 'Francia y Salta', at: ['Francia', 'Salta'] },
  oronio_rioja: { label: 'Oroño y La Rioja', at: ['Oroño', 'Rioja'] },
  corrientes_pellegrini: { label: 'Corrientes y Pellegrini', at: ['Corrientes', 'Pellegrini'] },
  sarmiento_mendoza: { label: 'Sarmiento y Mendoza', at: ['Sarmiento', 'Mendoza'] },
  balcarce_jujuy: { label: 'Balcarce y Jujuy', at: ['Balcarce', 'Jujuy'] },
  italia_tucuman: { label: 'Italia y Tucumán', at: ['Italia', 'Tucumán'] },
  taller: { label: 'Taller de Dorrego y Mendoza', at: ['Dorrego', 'Mendoza'] },
  start: { label: 'Entre Ríos y Rioja', at: ['Entre Ríos', 'Rioja'] },
};
