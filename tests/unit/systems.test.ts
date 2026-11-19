import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAR,
  carProbePoints,
  forwardSpeed,
  ROUGH_SURFACE,
  speedOf,
  steerToward,
  stepCar,
} from '../../src/game/physics/car.ts';
import { Wanted } from '../../src/game/systems/wanted.ts';
import {
  busted,
  completeMission,
  earn,
  formatMoney,
  isGameOver,
  killed,
  newScore,
} from '../../src/game/systems/score.ts';
import {
  MISSIONS,
  MissionRunner,
  unlockedPhase,
  type MissionContext,
} from '../../src/game/systems/missions.ts';
import { clearSave, emptySave, loadSave, writeSave } from '../../src/game/systems/save.ts';
import { Input, keyAction } from '../../src/game/input/input.ts';

const idle = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const gas = { ...idle, throttle: 1 };
const run = (
  ctl: typeof idle,
  seconds: number,
  car = { x: 0, y: 0, heading: 0, vx: 0, vy: 0 },
  surface = undefined,
) => {
  for (let t = 0; t < seconds; t += 1 / 60) stepCar(car, ctl, DEFAULT_CAR, 1 / 60, surface);
  return car;
};

describe('car physics', () => {
  it('accelerates forward along its heading', () => {
    const car = run(gas, 1);
    expect(car.vx).toBeGreaterThan(7);
    expect(Math.abs(car.vy)).toBeLessThan(1e-9);
    expect(car.x).toBeGreaterThan(3);
  });

  it('tops out near max speed', () => {
    const car = run(gas, 20);
    expect(speedOf(car)).toBeLessThanOrEqual(DEFAULT_CAR.maxSpeed + 0.01);
    expect(speedOf(car)).toBeGreaterThan(DEFAULT_CAR.maxSpeed * 0.75);
  });

  it('is slower off-road', () => {
    const road = speedOf(run(gas, 20));
    const rough = speedOf(run(gas, 20, undefined, ROUGH_SURFACE as never));
    expect(rough).toBeLessThan(road * 0.7);
  });

  it('brakes to a stop and then reverses', () => {
    const car = run(gas, 2);
    run({ ...idle, brake: 1 }, 1, car);
    expect(forwardSpeed(car)).toBeLessThan(1);
    run({ ...idle, brake: 1 }, 2, car);
    expect(forwardSpeed(car)).toBeLessThan(-1);
    expect(forwardSpeed(car)).toBeGreaterThanOrEqual(-DEFAULT_CAR.maxReverse - 0.01);
  });

  it('coasts to a stop', () => {
    const car = run(gas, 1);
    run(idle, 8, car);
    expect(speedOf(car)).toBeLessThan(0.05);
  });

  it('only turns while moving', () => {
    const still = run({ ...idle, steer: 1 }, 1);
    expect(still.heading).toBe(0);
    const moving = run({ ...gas, steer: 1 }, 1);
    expect(moving.heading).toBeGreaterThan(0.5);
  });

  it('drifts more with the handbrake', () => {
    const grip = run({ ...gas, steer: 1 }, 0.4, { ...run(gas, 2) });
    const drift = run({ ...gas, steer: 1, handbrake: true }, 0.4, { ...run(gas, 2) });
    const lateral = (c: { vx: number; vy: number; heading: number }) =>
      Math.abs(-c.vx * Math.sin(c.heading) + c.vy * Math.cos(c.heading));
    expect(lateral(drift)).toBeGreaterThan(lateral(grip));
  });

  it('gives eight probe points around the body', () => {
    const pts = carProbePoints({ x: 0, y: 0, heading: 0 }, DEFAULT_CAR);
    expect(pts).toHaveLength(8);
    expect(Math.max(...pts.map((p) => p[0]))).toBeCloseTo(DEFAULT_CAR.length / 2);
  });

  it('steers toward an analog stick direction', () => {
    expect(steerToward(0, Math.PI / 2, false)).toBe(1);
    expect(steerToward(0, -0.1, false)).toBeCloseTo(-0.22);
    expect(steerToward(0, Math.PI / 2, true)).toBe(-1);
    expect(steerToward(3, -3, false)).toBeGreaterThan(0);
  });
});

describe('wanted level', () => {
  it('rises with crimes, more when the police see it', () => {
    const w = new Wanted();
    w.crime('carjack', false);
    expect(w.level).toBe(0);
    w.crime('pedKilled', true);
    expect(w.level).toBe(1);
    w.crime('copCarDestroyed', true);
    w.crime('copCarDestroyed', true);
    w.crime('copCarDestroyed', true);
    w.crime('copCarDestroyed', true);
    expect(w.level).toBe(4);
  });

  it('cools down one level at a time out of sight', () => {
    const w = new Wanted();
    w.heat = 2;
    w.update(Wanted.coolTime(2) - 1, false);
    expect(w.level).toBe(2);
    w.update(5, true);
    w.update(Wanted.coolTime(2) - 1, false);
    expect(w.level).toBe(2);
    w.update(2, false);
    expect(w.level).toBe(1);
    w.update(Wanted.coolTime(1) + 0.1, false);
    expect(w.level).toBe(0);
    w.update(1, false);
    expect(w.level).toBe(0);
  });

  it('sends more police at higher levels', () => {
    expect([0, 1, 2, 3, 4].map(Wanted.copsFor)).toEqual([0, 1, 2, 3, 5]);
    const w = new Wanted();
    w.heat = 3;
    w.clear();
    expect(w.level).toBe(0);
  });
});

