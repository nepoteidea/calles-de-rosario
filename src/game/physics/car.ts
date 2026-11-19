// Arcade car model: velocity, heading, grip and drift. No physics engine.
// Heading 0 points east (+x); angles grow clockwise because y points south.

export interface CarState {
  x: number;
  y: number;
  heading: number;
  vx: number;
  vy: number;
}

export interface CarControls {
  /** 0..1 */
  throttle: number;
  /** 0..1, brakes while moving forward, reverses when stopped */
  brake: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
  handbrake: boolean;
}

export interface CarParams {
  accel: number;
  brake: number;
  maxSpeed: number;
  maxReverse: number;
  /** rad/s at full lock */
  turnRate: number;
  /** lateral velocity decay per second; lower = more drift */
  grip: number;
  drag: number;
  length: number;
  width: number;
}

export const DEFAULT_CAR: CarParams = {
  accel: 9,
  brake: 16,
  maxSpeed: 30,
  maxReverse: 7,
  turnRate: 2.6,
  grip: 9,
  drag: 0.35,
  length: 4.4,
  width: 2,
};

/** Surface multipliers: off-road is slow and slippery. */
export interface Surface {
  speed: number;
  grip: number;
}
export const ROAD_SURFACE: Surface = { speed: 1, grip: 1 };
export const ROUGH_SURFACE: Surface = { speed: 0.55, grip: 0.7 };

export const forwardSpeed = (c: CarState) => c.vx * Math.cos(c.heading) + c.vy * Math.sin(c.heading);
export const speedOf = (c: { vx: number; vy: number }) => Math.hypot(c.vx, c.vy);

/** Advances the car by dt seconds, ignoring collisions. Mutates and returns state. */
export function stepCar(
  c: CarState,
  ctl: CarControls,
  p: CarParams,
  dt: number,
  surface: Surface = ROAD_SURFACE,
): CarState {
  const fx = Math.cos(c.heading);
  const fy = Math.sin(c.heading);
  let vf = c.vx * fx + c.vy * fy;
  let vl = -c.vx * fy + c.vy * fx;

  const top = p.maxSpeed * surface.speed;
  if (ctl.throttle > 0 && vf < top) vf = Math.min(top, vf + p.accel * ctl.throttle * dt);
  if (ctl.brake > 0) {
    if (vf > 0.3) vf = Math.max(0, vf - p.brake * ctl.brake * dt);
    else vf = Math.max(-p.maxReverse, vf - p.accel * 0.6 * ctl.brake * dt);
  }
  if (ctl.handbrake) vf -= vf * Math.min(1, 1.5 * dt);
  // rolling drag, plus extra drag when coasting so cars settle instead of sliding forever
  vf -= vf * p.drag * dt;
  if (ctl.throttle === 0 && ctl.brake === 0) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 2.5 * dt);
  if (vf > top) vf -= (vf - top) * Math.min(1, 2 * dt);

  // steering scales up from standstill so you can't spin in place
  const turn = ctl.steer * p.turnRate * Math.min(1, Math.abs(vf) / 6) * Math.sign(vf || 1);
  c.heading += turn * dt * (ctl.handbrake ? 1.35 : 1);

  const grip = p.grip * surface.grip * (ctl.handbrake ? 0.18 : 1);
  vl *= Math.exp(-grip * dt);

  const nfx = Math.cos(c.heading);
  const nfy = Math.sin(c.heading);
  c.vx = vf * nfx - vl * nfy;
  c.vy = vf * nfy + vl * nfx;
  c.x += c.vx * dt;
  c.y += c.vy * dt;
  return c;
}

/** Corners and side midpoints of the car's rectangle, for tile collision. */
export function carProbePoints(
  c: { x: number; y: number; heading: number },
  p: Pick<CarParams, 'length' | 'width'>,
) {
  const fx = Math.cos(c.heading);
  const fy = Math.sin(c.heading);
  const hl = p.length / 2;
  const hw = p.width / 2;
  const out: [number, number][] = [];
  for (const [a, b] of [
    [hl, hw],
    [hl, -hw],
    [-hl, hw],
    [-hl, -hw],
    [hl, 0],
    [0, hw],
    [0, -hw],
    [-hl, 0],
  ]) {
    out.push([c.x + fx * a - fy * b, c.y + fy * a + fx * b]);
  }
  return out;
}

/**
 * Steering for analog input (touch joystick, gamepad): turn toward the stick's
 * absolute direction. Returns -1..1.
 */
export function steerToward(heading: number, target: number, reversing: boolean): number {
  let d = (target - heading) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  const s = Math.max(-1, Math.min(1, d * 2.2));
  return reversing ? -s : s;
}
