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

export type LandmarkKind =
  | 'monument'
  | 'park'
  | 'garden'
  | 'beach'
  | 'plaza'
  | 'church'
  | 'civic'
  | 'museum'
  | 'theatre'
  | 'stadium'
  | 'arena'
  | 'racecourse'
  | 'sport'
  | 'silos'
  | 'warehouse'
  | 'station'
  | 'bridge'
  | 'mall'
  | 'tower'
  | 'hospital'
  | 'cemetery'
  | 'airport'
  | 'district';

/**
 * The 50 places a rosarino should recognise from the game view. `osm` lists the
 * OpenStreetMap elements that make up each one (w = way, r = relation); the
 * pipeline fetches them by id and draws them in the style of their kind.
 * `colors` are club or brand colours, never crests or logos.
 */
export const LANDMARKS: {
  id: string;
  label: string;
  kind: LandmarkKind;
  osm: string[];
  colors?: [string, string];
}[] = [
  // civic
  { id: 'monumento', label: 'Monumento a la Bandera', kind: 'monument', osm: ['r6804977'] },
  { id: 'parque_bandera', label: 'Parque Nacional a la Bandera', kind: 'park', osm: ['r4452651'] },
  { id: 'plaza25', label: 'Plaza 25 de Mayo', kind: 'plaza', osm: ['r4253579'] },
  { id: 'catedral', label: 'Catedral', kind: 'church', osm: ['w185914322'] },
  { id: 'leones', label: 'Palacio de los Leones', kind: 'civic', osm: ['w187197923'] },
  { id: 'juramento', label: 'Pasaje Juramento', kind: 'plaza', osm: ['w187198882'] },
  { id: 'fuentes', label: 'Palacio Fuentes', kind: 'civic', osm: ['w190048727'] },
  { id: 'bolsa', label: 'Bolsa de Comercio', kind: 'civic', osm: ['w188674124'] },
  { id: 'derecho', label: 'Facultad de Derecho', kind: 'civic', osm: ['w187810462'] },
  { id: 'minetti', label: 'Palacio Minetti', kind: 'tower', osm: ['w194451072'] },
  { id: 'unr', label: 'Universidad Nacional de Rosario', kind: 'civic', osm: ['w193128801'] },
  // sport
  {
    id: 'gigante',
    label: 'Gigante de Arroyito',
    kind: 'stadium',
    osm: ['w73878564'],
    colors: ['#1f4fa0', '#ffd23f'],
  },
  {
    id: 'bielsa',
    label: 'Estadio Marcelo Bielsa',
    kind: 'stadium',
    osm: ['w462624889'],
    colors: ['#c8202f', '#1a1a1e'],
  },
  {
    id: 'cubierto',
    label: 'Estadio Cubierto Newell’s',
    kind: 'arena',
    osm: ['w186988177'],
    colors: ['#c8202f', '#1a1a1e'],
  },
  { id: 'hipodromo', label: 'Hipódromo Independencia', kind: 'racecourse', osm: ['r19410551'] },
  { id: 'jockey', label: 'Jockey Club', kind: 'sport', osm: ['r3781106'] },
  {
    id: 'central_sede',
    label: 'Sede fundacional de Central',
    kind: 'museum',
    osm: ['w1186522870'],
    colors: ['#1f4fa0', '#ffd23f'],
  },
  // parks and waterfront
  { id: 'independencia', label: 'Parque de la Independencia', kind: 'park', osm: ['r3849345'] },
  { id: 'rosedal', label: 'Rosedal', kind: 'garden', osm: ['w908191151'] },
  { id: 'jardin_ninos', label: 'Jardín de los Niños', kind: 'park', osm: ['r4054417'] },
  { id: 'urquiza', label: 'Parque Urquiza', kind: 'park', osm: ['w73850247'] },
  { id: 'espana', label: 'Parque de España', kind: 'park', osm: ['r7696189'] },
  { id: 'colectividades', label: 'Parque de las Colectividades', kind: 'park', osm: ['w185623229'] },
  { id: 'scalabrini', label: 'Parque Scalabrini Ortiz', kind: 'park', osm: ['r3642552'] },
  { id: 'sunchales', label: 'Parque Sunchales', kind: 'park', osm: ['r5258517'] },
  { id: 'yrigoyen', label: 'Parque Yrigoyen', kind: 'park', osm: ['r5389467'] },
  { id: 'regional_sur', label: 'Parque Regional Sur', kind: 'park', osm: ['r5301324'] },
  { id: 'constituyentes', label: 'Parque de los Constituyentes', kind: 'park', osm: ['r3642306'] },
  { id: 'granja', label: 'Granja de la Infancia', kind: 'park', osm: ['w561642338'] },
  { id: 'florida', label: 'La Florida', kind: 'beach', osm: ['w371776158'] },
  { id: 'catalunya', label: 'Rambla Catalunya', kind: 'beach', osm: ['w26163730'] },
  // culture
  { id: 'castagnino', label: 'Museo Castagnino', kind: 'museum', osm: ['w154258249'] },
  { id: 'planetario', label: 'Planetario', kind: 'museum', osm: ['w73850249'] },
  { id: 'macro', label: 'MACRO', kind: 'silos', osm: ['w187199201'] },
  { id: 'galpon11', label: 'Galpón 11', kind: 'warehouse', osm: ['w186984807'] },
  { id: 'isla_inventos', label: 'La Isla de los Inventos', kind: 'station', osm: ['w186984804'] },
  { id: 'fontanarrosa', label: 'Centro Cultural Fontanarrosa', kind: 'civic', osm: ['w187592426'] },
  { id: 'circulo', label: 'Teatro El Círculo', kind: 'theatre', osm: ['w361434794'] },
  { id: 'fluvial', label: 'Estación Fluvial', kind: 'station', osm: ['w186254691'] },
  // transport and big buildings
  { id: 'puente', label: 'Puente Rosario–Victoria', kind: 'bridge', osm: ['w368369459'] },
  { id: 'rosario_norte', label: 'Estación Rosario Norte', kind: 'station', osm: ['w317963427'] },
  { id: 'terminal', label: 'Terminal Mariano Moreno', kind: 'station', osm: ['r8125508'] },
  { id: 'alto_rosario', label: 'Alto Rosario', kind: 'mall', osm: ['w238913589'] },
  { id: 'portal', label: 'Portal Rosario', kind: 'mall', osm: ['w146826480'] },
  { id: 'citycenter', label: 'City Center', kind: 'mall', osm: ['w150803770'] },
  { id: 'dolfines', label: 'Torres Dolfines Guaraní', kind: 'tower', osm: ['w1427712225', 'w1427712226'] },
  { id: 'centenario', label: 'Hospital Centenario', kind: 'hospital', osm: ['w190050427'] },
  { id: 'heca', label: 'Hospital de Emergencias', kind: 'hospital', osm: ['w304102717'] },
  { id: 'salvador', label: 'Cementerio El Salvador', kind: 'cemetery', osm: ['w185196302'] },
  { id: 'piedad', label: 'Cementerio La Piedad', kind: 'cemetery', osm: ['r7231854'] },
  { id: 'aeropuerto', label: 'Aeropuerto Internacional', kind: 'airport', osm: ['r3519596'] },
];