describe('score', () => {
  it('multiplies earnings', () => {
    const s = newScore();
    expect(earn(s, 100)).toBe(100);
    expect(completeMission(s, 1000)).toBe(1000);
    expect(s.multiplier).toBe(2);
    expect(earn(s, 100)).toBe(200);
    expect(s.money).toBe(1300);
  });

  it('caps the multiplier', () => {
    const s = newScore();
    for (let i = 0; i < 10; i++) completeMission(s, 1);
    expect(s.multiplier).toBe(5);
  });

  it('takes half the money and a life when busted', () => {
    const s = { money: 4251, multiplier: 2, lives: 3 };
    expect(busted(s)).toBe(2126);
    expect(s).toEqual({ money: 2125, multiplier: 1, lives: 2 });
  });

  it('takes a life when killed and ends the game at zero', () => {
    const s = { money: 500, multiplier: 3, lives: 1 };
    killed(s);
    expect(s).toEqual({ money: 500, multiplier: 1, lives: 0 });
    expect(isGameOver(s)).toBe(true);
    killed(s);
    expect(s.lives).toBe(0);
  });

  it('formats money like the arcade counter', () => {
    expect(formatMoney(4250)).toBe('$ 004.250');
    expect(formatMoney(0)).toBe('$ 000.000');
    expect(formatMoney(1234567)).toBe('$ 1.234.567');
  });
});

describe('missions', () => {
  const places = {
    a: { x: 0, y: 0 },
    monumento: { x: 100, y: 0 },
    balcarce_jujuy: { x: 50, y: 0 },
    francia_salta: { x: 0, y: 50 },
    start: { x: 10, y: 10 },
  };
  const ctx = (o: Partial<MissionContext> = {}): MissionContext => ({
    x: 0,
    y: 0,
    places,
    vehicleTag: null,
    wanted: 0,
    isDestroyed: () => false,
    ...o,
  });
  const coupe = MISSIONS.find((m) => m.id === 'coupe')!;
  const patrullero = MISSIONS.find((m) => m.id === 'patrullero')!;

  it('defines at least three phase-1 missions with places and rewards', () => {
    expect(MISSIONS.length).toBeGreaterThanOrEqual(3);
    for (const m of MISSIONS) {
      expect(m.steps.length).toBeGreaterThan(0);
      expect(m.reward).toBeGreaterThan(0);
    }
  });

  it('walks through the steps of the coupé job', () => {
    const r = new MissionRunner();
    expect(r.start(coupe)).toEqual({ type: 'step', text: coupe.steps[0].text });
    expect(r.update(1, ctx())).toBeNull();
    expect(r.update(1, ctx({ vehicleTag: 'coupe' }))?.type).toBe('step');
    // arriving with the police behind you only gives a hint
    expect(r.update(1, ctx({ x: 100, vehicleTag: 'coupe', wanted: 2 }))?.type).toBe('hint');
    expect(r.update(1, ctx({ x: 100, vehicleTag: 'coupe', wanted: 2 }))).toBeNull();
    // arriving on foot doesn't count
    expect(r.update(1, ctx({ x: 100, vehicleTag: null }))).toBeNull();
    const done = r.update(1, ctx({ x: 100, vehicleTag: 'coupe' }));
    expect(done).toEqual({ type: 'complete', mission: coupe });
    expect(r.active).toBe(false);
  });

  it('hints when you arrive without the right car', () => {
    const r = new MissionRunner();
    r.start(coupe);
    r.update(1, ctx({ vehicleTag: 'coupe' }));
    expect(r.update(1, ctx({ x: 100, vehicleTag: null }))).toEqual({
      type: 'hint',
      text: expect.stringContaining('auto'),
    });
  });

  it('fails when time runs out', () => {
    const r = new MissionRunner();
    r.start(coupe);
    expect(r.update(coupe.timeLimit + 1, ctx())).toEqual({ type: 'failed', reason: 'Se acabó el tiempo.' });
  });

  it('fails when the car you need is destroyed', () => {
    const r = new MissionRunner();
    r.start(coupe);
    expect(r.update(1, ctx({ isDestroyed: (t) => t === 'coupe' }))?.type).toBe('failed');
  });

  it('runs destroy → lose the police → go home', () => {
    const r = new MissionRunner();
    r.start(patrullero);
    expect(r.target({ places }, () => ({ x: 7, y: 7 }))).toEqual({ x: 7, y: 7 });
    expect(r.update(1, ctx({ isDestroyed: () => true }))?.type).toBe('step');
    expect(r.target({ places }, () => null)).toBeNull();
    expect(r.update(1, ctx({ wanted: 1 }))).toBeNull();
    expect(r.update(1, ctx({ wanted: 0 }))?.type).toBe('step');
    expect(r.target({ places }, () => null)).toEqual(places.start);
    expect(r.update(1, ctx({ x: 10, y: 10 }))?.type).toBe('complete');
    r.abort();
    expect(r.target({ places }, () => null)).toBeNull();
    expect(r.update(1, ctx())).toBeNull();
  });

  it('opens phase 2 after the three jobs and phase 3 with money', () => {
    const all = MISSIONS.map((m) => m.id);
    expect(unlockedPhase([], 1e6)).toBe(1);
    expect(unlockedPhase(all, 1000)).toBe(2);
    expect(unlockedPhase(all, 50_000)).toBe(3);
  });
});

