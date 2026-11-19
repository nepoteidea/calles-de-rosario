// The simulation: player, traffic, pedestrians, police, missions and scoring.
// Runs at a fixed 60 Hz; the renderer interpolates between ticks.

import { Tile, type Edge, type MapMeta } from './map/format.ts';
import { World } from './world/world.ts';
import { neighbourhoodAt, phaseAt, pointAt, polylineLength, streetLabel, nearestEdge } from './world/geo.ts';
import {
  carProbePoints,
  forwardSpeed,
  ROAD_SURFACE,
  ROUGH_SURFACE,
  speedOf,
  steerToward,
  stepCar,
  type CarControls,
} from './physics/car.ts';
import { Input, type InputFrame } from './input/input.ts';
import {
  makePed,
  makeVehicle,
  type Bullet,
  type Fx,
  type Ped,
  type Player,
  type Vehicle,
} from './entities.ts';
import { driveAI, edgeLength, makeDriver, travelPts, type DriveContext } from './ai/driver.ts';
import { Wanted, type Crime } from './systems/wanted.ts';
import { busted, completeMission, earn, isGameOver, killed, newScore } from './systems/score.ts';
import { MISSIONS, MissionRunner, unlockedPhase, type MissionDef } from './systems/missions.ts';
import { writeSave, type SaveData } from './systems/save.ts';

export const TICK = 1 / 60;

export type GameState = 'loading' | 'playing' | 'paused' | 'busted' | 'wasted' | 'gameover';

export interface HudSnapshot {
  money: number;
  multiplier: number;
  lives: number;
  wanted: number;
  health: number;
  pager: { from: string; text: string } | null;
  timer: number | null;
  street: string;
  hood: string;
  speedKmh: number;
  inVehicle: boolean;
  phase: number;
  unlocked: number;
}

export type GameEvent =
  | { type: 'busted'; where: string; lost: number; multiplier: number; lives: number; money: number }
  | { type: 'wasted'; where: string; multiplier: number; lives: number; money: number }
  | { type: 'gameover'; money: number }
  | { type: 'map' }
  | { type: 'pause' };

const WALKABLE = new Set<number>([Tile.Sidewalk, Tile.Plaza, Tile.Park, Tile.Ground, Tile.Sand]);
const PAVED = new Set<number>([Tile.Road, Tile.Sidewalk, Tile.Plaza, Tile.Rail]);
const WALK_SPEED = 4.2;
const COP_SIGHT = 70;

export interface GameOptions {
  traffic?: number;
  peds?: number;
}

export class Game {
  readonly world: World;
  readonly meta: MapMeta;
  readonly input = new Input();
  readonly wanted = new Wanted();
  readonly missions = new MissionRunner();
  readonly save: SaveData;
  state: GameState = 'loading';
  time = 0;

  player: Player;
  vehicles: Vehicle[] = [];
  peds: Ped[] = [];
  bullets: Bullet[] = [];
  fx: Fx[] = [];
  camera = { x: 0, y: 0, zoom: 1, px: 0, py: 0 };
  pager: { from: string; text: string; until: number } | null = null;
  /** Viewport size in world metres, set by the renderer, used to spawn off-screen. */
  view = { w: 160, h: 90 };

  private destroyedTags = new Set<string>();
  private copContact = 0;
  private spawnTimer = 0;
  private streamTimer = 0;
  private hudTimer = 0;
  private gunfireTimer = 0;
  private zoneMsgTimer = 0;
  private tallerTimer = 0;
  private saveTimer = 0;
  private hud: HudSnapshot | null = null;
  private readonly trafficTarget: number;
  private readonly pedTarget: number;

  private readonly onEvent: (e: GameEvent) => void;

  constructor(
    world: World,
    save: SaveData,
    onEvent: (e: GameEvent) => void = () => {},
    opts: GameOptions = {},
  ) {
    this.onEvent = onEvent;
    this.world = world;
    this.meta = world.meta;
    this.save = save;
    this.trafficTarget = opts.traffic ?? 16;
    this.pedTarget = opts.peds ?? 28;
    const s = this.meta.places.start;
    this.player = {
      x: s.x,
      y: s.y,
      heading: 0,
      vehicle: null,
      health: 100,
      fireCooldown: 0,
      step: 0,
      px: s.x,
      py: s.y,
      ph: 0,
    };
  }

  get score() {
    return this.save.score;
  }
  get places() {
    return this.meta.places;
  }

  /** Loads the area around the hideout and drops the player there. */
  async begin() {
    this.state = 'loading';
    await this.respawn();
  }

  async respawn() {
    for (const v of this.vehicles) if (v.kind === 'cop' && v.tag === undefined) v.destroyed = true;
    this.vehicles = this.vehicles.filter((v) => !(v.kind === 'cop' && v.tag === undefined));
    this.wanted.clear();
    this.copContact = 0;
    if (this.missions.active) this.missions.abort();
    this.removeMissionVehicles();
    const start = this.places.start;
    const spot = this.walkableNear(start.x, start.y) ?? start;
    Object.assign(this.player, {
      x: spot.x,
      y: spot.y,
      px: spot.x,
      py: spot.y,
      heading: -Math.PI / 2,
      vehicle: null,
      health: 100,
    });
    this.camera.x = this.camera.px = spot.x;
    this.camera.y = this.camera.py = spot.y;
    await this.world.ensureAround(spot.x, spot.y, 420);
    this.spawnParkedNear(start.x, start.y, 5, 60);
    this.state = 'playing';
    this.say(
      'EL TANO',
      this.nextPhone() ? 'Hay un teléfono sonando. Atendé y hablamos.' : 'La ciudad es tuya. Hacé lío.',
    );
    this.persist();
  }

