import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game, insideCar, TICK, type GameEvent } from '../../src/game/game.ts';
import { emptySave } from '../../src/game/systems/save.ts';
import { makeVehicle } from '../../src/game/entities.ts';
import {
  driveAI,
  edgeLength,
  endNode,
  laneOffset,
  makeDriver,
  nearestNode,
  nodePosition,
  pickNext,
  planPath,
  startNode,
  travelPts,
  type DriveContext,
} from '../../src/game/ai/driver.ts';
import { MISSIONS } from '../../src/game/systems/missions.ts';
import { MID, edge, testWorld } from './helpers.ts';

const ticks = (g: Game, seconds: number) => {
  for (let t = 0; t < seconds; t += TICK) g.tick();
};

async function newGame(events: GameEvent[] = []) {
  const g = new Game(testWorld(), emptySave(), (e) => events.push(e), { traffic: 0, peds: 0 });
  await g.begin();
  return g;
}

describe('driver AI helpers', () => {
  const w = testWorld();

  it('reverses travel geometry for edges driven backwards', () => {
    const e = w.loadedEdges()[0];
    expect(Array.from(travelPts(e, false))).toEqual([MID, MID, 0, MID]);
    expect(travelPts(e, false)).toBe(travelPts(e, false));
    expect(edgeLength(e)).toBe(MID);
    expect(endNode({ edge: e, forward: false })).toBe(0);
    expect(startNode({ edge: e, forward: false })).toBe(1);
  });

  it('keeps right on two-way roads and picks a lane on one-way roads', () => {
    expect(laneOffset(edge(9, 0, 1, [0, 0, 1, 0]))).toBe(2);
    expect(laneOffset(edge(9, 0, 1, [0, 0, 1, 0], { oneway: true, lanes: 1 }))).toBe(0);
    const left = laneOffset(edge(9, 0, 1, [0, 0, 1, 0], { oneway: true, lanes: 2 }), 0);
    const right = laneOffset(edge(9, 0, 1, [0, 0, 1, 0], { oneway: true, lanes: 2 }), 0.99);
    expect(left).toBeLessThan(0);
    expect(right).toBeGreaterThan(0);
  });

  it('chooses legal turns and avoids U-turns', () => {
    const fromWest = { edge: w.loadedEdges()[0], forward: true };
    for (let i = 0; i < 20; i++) {
      const n = pickNext(w, fromWest)!;
      expect([1, 3]).toContain(n.edge.id);
      expect(n.forward).toBe(true);
    }
    // dead end at the east edge of the map: turn around
    expect(pickNext(w, { edge: w.loadedEdges()[1], forward: true })).toMatchObject({ forward: false });
    // end of a one-way dead end: nowhere to go
    expect(pickNext(w, { edge: w.loadedEdges()[3], forward: true })).toBeNull();
  });

  it('plans police routes against one-way streets', () => {
    const pos = (n: number) => nodePosition(w, n);
    const path = planPath(w, 0, 3, pos);
    expect(path.map((l) => l.edge.id)).toEqual([0, 2]);
    expect(path[1].forward).toBe(false);
    expect(planPath(w, 2, 2, pos)).toEqual([]);
    expect(planPath(w, 0, 99, pos)).toEqual([]);
    expect(nearestNode(w, MID + 3, MID - 2)).toBe(1);
  });

  it('drives a car along its lane', () => {
    const v = makeVehicle(10, MID + 2, 0);
    v.driver = 'ai';
    v.ai = makeDriver(w.loadedEdges()[0], true);
    v.ai.lane = 2;
    const ctx: DriveContext = {
      world: w,
      clearance: () => Infinity,
      target: null,
      canSee: () => false,
      chaseSpeed: 20,
    };
    const ctl = driveAI(v, TICK, ctx)!;
    expect(ctl.throttle).toBeGreaterThan(0);
    expect(Math.abs(ctl.steer)).toBeLessThan(0.3);
    // something in front: brake
    const blocked = driveAI(v, TICK, { ...ctx, clearance: () => 1 })!;
    expect(blocked.throttle).toBe(0);
  });

  it('parked drivers stay put and stuck drivers back up', () => {
    const v = makeVehicle(10, MID + 2, 0);
    v.ai = makeDriver(w.loadedEdges()[0], true, 'parked');
    const ctx: DriveContext = {
      world: w,
      clearance: () => Infinity,
      target: null,
      canSee: () => false,
      chaseSpeed: 20,
    };
    expect(driveAI(v, TICK, ctx)).toMatchObject({ throttle: 0 });
    v.ai = makeDriver(w.loadedEdges()[0], true);
    for (let i = 0; i < 200; i++) driveAI(v, TICK, ctx);
    expect(v.ai.reversing).toBeGreaterThan(0);
    expect(driveAI(v, TICK, ctx)).toMatchObject({ brake: 1 });
  });

  it('chases a visible target directly', () => {
    const v = makeVehicle(MID - 30, MID, 0, { kind: 'cop' });
    v.ai = makeDriver(w.loadedEdges()[0], true, 'chase');
    const ctl = driveAI(v, TICK, {
      world: w,
      clearance: () => Infinity,
      target: { x: MID - 30, y: MID - 20 },
      canSee: () => true,
      chaseSpeed: 25,
    })!;
    expect(ctl.steer).toBe(-1);
  });

  it('pulls up beside a player on foot instead of running them over', () => {
    const v = makeVehicle(MID - 30, MID, 0, { kind: 'cop' });
    v.vx = 15;
    v.ai = makeDriver(w.loadedEdges()[0], true, 'chase');
    const ctl = driveAI(v, TICK, {
      world: w,
      clearance: () => Infinity,
      target: { x: MID - 26, y: MID },
      targetOnFoot: true,
      canSee: () => true,
      chaseSpeed: 25,
    })!;
    expect(ctl.throttle).toBe(0);
    expect(ctl.brake).toBeGreaterThan(0);
  });
});