describe('save', () => {
  const memory = () => {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
  };

  it('round-trips progress', () => {
    const store = memory();
    const s = emptySave();
    s.score.money = 900;
    s.completed.push('coupe');
    s.unlocked = 2;
    writeSave(s, store);
    expect(loadSave(store)).toEqual(s);
    clearSave(store);
    expect(loadSave(store)).toEqual(emptySave());
  });

  it('ignores corrupt or foreign data', () => {
    const store = memory();
    store.setItem('calles-de-rosario/save', '{nope');
    expect(loadSave(store)).toEqual(emptySave());
    store.setItem('calles-de-rosario/save', JSON.stringify({ version: 9 }));
    expect(loadSave(store)).toEqual(emptySave());
    store.setItem(
      'calles-de-rosario/save',
      JSON.stringify({ version: 1, score: { money: 5 }, completed: [1, 'x'], unlocked: 99 }),
    );
    expect(loadSave(store)).toMatchObject({ score: { money: 5, lives: 3 }, completed: ['x'], unlocked: 3 });
  });

  it('never throws when storage is unavailable', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadSave(broken)).toEqual(emptySave());
    expect(() => writeSave(emptySave(), broken)).not.toThrow();
    expect(() => clearSave(broken)).not.toThrow();
    expect(loadSave(null)).toEqual(emptySave());
  });
});

describe('input', () => {
  it('maps keys to relative driving controls', () => {
    const i = new Input();
    expect(keyAction('ArrowUp')).toBe('up');
    expect(i.keyDown('ArrowUp')).toBe(true);
    i.keyDown('KeyA');
    i.keyDown('ShiftLeft');
    expect(i.keyDown('KeyZ')).toBe(false);
    const f = i.read();
    expect(f).toMatchObject({ throttle: 1, steer: -1, handbrake: true, stick: null });
    i.keyUp('ArrowUp');
    expect(i.keyUp('KeyQ')).toBe(false);
    expect(i.read().throttle).toBe(0);
  });

  it('fires action, map and pause once per press', () => {
    const i = new Input();
    i.keyDown('Enter');
    i.keyDown('KeyM');
    i.keyDown('Escape');
    expect(i.read()).toMatchObject({ action: true, map: true, pause: true });
    i.keyDown('Enter'); // key repeat
    expect(i.read().action).toBe(false);
    i.keyUp('Enter');
    i.keyDown('Enter');
    expect(i.read().action).toBe(true);
  });

  it('reads the touch joystick and buttons', () => {
    const i = new Input();
    i.touch.stick = { x: 0.1, y: 0.1 };
    expect(i.read().stick).toBeNull();
    i.touch.stick = { x: 0, y: -1 };
    i.touch.gas = true;
    i.touch.fire = true;
    i.touch.action = true;
    expect(i.read()).toMatchObject({ stick: { x: 0, y: -1 }, throttle: 1, fire: true, action: true });
    expect(i.read().action).toBe(false);
    i.touch.brake = true;
    expect(i.read().brake).toBe(1);
    i.releaseAll();
    expect(i.read()).toMatchObject({ stick: null, throttle: 0, brake: 0, fire: false });
  });

  it('reads a standard gamepad', () => {
    const i = new Input();
    const pad = (pressed: number[], axes = [0, 0]) =>
      ({
        axes,
        buttons: Array.from({ length: 16 }, (_, k) => ({
          pressed: pressed.includes(k),
          value: pressed.includes(k) ? 1 : 0,
        })),
      }) as unknown as Gamepad;
    expect(i.read(pad([7, 2], [0.9, 0]))).toMatchObject({ throttle: 1, fire: true, stick: { x: 0.9, y: 0 } });
    expect(i.read(pad([3])).action).toBe(true);
    expect(i.read(pad([3])).action).toBe(false);
    expect(i.read(pad([6, 14, 8, 9]))).toMatchObject({ brake: 1, steer: -1, map: true, pause: true });
    expect(i.read(pad([15, 12, 13]))).toMatchObject({ steer: 1, throttle: 1, brake: 1 });
  });

  it('can be disabled', () => {
    const i = new Input();
    i.keyDown('ArrowUp');
    i.enabled = false;
    expect(i.read().throttle).toBe(0);
  });
});