  newRun() {
    this.save.score = newScore();
  }

  // ---------------------------------------------------------------- update ----

  tick(dt = TICK) {
    if (this.state !== 'playing') return;
    this.time += dt;
    const frame = this.input.read(this.gamepad());
    this.lastFrame = frame;
    if (frame.map) this.onEvent({ type: 'map' });
    if (frame.pause) this.onEvent({ type: 'pause' });

    this.snapshotPrev();
    this.updatePlayer(frame, dt);
    this.updateVehicles(dt);
    this.updatePeds(dt);
    this.updateBullets(dt);
    this.collideVehicles();
    this.collidePeds();
    this.updateFx(dt);
    this.updatePolice(dt);
    this.updateMissions(dt);
    this.updateCamera(dt);

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.4;
      this.manageTraffic();
      this.managePeds();
    }
    this.streamTimer -= dt;
    if (this.streamTimer <= 0) {
      this.streamTimer = 0.5;
      const p = this.focus();
      void this.world.ensureAround(p.x + p.vx, p.y + p.vy, 420);
    }
    this.saveTimer -= dt;
    if (this.saveTimer <= 0) {
      this.saveTimer = 15;
      this.persist();
    }
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.hud = null;
    }
    if (this.pager && this.time > this.pager.until && !this.missions.active) this.pager = null;
  }

  private gamepad(): Gamepad | null {
    try {
      const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) if (p && p.connected) return p;
    } catch {
      // no gamepad API
    }
    return null;
  }

  private snapshotPrev() {
    const p = this.player;
    p.px = p.x;
    p.py = p.y;
    p.ph = p.heading;
    for (const v of this.vehicles) {
      v.px = v.x;
      v.py = v.y;
      v.ph = v.heading;
    }
    for (const ped of this.peds) {
      ped.px = ped.x;
      ped.py = ped.y;
    }
    this.camera.px = this.camera.x;
    this.camera.py = this.camera.y;
  }

  /** Position and velocity of whatever the camera follows. */
  focus() {
    const v = this.player.vehicle;
    if (v) return { x: v.x, y: v.y, vx: v.vx, vy: v.vy };
    return { x: this.player.x, y: this.player.y, vx: 0, vy: 0 };
  }

  private updatePlayer(f: InputFrame, dt: number) {
    const p = this.player;
    p.fireCooldown -= dt;
    const v = p.vehicle;

    if (f.action) {
      if (v) this.exitVehicle();
      else this.enterNearestVehicle();
    }

    if (v) {
      p.x = v.x;
      p.y = v.y;
      p.heading = v.heading;
    } else {
      let speed: number;
      if (f.stick) {
        const mag = Math.min(1, Math.hypot(f.stick.x, f.stick.y));
        p.heading = Math.atan2(f.stick.y, f.stick.x);
        speed = mag * WALK_SPEED;
      } else {
        p.heading += f.steer * 3.6 * dt;
        speed = f.throttle * WALK_SPEED - f.brake * 2;
      }
      if (speed !== 0) {
        p.step += Math.abs(speed) * dt;
        const nx = p.x + Math.cos(p.heading) * speed * dt;
        const ny = p.y + Math.sin(p.heading) * speed * dt;
        if (this.footFree(nx, ny)) {
          p.x = nx;
          p.y = ny;
        } else if (this.footFree(nx, p.y)) p.x = nx;
        else if (this.footFree(p.x, ny)) p.y = ny;
      }
    }

    if (f.fire && p.fireCooldown <= 0) this.playerShoot();
  }

  private footFree(x: number, y: number) {
    if (this.world.isSolid(x, y)) return false;
    if (this.isLocked(x, y)) {
      this.zoneBlocked();
      return false;
    }
    return true;
  }

  isLocked(x: number, y: number) {
    return phaseAt(this.meta, x, y) > this.save.unlocked;
  }

  private zoneBlocked() {
    if (this.time < this.zoneMsgTimer) return;
    this.zoneMsgTimer = this.time + 5;
    this.say('SISTEMA', 'Zona cerrada. Terminá los trabajos de esta zona para abrir la siguiente.');
  }

  private playerControls(v: Vehicle, f: InputFrame): CarControls {
    const ctl: CarControls = { throttle: f.throttle, brake: f.brake, steer: f.steer, handbrake: f.handbrake };
    if (f.stick) {
      const target = Math.atan2(f.stick.y, f.stick.x);
      ctl.steer = steerToward(v.heading, target, forwardSpeed(v) < -0.5);
    }
    return ctl;
  }

  private enterNearestVehicle() {
    const p = this.player;
    let best: Vehicle | null = null;
    let bestD = 4;
    for (const v of this.vehicles) {
      if (v.destroyed) continue;
      const d = Math.hypot(v.x - p.x, v.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    if (!best) return;
    if (best.driver === 'ai' && best.ai?.mode !== 'parked') {
      const side = this.sidePoint(best, 1);
      const ped = makePed(side.x, side.y, 'driver');
      ped.flee = 6;
      ped.heading = Math.atan2(side.y - best.y, side.x - best.x);
      this.peds.push(ped);
      this.crime(best.kind === 'cop' ? 'copHit' : 'carjack');
    }
    best.driver = 'player';
    best.ai = null;
    p.vehicle = best;
  }

  private exitVehicle() {
    const p = this.player;
    const v = p.vehicle!;
    if (speedOf(v) > 5) return;
    for (const side of [-1, 1]) {
      const pt = this.sidePoint(v, side);
      if (!this.world.isSolid(pt.x, pt.y)) {
        p.x = pt.x;
        p.y = pt.y;
        v.driver = 'none';
        p.vehicle = null;
        return;
      }
    }
  }

  private sidePoint(v: Vehicle, side: number) {
    const d = v.params.width / 2 + 0.8;
    return { x: v.x - Math.sin(v.heading) * d * side, y: v.y + Math.cos(v.heading) * d * side };
  }

  private updateVehicles(dt: number) {
    const ctx = this.driveContext();
    const keep: Vehicle[] = [];
    for (const v of this.vehicles) {
      if (v.destroyed) {
        v.wreckAge += dt;
        v.vx *= 0.9;
        v.vy *= 0.9;
        keep.push(v);
        continue;
      }
      let ctl: CarControls;
      if (v.driver === 'player' && this.lastFrame) ctl = this.playerControls(v, this.lastFrame);
      else if (v.driver === 'ai' && v.ai) {
        const c = driveAI(v, dt, ctx);
        if (!c) continue; // ran off the loaded graph: despawn
        ctl = c;
      } else ctl = { throttle: 0, brake: speedOf(v) > 0.1 ? 0.6 : 0, steer: 0, handbrake: false };

      const bx = v.x;
      const by = v.y;
      const bh = v.heading;
      const t = this.world.typeAt(v.x, v.y);
      stepCar(v, ctl, v.params, dt, PAVED.has(t) ? ROAD_SURFACE : ROUGH_SURFACE);
      const impact = this.collideTiles(v, bx, by, bh);
      if (impact > 7) this.damage(v, (impact - 7) * 3.5, v.driver === 'player');
      if (impact > 4 && v.driver === 'player')
        this.fx.push({ kind: 'spark', x: v.x, y: v.y, age: 0, life: 0.3 });
      keep.push(v);
    }
    this.vehicles = keep;
  }

  private lastFrame: InputFrame | null = null;

  private vehicleHits(v: Vehicle) {
    const playerCar = v.driver === 'player';
    for (const [x, y] of carProbePoints(v, v.params)) {
      if (this.world.isSolid(x, y)) return true;
      if (playerCar && this.isLocked(x, y)) {
        this.zoneBlocked();
        return true;
      }
    }
    return false;
  }

  /** Undo a move into a wall, sliding along it where possible. Returns impact speed. */
  private collideTiles(v: Vehicle, bx: number, by: number, bh: number): number {
    if (!this.vehicleHits(v)) return 0;
    const nx = v.x;
    const ny = v.y;
    v.y = by;
    if (!this.vehicleHits(v)) {
      const impact = Math.abs(v.vy);
      v.vy *= -0.25;
      return impact;
    }
    v.x = bx;
    v.y = ny;
    if (!this.vehicleHits(v)) {
      const impact = Math.abs(v.vx);
      v.vx *= -0.25;
      return impact;
    }
    v.x = bx;
    v.y = by;
    v.heading = bh;
    const impact = speedOf(v);
    v.vx *= -0.25;
    v.vy *= -0.25;
    if (this.vehicleHits(v)) {
      // spawned or pushed inside something: nudge it out toward the nearest open side
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        v.x = bx + dx * 0.5;
        v.y = by + dy * 0.5;
        if (!this.vehicleHits(v)) return impact;
      }
      v.x = nx;
      v.y = ny;
    }
    return impact;
  }

  private driveContext(): DriveContext {
    const target = this.focus();
    return {
      world: this.world,
      target: this.wanted.level > 0 ? target : null,
      targetOnFoot: !this.player.vehicle,
      canSee: (v) =>
        Math.hypot(v.x - target.x, v.y - target.y) < 40 && this.lineOfSight(v.x, v.y, target.x, target.y),
      chaseSpeed: Math.min(32, 17 + this.wanted.level * 3.5),
      clearance: (v) => this.clearance(v),
    };
  }

  /** Distance to the nearest car, pedestrian or player in a narrow cone ahead. */
  private clearance(v: Vehicle): number {
    const fx = Math.cos(v.heading);
    const fy = Math.sin(v.heading);
    let best = Infinity;
    const check = (x: number, y: number, r: number) => {
      const dx = x - v.x;
      const dy = y - v.y;
      const ahead = dx * fx + dy * fy;
      if (ahead <= 0 || ahead > 18) return;
      const side = Math.abs(-dx * fy + dy * fx);
      if (side < 1.4 + r) best = Math.min(best, ahead - v.params.length / 2 - r);
    };
    for (const o of this.vehicles)
      if (o !== v && !(o.destroyed && o.wreckAge > 30)) check(o.x, o.y, o.params.length / 2);
    for (const p of this.peds) if (p.alive) check(p.x, p.y, 0.4);
    if (!this.player.vehicle) check(this.player.x, this.player.y, 0.4);
    return best;
  }

  lineOfSight(x0: number, y0: number, x1: number, y1: number) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.ceil(d / 2);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.world.typeAt(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t) === Tile.Building) return false;
    }
    return true;
  }

  private collideVehicles() {
    const vs = this.vehicles;
    for (let i = 0; i < vs.length; i++) {
      for (let j = i + 1; j < vs.length; j++) {
        const a = vs[i];
        const b = vs[j];
        const dx0 = b.x - a.x;
        const dy0 = b.y - a.y;
        if (dx0 * dx0 + dy0 * dy0 > 49) continue;
        // two circles per car, front and back
        for (const ca of circles(a)) {
          for (const cb of circles(b)) {
            const dx = cb.x - ca.x;
            const dy = cb.y - ca.y;
            const rr = ca.r + cb.r;
            const d2 = dx * dx + dy * dy;
            if (d2 >= rr * rr || d2 === 0) continue;
            const d = Math.sqrt(d2);
            const nx = dx / d;
            const ny = dy / d;
            const push = (rr - d) / 2;
            const am = a.destroyed ? 3 : 1;
            const bm = b.destroyed ? 3 : 1;
            a.x -= nx * push * (bm / (am + bm)) * 2;
            a.y -= ny * push * (bm / (am + bm)) * 2;
            b.x += nx * push * (am / (am + bm)) * 2;
            b.y += ny * push * (am / (am + bm)) * 2;
            const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rel < 0) {
              const imp = -rel * 0.65;
              a.vx -= nx * imp * (bm / (am + bm)) * 2;
              a.vy -= ny * imp * (bm / (am + bm)) * 2;
              b.vx += nx * imp * (am / (am + bm)) * 2;
              b.vy += ny * imp * (am / (am + bm)) * 2;
              const hit = -rel;
              if (hit > 5) {
                const byPlayer = a.driver === 'player' || b.driver === 'player';
                this.damage(a, (hit - 5) * 3, byPlayer);
                this.damage(b, (hit - 5) * 3, byPlayer);
                this.fx.push({
                  kind: 'spark',
                  x: (ca.x + cb.x) / 2,
                  y: (ca.y + cb.y) / 2,
                  age: 0,
                  life: 0.3,
                });
                if (byPlayer && (a.kind === 'cop' || b.kind === 'cop') && hit > 6) this.crime('copHit');
              }
            }
          }
        }
      }
    }
  }

  private collidePeds() {
    const p = this.player;
    for (const v of this.vehicles) {
      const s = speedOf(v);
      if (s < 2.5 || v.destroyed) continue;
      const r = v.params.length / 2 + 0.3;
      for (const ped of this.peds) {
        if (!ped.alive) continue;
        const dx = ped.x - v.x;
        const dy = ped.y - v.y;
        if (dx * dx + dy * dy > r * r) continue;
        if (!insideCar(v, ped.x, ped.y, 0.35)) continue;
        this.killPed(ped, v.driver === 'player');
      }
      if (!p.vehicle && insideCar(v, p.x, p.y, 0.35)) {
        if (s > 7) this.playerKilled();
        else {
          const a = Math.atan2(p.y - v.y, p.x - v.x);
          p.x += Math.cos(a) * 0.6;
          p.y += Math.sin(a) * 0.6;
        }
      }
    }
  }

  private killPed(ped: Ped, byPlayer: boolean) {
    ped.alive = false;
    ped.deadAge = 0;
    this.fx.push({ kind: 'blood', x: ped.x, y: ped.y, age: 0, life: 25 });
    if (byPlayer) {
      earn(this.score, 50);
      this.crime('pedKilled');
    }
    for (const o of this.peds) {
      if (o.alive && Math.hypot(o.x - ped.x, o.y - ped.y) < 25) this.scare(o, ped.x, ped.y);
    }
  }

  private scare(ped: Ped, fromX: number, fromY: number) {
    ped.flee = 4 + Math.random() * 2;
    ped.heading = Math.atan2(ped.y - fromY, ped.x - fromX);
  }

  private damage(v: Vehicle, amount: number, byPlayer: boolean) {
    if (v.destroyed || amount <= 0) return;
    v.health -= amount;
    if (v.health > 0) return;
    v.health = 0;
    v.destroyed = true;
    v.wreckAge = 0;
    this.fx.push({ kind: 'explosion', x: v.x, y: v.y, age: 0, life: 0.8 });
    if (v.tag) this.destroyedTags.add(v.tag);
    if (v.driver === 'player') {
      this.playerKilled();
    } else if (byPlayer) {
      earn(this.score, v.kind === 'cop' ? 300 : 100);
      this.crime(v.kind === 'cop' ? 'copCarDestroyed' : 'carDestroyed');
    }
    v.driver = 'none';
    v.ai = null;
    for (const ped of this.peds)
      if (ped.alive && Math.hypot(ped.x - v.x, ped.y - v.y) < 4) this.killPed(ped, byPlayer);
    for (const o of this.vehicles) {
      if (o !== v && !o.destroyed && Math.hypot(o.x - v.x, o.y - v.y) < 5) this.damage(o, 35, byPlayer);
    }
    if (!this.player.vehicle && Math.hypot(this.player.x - v.x, this.player.y - v.y) < 3.5)
      this.playerKilled();
  }

  private playerShoot() {
    const p = this.player;
    p.fireCooldown = 0.22;
    const v = p.vehicle;
    const off = v ? v.params.length / 2 + 0.6 : 0.6;
    const fx = Math.cos(p.heading);
    const fy = Math.sin(p.heading);
    this.bullets.push({
      x: p.x + fx * off,
      y: p.y + fy * off,
      vx: fx * 70 + (v?.vx ?? 0),
      vy: fy * 70 + (v?.vy ?? 0),
      life: 0.6,
      fromPlayer: true,
    });
    for (const ped of this.peds)
      if (ped.alive && Math.hypot(ped.x - p.x, ped.y - p.y) < 30) this.scare(ped, p.x, p.y);
    if (this.time > this.gunfireTimer && this.copNear(p.x, p.y, 45)) {
      this.gunfireTimer = this.time + 3;
      this.crime('gunfire');
    }
  }

  private updateBullets(dt: number) {
    const p = this.player;
    const alive: Bullet[] = [];
    for (const b of this.bullets) {
      let hit = false;
      for (let sub = 0; sub < 3 && !hit; sub++) {
        b.x += (b.vx * dt) / 3;
        b.y += (b.vy * dt) / 3;
        if (this.world.isSolid(b.x, b.y)) {
          this.fx.push({ kind: 'spark', x: b.x, y: b.y, age: 0, life: 0.2 });
          hit = true;
          break;
        }
        if (b.fromPlayer) {
          for (const ped of this.peds) {
            if (ped.alive && Math.hypot(ped.x - b.x, ped.y - b.y) < 0.8) {
              this.killPed(ped, true);
              hit = true;
              break;
            }
          }
          if (hit) break;
          for (const v of this.vehicles) {
            if (v === p.vehicle || v.destroyed) continue;
            if (insideCar(v, b.x, b.y, 0.2)) {
              if (v.kind === 'cop') this.crime('copHit');
              this.damage(v, 22, true);
              this.fx.push({ kind: 'spark', x: b.x, y: b.y, age: 0, life: 0.2 });
              hit = true;
              break;
            }
          }
        } else if (p.vehicle ? insideCar(p.vehicle, b.x, b.y, 0.2) : Math.hypot(p.x - b.x, p.y - b.y) < 0.8) {
          if (p.vehicle) this.damage(p.vehicle, 9, false);
          else {
            p.health -= 12;
            this.fx.push({ kind: 'blood', x: p.x, y: p.y, age: 0, life: 3 });
            if (p.health <= 0) this.playerKilled();
          }
          hit = true;
        }
      }
      b.life -= dt;
      if (!hit && b.life > 0) alive.push(b);
    }
    this.bullets = alive;
  }

  private updatePeds(dt: number) {
    const keep: Ped[] = [];
    for (const ped of this.peds) {
      if (!ped.alive) {
        ped.deadAge += dt;
        if (ped.deadAge < 20) keep.push(ped);
        continue;
      }
      ped.think -= dt;
      const fleeing = ped.flee > 0;
      if (fleeing) ped.flee -= dt;
      const speed = fleeing ? 3.4 : ped.speed;
      const ok = (x: number, y: number) =>
        !this.world.isSolid(x, y) && (fleeing || WALKABLE.has(this.world.typeAt(x, y)));
      if (ped.think <= 0) {
        ped.think = 0.25 + Math.random() * 0.2;
        const ax = ped.x + Math.cos(ped.heading) * 1.4;
        const ay = ped.y + Math.sin(ped.heading) * 1.4;
        if (!ok(ax, ay) || (!fleeing && Math.random() < 0.015)) {
          const options = [Math.PI / 2, -Math.PI / 2, Math.PI]
            .map((d) => ped.heading + d)
            .filter((h) => ok(ped.x + Math.cos(h) * 1.4, ped.y + Math.sin(h) * 1.4));
          ped.heading = options.length
            ? options[Math.floor(Math.random() * options.length)]
            : ped.heading + Math.PI;
        }
      }
      const nx = ped.x + Math.cos(ped.heading) * speed * dt;
      const ny = ped.y + Math.sin(ped.heading) * speed * dt;
      if (!this.world.isSolid(nx, ny)) {
        ped.x = nx;
        ped.y = ny;
        ped.step += speed * dt;
      } else ped.think = 0;
      keep.push(ped);
    }
    this.peds = keep;
  }

  private updateFx(dt: number) {
    for (const f of this.fx) f.age += dt;
    this.fx = this.fx.filter((f) => f.age < f.life);
    if (this.fx.length > 200) this.fx.splice(0, this.fx.length - 200);
  }

  // --------------------------------------------------------------- police ----

  crime(kind: Crime) {
    const p = this.focus();
    this.wanted.crime(kind, this.copNear(p.x, p.y, 60));
  }

  private copNear(x: number, y: number, r: number) {
    return this.vehicles.some(
      (v) =>
        v.kind === 'cop' &&
        !v.destroyed &&
        v.ai &&
        v.ai.mode !== 'parked' &&
        Math.hypot(v.x - x, v.y - y) < r,
    );
  }

  private updatePolice(dt: number) {
    const level = this.wanted.level;
    const p = this.focus();
    const cops = this.vehicles.filter(
      (v) => v.kind === 'cop' && !v.destroyed && v.driver === 'ai' && v.ai && v.ai.mode !== 'parked',
    );
    let inSight = false;
    let contact = false;
    const playerSpeed = this.player.vehicle ? speedOf(this.player.vehicle) : 0;
    for (const c of cops) {
      const ai = c.ai!;
      if (level > 0 && ai.mode !== 'chase') {
        ai.mode = 'chase';
        ai.path = [];
        ai.repath = 0;
        ai.lane = 0;
      } else if (level === 0 && ai.mode === 'chase') {
        ai.mode = 'traffic';
      }
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < COP_SIGHT && (d < 30 || this.lineOfSight(c.x, c.y, p.x, p.y))) inSight = true;
      if (
        level > 0 &&
        d < (this.player.vehicle ? 6.5 : 5) &&
        (this.player.vehicle ? playerSpeed < 2.5 : speedOf(c) < 7)
      )
        contact = true;
      ai.fireCooldown -= dt;
      if (level >= 3 && d < 24 && ai.fireCooldown <= 0 && this.lineOfSight(c.x, c.y, p.x, p.y)) {
        ai.fireCooldown = 1.1;
        const a = Math.atan2(p.y - c.y, p.x - c.x) + (Math.random() - 0.5) * 0.25;
        this.bullets.push({
          x: c.x + Math.cos(a) * 3,
          y: c.y + Math.sin(a) * 3,
          vx: Math.cos(a) * 55,
          vy: Math.sin(a) * 55,
          life: 0.6,
          fromPlayer: false,
        });
      }
    }
    this.wanted.update(dt, inSight);
    if (level > 0 && contact) this.copContact += dt;
    else this.copContact = Math.max(0, this.copContact - dt * 0.5);
    if (this.copContact >= 1.4) this.playerBusted();
  }

  private playerBusted() {
    if (this.state !== 'playing') return;
    const where = this.whereLabel();
    const multiplier = this.score.multiplier;
    const lost = busted(this.score);
    this.afterDeathOrArrest();
    if (isGameOver(this.score)) return this.gameOver();
    this.state = 'busted';
    this.persist();
    this.onEvent({
      type: 'busted',
      where,
      lost,
      multiplier,
      lives: this.score.lives,
      money: this.score.money,
    });
  }

  private playerKilled() {
    if (this.state !== 'playing') return;
    const where = this.whereLabel();
    const multiplier = this.score.multiplier;
    killed(this.score);
    this.fx.push({ kind: 'blood', x: this.player.x, y: this.player.y, age: 0, life: 25 });
    this.afterDeathOrArrest();
    if (isGameOver(this.score)) return this.gameOver();
    this.state = 'wasted';
    this.persist();
    this.onEvent({ type: 'wasted', where, multiplier, lives: this.score.lives, money: this.score.money });
  }

  private afterDeathOrArrest() {
    this.input.releaseAll();
    if (this.missions.active) {
      this.missions.abort();
      this.removeMissionVehicles();
    }
    const v = this.player.vehicle;
    if (v) {
      v.driver = 'none';
      this.player.vehicle = null;
    }
  }

  private gameOver() {
    this.state = 'gameover';
    const money = this.score.money;
    this.save.score = newScore();
    this.persist();
    this.onEvent({ type: 'gameover', money });
  }

  private whereLabel() {
    const p = this.focus();
    const s = streetLabel(this.world, p.x, p.y);
    return s ? titleCase(s) : neighbourhoodAt(this.meta, p.x, p.y);
  }

  // -------------------------------------------------------------- spawning ----

  private visible(x: number, y: number, margin = 12) {
    const c = this.camera;
    return Math.abs(x - c.x) < this.view.w / 2 + margin && Math.abs(y - c.y) < this.view.h / 2 + margin;
  }

  private manageTraffic() {
    const p = this.focus();
    // despawn
    this.vehicles = this.vehicles.filter((v) => {
      if (v.tag || v === this.player.vehicle) return true;
      const d = Math.hypot(v.x - p.x, v.y - p.y);
      if (v.destroyed) return d < 200 && v.wreckAge < 90;
      if (v.kind === 'cop' && this.wanted.level > 0) return d < 420;
      return d < 280 || this.visible(v.x, v.y);
    });

    const civil = this.vehicles.filter(
      (v) => v.driver === 'ai' && v.kind === 'civil' && v.ai?.mode === 'traffic',
    ).length;
    const parked = this.vehicles.filter((v) => v.driver !== 'ai' && !v.destroyed && !v.tag).length;
    if (civil < this.trafficTarget) this.spawnTraffic('civil');
    if (parked < 6) this.spawnParkedNear(p.x, p.y, 1, 200, true);

    const level = this.wanted.level;
    const cops = this.vehicles.filter(
      (v) => v.kind === 'cop' && v.driver === 'ai' && !v.destroyed && v.ai?.mode !== 'parked',
    );
    const want = level > 0 ? Wanted.copsFor(level) : 1;
    if (cops.length < want) this.spawnTraffic('cop', level > 0 ? 'chase' : 'traffic');
    else if (cops.length > want) {
      const far = cops.find((c) => !this.visible(c.x, c.y, 40));
      if (far) this.vehicles = this.vehicles.filter((v) => v !== far);
    }
  }

  private randomEdgeSpot(
    minD: number,
    maxD: number,
    offscreen: boolean,
  ): { edge: Edge; s: number; x: number; y: number } | null {
    const p = this.focus();
    const edges = this.world.edgesNear(p.x, p.y).filter((e) => e.cls > 0 || Math.random() < 0.5);
    for (let attempt = 0; attempt < 14 && edges.length; attempt++) {
      const e = edges[Math.floor(Math.random() * edges.length)];
      const len = edgeLength(e);
      const s = Math.random() * len;
      const pt = pointAt(e.pts, s);
      const d = Math.hypot(pt.x - p.x, pt.y - p.y);
      if (d < minD || d > maxD) continue;
      if (offscreen && this.visible(pt.x, pt.y)) continue;
      if (this.isLocked(pt.x, pt.y)) continue;
      if (this.vehicles.some((v) => Math.hypot(v.x - pt.x, v.y - pt.y) < 9)) continue;
      return { edge: e, s, x: pt.x, y: pt.y };
    }
    return null;
  }

  private spawnTraffic(kind: 'civil' | 'cop', mode: 'traffic' | 'chase' = 'traffic') {
    const spot = this.randomEdgeSpot(kind === 'cop' ? 110 : 60, kind === 'cop' ? 240 : 210, true);
    if (!spot) return;
    const forward = spot.edge.oneway || Math.random() < 0.5;
    const pts = travelPts(spot.edge, forward);
    const s = forward ? spot.s : edgeLength(spot.edge) - spot.s;
    const at = pointAt(pts, s);
    const ai = makeDriver(spot.edge, forward, mode);
    if (mode === 'chase') ai.lane = 0;
    const x = at.x - at.dy * ai.lane;
    const y = at.y + at.dx * ai.lane;
    if (this.world.isSolid(x, y)) return;
    const v = makeVehicle(x, y, Math.atan2(at.dy, at.dx), { kind });
    v.driver = 'ai';
    v.ai = ai;
    const sp = ai.cruise * 0.6;
    v.vx = at.dx * sp;
    v.vy = at.dy * sp;
    this.vehicles.push(v);
  }

  /** Puts the player in a new car on the nearest road (test hook). */
  giveCar() {
    const f = this.focus();
    const near = nearestEdge(this.world.edgesNear(f.x, f.y), f.x, f.y, 60);
    if (!near || this.player.vehicle) return false;
    const at = pointAt(near.edge.pts, near.s);
    const v = makeVehicle(at.x, at.y, Math.atan2(at.dy, at.dx), { model: 'coupe', color: '#c0392b' });
    v.driver = 'player';
    this.vehicles.push(v);
    this.player.vehicle = v;
    return true;
  }

  /** Drops a chasing police car on the road closest to the player (test hook). */
  spawnCopNear() {
    const f = this.focus();
    const near = nearestEdge(this.world.edgesNear(f.x, f.y), f.x, f.y, 60);
    if (!near) return false;
    const at = pointAt(near.edge.pts, near.s);
    const v = makeVehicle(at.x, at.y, Math.atan2(at.dy, at.dx), { kind: 'cop' });
    v.driver = 'ai';
    v.ai = makeDriver(near.edge, true, 'chase');
    v.ai.lane = 0;
    this.vehicles.push(v);
    return true;
  }

  /** Parks cars along the kerb near (x, y). */
  spawnParkedNear(x: number, y: number, count: number, radius: number, offscreen = false) {
    const edges = this.world.edgesNear(x, y).filter((e) => e.cls >= 3);
    for (let n = 0, tries = 0; n < count && tries < 40 && edges.length; tries++) {
      const e = edges[Math.floor(Math.random() * edges.length)];
      const len = polylineLength(e.pts);
      if (len < 15) continue;
      const at = pointAt(e.pts, 6 + Math.random() * (len - 12));
      const side = Math.random() < 0.5 ? 1 : -1;
      const off = e.width / 2 - 1.3;
      const px = at.x - at.dy * off * side;
      const py = at.y + at.dx * off * side;
      if (Math.hypot(px - x, py - y) > radius) continue;
      if (offscreen && this.visible(px, py)) continue;
      if (this.isLocked(px, py) || this.world.isSolid(px, py)) continue;
      if (this.vehicles.some((v) => Math.hypot(v.x - px, v.y - py) < 7)) continue;
      const v = makeVehicle(px, py, Math.atan2(at.dy, at.dx) + (Math.random() < 0.5 ? 0 : Math.PI));
      this.vehicles.push(v);
      n++;
    }
  }

  private managePeds() {
    const p = this.focus();
    this.peds = this.peds.filter(
      (ped) => Math.hypot(ped.x - p.x, ped.y - p.y) < 150 || this.visible(ped.x, ped.y),
    );
    const alive = this.peds.filter((x) => x.alive).length;
    for (let k = 0; k < 3 && alive + k < this.pedTarget; k++) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const a = Math.random() * Math.PI * 2;
        const d = 30 + Math.random() * 90;
        const x = p.x + Math.cos(a) * d;
        const y = p.y + Math.sin(a) * d;
        if (this.world.typeAt(x, y) !== Tile.Sidewalk && this.world.typeAt(x, y) !== Tile.Plaza) continue;
        if (d < 60 && this.visible(x, y, 0)) continue;
        this.peds.push(makePed(x, y));
        break;
      }
    }
  }

  private walkableNear(x: number, y: number): { x: number; y: number } | null {
    for (let r = 0; r < 40; r += 2) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        const t = this.world.typeAt(px, py);
        if (t === Tile.Sidewalk || t === Tile.Plaza) return { x: px, y: py };
      }
    }
    return null;
  }

  // ------------------------------------------------------------- missions ----

  /** Next phone that has a job waiting, if any. */
  nextPhone(): MissionDef | null {
    return MISSIONS.find((m) => !this.save.completed.includes(m.id)) ?? null;
  }

  availableMissions(): MissionDef[] {
    return MISSIONS.filter((m) => !this.save.completed.includes(m.id));
  }

  vehicleByTag(tag: string) {
    return this.vehicles.find((v) => v.tag === tag) ?? null;
  }

  /** Where the yellow arrow points: the mission objective, or the nearest ringing phone. */
  objective(): { x: number; y: number; label: string } | null {
    if (this.missions.active) {
      const t = this.missions.target(this.meta, (tag) => this.vehicleByTag(tag));
      return t ? { x: t.x, y: t.y, label: '' } : null;
    }
    const p = this.focus();
    let best: { x: number; y: number; label: string } | null = null;
    let bestD = Infinity;
    for (const m of this.availableMissions()) {
      const ph = this.places[m.phone];
      const d = Math.hypot(ph.x - p.x, ph.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = { x: ph.x, y: ph.y, label: 'TELÉFONO' };
      }
    }
    return best;
  }

  private updateMissions(dt: number) {
    const p = this.focus();
    if (!this.missions.active) {
      for (const m of this.availableMissions()) {
        const ph = this.places[m.phone];
        if (Math.hypot(ph.x - p.x, ph.y - p.y) < 7) {
          this.startMission(m);
          break;
        }
      }
    } else {
      const ev = this.missions.update(dt, {
        x: p.x,
        y: p.y,
        places: this.places,
        vehicleTag: this.player.vehicle?.tag ?? null,
        wanted: this.wanted.level,
        isDestroyed: (tag) => this.destroyedTags.has(tag),
      });
      const from = this.missions.mission?.from ?? 'EL TANO';
      if (ev?.type === 'step' || ev?.type === 'hint')
        this.say(from, ev.text, ev.type === 'hint' ? 4 : undefined);
      else if (ev?.type === 'failed') {
        this.say('EL TANO', `${ev.reason} Probá de nuevo desde el teléfono.`, 6);
        this.removeMissionVehicles();
      } else if (ev?.type === 'complete') {
        const gained = completeMission(this.score, ev.mission.reward);
        this.save.completed.push(ev.mission.id);
        this.say(ev.mission.from, `${ev.mission.done} +$${gained.toLocaleString('es-AR')}`, 6);
        this.releaseMissionVehicles();
        this.checkUnlock();
        this.persist();
      }
    }

    // paint shop: new colour, the police lose track of you
    const t = this.places.taller;
    const v = this.player.vehicle;
    if (
      v &&
      t &&
      this.wanted.level > 0 &&
      this.time > this.tallerTimer &&
      Math.hypot(v.x - t.x, v.y - t.y) < 10
    ) {
      this.tallerTimer = this.time + 4;
      if (this.score.money >= 500) {
        this.score.money -= 500;
        this.wanted.clear();
        v.color = ['#c0392b', '#2e86c1', '#27ae60', '#8e44ad', '#e8e3d3'][Math.floor(Math.random() * 5)];
        this.say('TALLER', 'Pintura nueva por $500. La cana ya no te reconoce.', 5);
      } else {
        this.say('TALLER', 'Sin $500 no hay pintura, pibe.', 4);
      }
    }
    if (Math.floor(this.time) % 2 === 0) this.checkUnlock();
  }

  private startMission(m: MissionDef) {
    this.destroyedTags.clear();
    for (const s of m.spawns) {
      const place = this.places[s.place];
      const near = nearestEdge(this.world.edgesNear(place.x, place.y), place.x, place.y, 80);
      let x = place.x;
      let y = place.y;
      let heading = 0;
      if (near) {
        const at = pointAt(near.edge.pts, Math.min(near.s + 12, polylineLength(near.edge.pts)));
        const off = near.edge.width / 2 - 1.3;
        x = at.x - at.dy * off;
        y = at.y + at.dx * off;
        heading = Math.atan2(at.dy, at.dx);
      }
      const v = makeVehicle(x, y, heading, {
        kind: s.kind === 'copCar' ? 'cop' : 'civil',
        model: s.kind === 'copCar' ? 'cop' : 'coupe',
        color: s.color,
        tag: s.tag,
      });
      if (s.kind === 'copCar') {
        v.driver = 'ai';
        v.ai = near ? makeDriver(near.edge, true, 'parked') : null;
        if (!v.ai) v.driver = 'none';
      }
      this.vehicles.push(v);
    }
    const ev = this.missions.start(m);
    if (ev.type === 'step') this.say(m.from, ev.text);
  }

  private removeMissionVehicles() {
    this.vehicles = this.vehicles.filter((v) => !v.tag || v === this.player.vehicle);
    for (const v of this.vehicles) v.tag = undefined;
  }

  private releaseMissionVehicles() {
    for (const v of this.vehicles) v.tag = undefined;
  }

  private checkUnlock() {
    const next = unlockedPhase(this.save.completed, this.score.money);
    if (next > this.save.unlocked) {
      this.save.unlocked = next;
      const ph = this.meta.phases.find((x) => x.id === next);
      this.say('SISTEMA', `¡Zona nueva! Se abrió la Fase ${next}: ${ph?.name ?? ''}.`, 6);
      this.persist();
    }
  }

  say(from: string, text: string, seconds = 8) {
    this.pager = { from, text, until: this.time + seconds };
  }

  persist() {
    writeSave(this.save);
  }

  // --------------------------------------------------------------- camera ----

  private updateCamera(dt: number) {
    const f = this.focus();
    const speed = Math.hypot(f.vx, f.vy);
    const tx = f.x + f.vx * 0.7;
    const ty = f.y + f.vy * 0.7;
    const k = Math.min(1, dt * 4);
    this.camera.x += (tx - this.camera.x) * k;
    this.camera.y += (ty - this.camera.y) * k;
    const zoom = 1 - Math.min(1, speed / 30) * 0.38;
    this.camera.zoom += (zoom - this.camera.zoom) * Math.min(1, dt * 1.5);
  }

  // ------------------------------------------------------------------ HUD ----

  snapshot(): HudSnapshot {
    if (this.hud) return this.hud;
    const f = this.focus();
    const v = this.player.vehicle;
    this.hud = {
      money: this.score.money,
      multiplier: this.score.multiplier,
      lives: this.score.lives,
      wanted: this.wanted.level,
      health: Math.max(0, Math.round(v ? v.health : this.player.health)),
      pager: this.pager ? { from: this.pager.from, text: this.pager.text } : null,
      timer: this.missions.active ? Math.max(0, this.missions.timeLeft) : null,
      street: streetLabel(this.world, f.x, f.y),
      hood: neighbourhoodAt(this.meta, f.x, f.y),
      speedKmh: v ? Math.round(Math.abs(forwardSpeed(v)) * 3.6) : 0,
      inVehicle: !!v,
      phase: phaseAt(this.meta, f.x, f.y),
      unlocked: this.save.unlocked,
    };
    return this.hud;
  }
}

function circles(v: Vehicle) {
  const q = v.params.length / 4;
  const r = v.params.width / 2 + 0.05;
  const fx = Math.cos(v.heading) * q;
  const fy = Math.sin(v.heading) * q;
  return [
    { x: v.x + fx, y: v.y + fy, r },
    { x: v.x - fx, y: v.y - fy, r },
  ];
}

/** Is (x, y) within the car's rectangle grown by `pad` metres? */
export function insideCar(
  v: { x: number; y: number; heading: number; params: { length: number; width: number } },
  x: number,
  y: number,
  pad: number,
) {
  const dx = x - v.x;
  const dy = y - v.y;
  const c = Math.cos(v.heading);
  const s = Math.sin(v.heading);
  return (
    Math.abs(dx * c + dy * s) <= v.params.length / 2 + pad &&
    Math.abs(-dx * s + dy * c) <= v.params.width / 2 + pad
  );
}

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
    .replace(/ Y /g, ' y ');
