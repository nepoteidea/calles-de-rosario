// Downloads the raw OpenStreetMap data for Rosario from the Overpass API.
// Output: .cache/osm/<part>.json (gitignored). Run `npm run map:build` afterwards.
//
// Data © OpenStreetMap contributors, ODbL 1.0 — https://www.openstreetmap.org/copyright

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { BBOX, LANDMARKS } from './config.ts';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const UA = 'calles-de-rosario-map-pipeline/0.1 (+https://github.com/nepoteidea/calles-de-rosario)';
const OUT = '.cache/osm';
const SPLIT = 3; // the city is fetched as a SPLIT×SPLIT grid of smaller queries

/** Multipolygons (the Paraná, lagoons, big parks) span several parts: fetch them once. */
function relationQuery([s, w, n, e]: number[]) {
  const b = `${s},${w},${n},${e}`;
  return `[out:json][timeout:300];
(
  relation["natural"="water"](${b});
  relation["water"](${b});
  relation["leisure"="park"](${b});
  relation["building"](${b});
  relation["place"="islet"](${b});
);
out geom qt;`;
}

/** Landmarks and land use: monuments, churches, stadiums, museums, stations, silos, blocks. */
function extrasQuery([s, w, n, e]: number[]) {
  const b = `${s},${w},${n},${e}`;
  return `[out:json][timeout:300];
(
  wr["historic"~"^(monument|memorial|building|castle|church)$"](${b});
  wr["tourism"~"^(museum|attraction|zoo|theme_park|gallery)$"](${b});
  wr["amenity"~"^(place_of_worship|hospital|university|bus_station|theatre|arts_centre|townhall|ferry_terminal|marketplace)$"](${b});
  wr["leisure"~"^(stadium|track|sports_centre|park|garden|marina)$"](${b});
  wr["landuse"~"^(cemetery|residential|commercial|retail|industrial|railway)$"](${b});
  wr["man_made"~"^(silo|bridge|pier|storage_tank)$"](${b});
  wr["railway"="station"](${b});
  wr["aeroway"~"^(aerodrome|runway|apron|terminal)$"](${b});
);
out geom qt;`;
}

function query([s, w, n, e]: number[]) {
  const b = `${s},${w},${n},${e}`;
  return `[out:json][timeout:240];
(
  way["highway"](${b});
  way["building"](${b});
  way["leisure"~"^(park|garden|pitch|playground|stadium|common)$"](${b});
  way["landuse"~"^(grass|recreation_ground|forest|meadow|village_green|cemetery)$"](${b});
  way["natural"~"^(water|wood|scrub|grassland|sand|beach|wetland)$"](${b});
  way["place"="islet"](${b});
  way["amenity"="parking"](${b});
  way["waterway"~"^(river|stream|canal)$"](${b});
  way["railway"="rail"](${b});
  node["place"~"^(suburb|neighbourhood|quarter)$"](${b});
  node["amenity"="telephone"](${b});
);
out geom qt;`;
}

async function fetchPart(q: string, attempts = 12): Promise<{ elements: unknown[]; remark?: string } | null> {
  let wait = 5000;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: q }),
        signal: AbortSignal.timeout(300_000),
      });
      const text = await res.text();
      if (res.ok && text.startsWith('{')) {
        const json = JSON.parse(text);
        // any remark means a partial result (timeout, out of memory): treat it as a failure
        if (json.remark) throw new Error(json.remark);
        return json;
      }
      console.warn(`  ${url} → ${res.status}`);
    } catch (err) {
      console.warn(`  ${url} → ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait * 2, 60_000);
  }
  return null;
}

/** Fetches a box; if Overpass keeps failing, splits it into quarters (up to `depth` times). */
async function fetchBox(box: number[], depth: number): Promise<unknown[]> {
  const json = await fetchPart(query(box), depth > 0 ? 4 : 12);
  if (json) return json.elements;
  if (depth === 0) throw new Error('Overpass kept failing; try again later.');
  const [s, w, n, e] = box;
  const ms = (s + n) / 2;
  const mw = (w + e) / 2;
  console.log(`  splitting ${box.join(',')}`);
  const out: unknown[] = [];
  for (const q of [
    [s, w, ms, mw],
    [s, mw, ms, e],
    [ms, w, n, mw],
    [ms, mw, n, e],
  ]) {
    out.push(
      ...(await fetchBox(
        q.map((v) => +v.toFixed(5)),
        depth - 1,
      )),
    );
  }
  return out;
}

await mkdir(OUT, { recursive: true });
const relFile = `${OUT}/relations.json`;
if (!(await stat(relFile).catch(() => null))) {
  console.log(`fetching ${relFile}`);
  const json = await fetchPart(relationQuery(BBOX));
  if (!json) throw new Error('Overpass kept failing; try again later.');
  await writeFile(relFile, JSON.stringify(json));
  console.log(`  ${json.elements.length} elements`);
}
const extrasFile = `${OUT}/extras.json`;
if (!(await stat(extrasFile).catch(() => null))) {
  console.log(`fetching ${extrasFile}`);
  const json = await fetchPart(extrasQuery(BBOX));
  if (!json) throw new Error('Overpass kept failing; try again later.');
  await writeFile(extrasFile, JSON.stringify(json));
  console.log(`  ${json.elements.length} elements`);
}
const landmarksFile = `${OUT}/landmarks.json`;
if (!(await stat(landmarksFile).catch(() => null))) {
  const ids = LANDMARKS.flatMap((l) => l.osm);
  const ways = ids.filter((i) => i[0] === 'w').map((i) => i.slice(1));
  const rels = ids.filter((i) => i[0] === 'r').map((i) => i.slice(1));
  console.log(`fetching ${landmarksFile} (${ids.length} elements)`);
  const json = await fetchPart(
    `[out:json][timeout:120];(way(id:${ways.join(',')});relation(id:${rels.join(',')}););out geom qt;`,
  );
  if (!json) throw new Error('Overpass kept failing; try again later.');
  await writeFile(landmarksFile, JSON.stringify(json));
  console.log(`  ${json.elements.length} elements`);
}
const [s, w, n, e] = BBOX;
for (let iy = 0; iy < SPLIT; iy++) {
  for (let ix = 0; ix < SPLIT; ix++) {
    const file = `${OUT}/part-${iy}-${ix}.json`;
    if (await stat(file).catch(() => null)) {
      console.log(`${file} cached`);
      continue;
    }
    const part = [
      s + ((n - s) * iy) / SPLIT,
      w + ((e - w) * ix) / SPLIT,
      s + ((n - s) * (iy + 1)) / SPLIT,
      w + ((e - w) * (ix + 1)) / SPLIT,
    ].map((v) => +v.toFixed(5));
    console.log(`fetching ${file} ${part.join(',')}`);
    const elements = await fetchBox(part, 2);
    await writeFile(file, JSON.stringify({ elements }));
    console.log(`  ${elements.length} elements`);
  }
}