describe('Game', () => {
  let events: GameEvent[];
  beforeEach(() => {
    events = [];
    vi.spyOn(Math, 'random').mockReturnValue(0.42);
  });

  it('starts on the sidewalk next to the hideout with a call waiting', async () => {
    const g = await newGame(events);
    expect(g.state).toBe('playing');
    expect(g.player.vehicle).toBeNull();
    expect(g.world.isSolid(g.player.x, g.player.y)).toBe(false);
    expect(g.pager?.text).toMatch(/teléfono/);
    expect(g.objective()?.label).toBe('TELÉFONO');
    const hud = g.snapshot();
    expect(hud).toMatchObject({ money: 0, multiplier: 1, lives: 3, wanted: 0, inVehicle: false });
    expect(g.snapshot()).toBe(hud);
  });

  it('walks with the keyboard and stops at walls', async () => {
    const g = await newGame();
    g.player.x = MID - 10;
    g.player.y = MID + 9;
    g.player.heading = Math.PI / 2; // south, into the building block? no: along the sidewalk
    g.input.keyDown('ArrowUp');
    ticks(g, 1);
    expect(g.player.y).toBeGreaterThan(MID + 12);
    g.player.heading = Math.PI; // west into the buildings
    const x = g.player.x;
    ticks(g, 2);
    expect(g.player.x).toBeGreaterThan(x - 3);
  });

  it('walks with an analog stick', async () => {
    const g = await newGame();
    const y = g.player.y;
    g.input.touch.stick = { x: 0, y: 1 };
    ticks(g, 0.5);
    expect(g.player.y).toBeGreaterThan(y + 1);
    expect(g.player.heading).toBeCloseTo(Math.PI / 2);
  });

  it('gets into a parked car, drives it and gets out', async () => {
    const g = await newGame();
    g.vehicles = [];
    const car = makeVehicle(60, MID + 2, 0);
    g.vehicles.push(car);
    Object.assign(g.player, { x: 60, y: MID + 4 });
    g.input.keyDown('Enter');
    ticks(g, TICK);
    g.input.keyUp('Enter');
    expect(g.player.vehicle).toBe(car);
    g.input.keyDown('ArrowUp');
    ticks(g, 2);
    expect(car.x).toBeGreaterThan(70);
    expect(g.snapshot().inVehicle).toBe(true);
    g.input.keyUp('ArrowUp');
    g.input.keyDown('ArrowDown');
    ticks(g, 2);
    g.input.keyUp('ArrowDown');
    ticks(g, 1);
    g.input.keyDown('Enter');
    ticks(g, TICK);
    expect(g.player.vehicle).toBeNull();
    expect(car.driver).toBe('none');
  });

  it('pulls the driver out when stealing a moving car', async () => {
    const g = await newGame();
    g.vehicles = [];
    const car = makeVehicle(60, MID + 2, 0);
    car.driver = 'ai';
    car.ai = makeDriver(g.world.loadedEdges()[0], true);
    g.vehicles.push(car);
    Object.assign(g.player, { x: 60, y: MID + 4 });
    g.input.keyDown('Enter');
    ticks(g, TICK);
    expect(g.player.vehicle).toBe(car);
    expect(g.peds.some((p) => p.kind === 'driver')).toBe(true);
  });

  it('crashes into buildings without passing through them', async () => {
    const g = await newGame();
    g.vehicles = [];
    const car = makeVehicle(MID, MID + 2, Math.PI / 2);
    g.vehicles.push(car);
    car.driver = 'player';
    g.player.vehicle = car;
    car.vy = 25;
    car.y = MID + 2;
    // straight down the one-way street, then the map edge (water) stops it
    g.input.keyDown('ArrowUp');
    ticks(g, 6);
    expect(car.y).toBeLessThan(256);
    expect(g.world.isSolid(car.x, car.y)).toBe(false);
  });

  it('gets busted when a police car pins you down', async () => {
    const g = await newGame(events);
    g.score.money = 1000;
    g.wanted.heat = 1;
    expect(g.spawnCopNear()).toBe(true);
    const cop = g.vehicles.find((v) => v.kind === 'cop')!;
    Object.assign(cop, { x: g.player.x + 3, y: g.player.y });
    for (let i = 0; i < 180 && g.state === 'playing'; i++) {
      cop.x = g.player.x + 3;
      cop.y = g.player.y;
      cop.vx = cop.vy = 0;
      g.tick();
    }
    expect(g.state).toBe('busted');
    expect(events[0]).toMatchObject({ type: 'busted', lost: 500, lives: 2, money: 500 });
    await g.respawn();
    expect(g.state).toBe('playing');
    expect(g.wanted.level).toBe(0);
    expect(g.vehicles.some((v) => v.kind === 'cop')).toBe(false);
  });

  it('is killed when run over at speed, and the game ends without lives', async () => {
    const g = await newGame(events);
    g.score.lives = 1;
    const car = makeVehicle(g.player.x - 1, g.player.y, 0);
    car.vx = 15;
    g.vehicles = [car];
    g.tick();
    expect(g.state).toBe('gameover');
    expect(events.at(-1)).toMatchObject({ type: 'gameover' });
    expect(g.score.lives).toBe(3);
  });

  it('shoots pedestrians and raises the wanted level', async () => {
    const g = await newGame();
    g.peds = [];
    g.spawnCopNear();
    const ped = {
      ...g.player,
      id: 1,
      kind: 'civil' as const,
      speed: 0,
      color: '#fff',
      alive: true,
      flee: 0,
      think: 99,
      deadAge: 0,
      step: 0,
    };
    ped.x = g.player.x;
    ped.y = g.player.y + 6;
    g.peds.push(ped);
    g.player.heading = Math.PI / 2;
    g.input.keyDown('Space');
    ticks(g, 0.3);
    expect(ped.alive).toBe(false);
    expect(g.wanted.level).toBeGreaterThanOrEqual(1);
    expect(g.score.money).toBeGreaterThan(0);
  });

  it('blows up cars that take too much damage', async () => {
    const g = await newGame();
    const car = makeVehicle(60, MID - 2, 0, { tag: 'target', kind: 'cop' });
    g.vehicles = [car];
    g.player.x = 60;
    g.player.y = MID + 9;
    g.player.heading = -Math.PI / 2;
    g.input.keyDown('Space');
    ticks(g, 3);
    expect(car.destroyed).toBe(true);
    expect(g.wanted.level).toBeGreaterThanOrEqual(1);
  });

  it('starts a job at a ringing phone and pays on completion', async () => {
    const g = await newGame();
    const job = MISSIONS.find((m) => m.id === 'encomienda')!;
    const phone = g.places[job.phone];
    Object.assign(g.player, { x: phone.x, y: phone.y });
    g.tick();
    expect(g.missions.mission?.id).toBe('encomienda');
    expect(g.snapshot().timer).not.toBeNull();
    for (const step of ['balcarce_jujuy', 'francia_salta']) {
      Object.assign(g.player, { x: g.places[step].x, y: g.places[step].y });
      g.tick();
    }
    expect(g.missions.active).toBe(false);
    expect(g.save.completed).toContain('encomienda');
    expect(g.score.money).toBe(job.reward);
    expect(g.score.multiplier).toBe(2);
  });

  it('spawns the coupé for the first job', async () => {
    const g = await newGame();
    const job = MISSIONS.find((m) => m.id === 'coupe')!;
    Object.assign(g.player, g.places[job.phone]);
    g.tick();
    const coupe = g.vehicleByTag('coupe');
    expect(coupe?.model).toBe('coupe');
    expect(g.objective()).toMatchObject({ x: coupe!.x, y: coupe!.y });
  });

  it('opens phase 2 after the three jobs', async () => {
    const g = await newGame();
    g.save.completed = MISSIONS.map((m) => m.id);
    ticks(g, 2.1);
    expect(g.save.unlocked).toBe(2);
    expect(g.pager?.text).toMatch(/Fase 2/);
  });

  it('keeps you out of locked zones', async () => {
    const g = await newGame();
    Object.assign(g.player, { x: MID - 10, y: 196, heading: Math.PI / 2 });
    g.input.keyDown('ArrowUp');
    ticks(g, 3);
    expect(g.player.y).toBeLessThanOrEqual(200);
    expect(g.pager?.text).toMatch(/Zona cerrada/);
    expect(g.isLocked(MID, 230)).toBe(true);
  });

  it('repaints your car at the taller and clears the wanted level', async () => {
    const g = await newGame();
    const car = makeVehicle(g.places.taller.x, g.places.taller.y, 0);
    g.vehicles = [car];
    car.driver = 'player';
    g.player.vehicle = car;
    g.wanted.heat = 2;
    g.score.money = 600;
    g.tick();
    expect(g.wanted.level).toBe(0);
    expect(g.score.money).toBe(100);
  });

  it('spawns and despawns traffic and pedestrians around the player', async () => {
    vi.spyOn(Math, 'random').mockRestore();
    const g = new Game(testWorld(), emptySave(), () => {}, { traffic: 6, peds: 10 });
    await g.begin();
    g.view = { w: 20, h: 20 };
    ticks(g, 6);
    expect(g.vehicles.some((v) => v.driver === 'ai')).toBe(true);
    expect(g.peds.length).toBeGreaterThan(0);
    ticks(g, 6);
    expect(g.state).toBe('playing');
  });

  it('checks points against a car body', () => {
    const v = makeVehicle(0, 0, 0);
    expect(insideCar(v, 2, 0.5, 0)).toBe(true);
    expect(insideCar(v, 0, 2, 0)).toBe(false);
  });
});
