# Calles de Rosario

A top-down driving and action game on the real street map of Rosario, Argentina. The camera looks straight down, cars and people are small sprites, jobs come in from phone booths and the police chase you. It runs in the browser on desktop and on phones (landscape).

**Play:** https://pibe-chorro.nepoteidea.com

The UI copy is in Rioplatense Spanish. All art, names and characters are original.

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL. The derived map in `public/map/` is shared under the same licence ([public/map/LICENSE.md](public/map/LICENSE.md)).

## How to play

| Desktop   | Phone        |                                                                                      |
| --------- | ------------ | ------------------------------------------------------------------------------------ |
| ↑ / W     | GAS          | Accelerate, or walk                                                                  |
| ↓ / S     | FRENO        | Brake, then reverse                                                                  |
| ← → / A D | joystick     | Steer (keyboard turns relative to the car; the joystick points where you want to go) |
| Shift     |              | Handbrake                                                                            |
| Enter / E | ACCIÓN       | Get in or out of a car (you can steal one with a driver in it)                       |
| Space     | TIRO         | Shoot                                                                                |
| M         | map button   | City map                                                                             |
| Esc / P   | pause button | Pause                                                                                |

Gamepads work too (left stick, RT/A to accelerate, LT to brake, X to shoot, Y/B to get in or out).

- **Jobs:** walk or drive to a ringing phone (yellow arrow, yellow squares on the map). Phase 1 has three jobs: deliver the yellow coupé to the Monumento, carry a package to Pichincha, and wreck a police car and lose the heat.
- **Score:** money, a multiplier that goes up with every job, and 3 lives.
- **Police:** wanted level 0–4. Crimes raise it, and staying out of sight cools it down. The paint shop on Dorrego y Mendoza clears it for $500. If the police stop you, you lose half your money, your multiplier and a life.
- **Zones:** Phase 1 is Centro + Pichincha. Phase 2 (Echesortu, Alberdi, Arroyito) opens after the three jobs. Phase 3 (Fisherton, Sur, Saladillo) opens at $50.000.
- Progress is saved on the device (localStorage).

## Development

```sh
npm install
npm run dev          # http://localhost:5173
npm run check        # lint + prettier + svelte-check
npm test             # Vitest unit tests
npm run test:e2e     # Playwright (desktop Chrome + Android landscape)
E2E_BROWSERS=all npm run test:e2e   # + Firefox, desktop Safari and iOS Safari, as in CI
```

Add `?test` to the URL to expose a small test hook (`window.__cdr`), which the Playwright suite uses.

### Stack

- Vite + TypeScript, Svelte 5 for the menus and the HUD.
- Canvas 2D for the world. Each 256 m map chunk is painted once into an offscreen canvas, then entities are drawn on top. The simulation runs at a fixed 60 Hz and the renderer interpolates between ticks.
- A small custom arcade car model (velocity, heading, grip, drift). No physics engine.
- Traffic follows the OSM road graph and keeps to the right, with lanes and one-way streets. The police plan routes over the same graph, ignoring one-way streets.

```
src/game/map/      binary chunk format, projection, rasteriser, road tagging (shared with the pipeline)
src/game/world/    chunk streaming, tile queries, road graph, street names
src/game/physics/  car model
src/game/ai/       traffic and police drivers
src/game/systems/  wanted level, score, missions, save
src/game/render/   chunk painter, renderer, minimap, city map
src/game/game.ts   the simulation
src/ui/            Svelte screens: menu, HUD, touch controls, map, busted, pause, controls, options
scripts/map/       OSM → game map pipeline
```

## Map pipeline

The game map is built offline from OpenStreetMap and committed to `public/map/`:

```sh
npm run map:fetch   # Overpass API → .cache/osm/*.json (the city in 9 parts + multipolygons)
npm run map:build   # → public/map/meta.json, overview.bin, c/<cx>_<cy>.bin
```

- **Area:** `scripts/map/config.ts` sets the bounding box (the whole city plus a strip of the Paraná), the phase zones, and the named places used by missions. Places can be street pairs, like `['Laprida', 'Córdoba']`; the pipeline finds their real intersection.
- **Projection:** local equirectangular around the city. World metres, x east, y south.
- **Grid:** 4 m tiles (ground, road, sidewalk, building with height, park, water, rail, plaza, sand) in 64×64-tile chunks. Roads come from `highway=*` with widths from `lanes`. Sidewalks are carved along every road. Buildings use `building:levels` or `height`.
- **Road graph:** ways are split at intersections. Each chunk file carries the edges that touch it, with street names, lanes and the one-way flag. The HUD shows the street (and the cross street near a corner) plus the nearest OSM neighbourhood.
- **Output:** about 4,300 chunks and about 10 MB in total, served as Worker static assets. Chunk URLs carry a content hash (`?v=`), so a rebuilt map never comes from a stale cache. That's small enough that no R2 bucket is needed.

The Rosario open-data portal and the Santa Fe IPEC "Plantas Urbanas" shapefiles are not used yet. OpenStreetMap alone covers the city well enough: every mission corner resolves to a real intersection. They're still an option for a later cross-check. Nothing from them ships today, so their licences don't apply.

## Deploy

Cloudflare Worker `calles-de-rosario` with static assets (`wrangler.jsonc`), on the custom domain `pibe-chorro.nepoteidea.com`.

- Push to `main` → GitHub Actions runs `wrangler deploy`.
- Pull requests get a preview URL from `wrangler versions upload`.
- Credentials come from the nepoteidea org: secret `CLOUDFLARE_API_TOKEN` and variable `CLOUDFLARE_ACCOUNT_ID`.

The game is installable as a PWA (manifest plus a service worker that caches the app shell and the map chunks you've visited).
