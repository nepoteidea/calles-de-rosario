// Entity shapes shared by the simulation and the renderer.

import { DEFAULT_CAR, type CarParams, type CarState } from './physics/car.ts';
import type { Edge } from './map/format.ts';
import type { NodeLink } from './world/world.ts';

export interface DriverAI {
  mode: 'traffic' | 'chase' | 'parked';
  edge: Edge;
  forward: boolean;
  next: NodeLink | null;
  /** Lateral offset from the centre line, metres to the right of travel. */
  lane: number;
  cruise: number;
  /** Chase: planned links toward the player. */
  path: NodeLink[];
  repath: number;
  stuck: number;
  reversing: number;
  fireCooldown: number;
}

export type VehicleKind = 'civil' | 'cop';
export type Model = 'sedan' | 'coupe' | 'van' | 'cop';

export interface Vehicle extends CarState {
  id: number;
  kind: VehicleKind;
  model: Model;
  params: CarParams;
  color: string;
  tag?: string;
  /** Who is at the wheel. */
  driver: 'none' | 'ai' | 'player';
  ai: DriverAI | null;
  health: number;
  destroyed: boolean;
  /** Seconds since destroyed, for the wreck fade. */
  wreckAge: number;
  px: number;
  py: number;
  ph: number;
}

export interface Ped {
  id: number;
  kind: 'civil' | 'driver';
  x: number;
  y: number;
  heading: number;
  speed: number;
  color: string;
  alive: boolean;
  flee: number;
  think: number;
  deadAge: number;
  step: number;
  px: number;
  py: number;
}

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  fromPlayer: boolean;
}

export interface Fx {
  kind: 'blood' | 'explosion' | 'spark' | 'smoke';
  x: number;
  y: number;
  age: number;
  life: number;
}

export interface Player {
  x: number;
  y: number;
  heading: number;
  vehicle: Vehicle | null;
  health: number;
  fireCooldown: number;
  step: number;
  px: number;
  py: number;
  ph: number;
}

const CIVIL_COLORS = [
  '#c0392b',
  '#2e86c1',
  '#7d8b99',
  '#e8e3d3',
  '#27ae60',
  '#8e44ad',
  '#d35400',
  '#16a085',
  '#bdc3c7',
  '#34495e',
  '#a93226',
  '#5d6d7e',
  '#1abc9c',
  '#2c3e50',
];
export const PED_COLORS = ['#e74c3c', '#f1c40f', '#3498db', '#ecf0f1', '#9b59b6', '#1abc9c', '#e67e22'];

let nextId = 1;
export const newId = () => nextId++;

export const MODELS: Record<Model, CarParams> = {
  sedan: DEFAULT_CAR,
  coupe: { ...DEFAULT_CAR, accel: 11, maxSpeed: 36, turnRate: 2.8, length: 4.2 },
  van: { ...DEFAULT_CAR, accel: 6.5, maxSpeed: 24, turnRate: 2.1, grip: 10, length: 5, width: 2.2 },
  cop: { ...DEFAULT_CAR, accel: 10.5, maxSpeed: 34, turnRate: 2.7, grip: 10, length: 4.6 },
};

export function makeVehicle(
  x: number,
  y: number,
  heading: number,
  opts: { kind?: VehicleKind; model?: Model; color?: string; tag?: string } = {},
): Vehicle {
  const kind = opts.kind ?? 'civil';
  const model = opts.model ?? (kind === 'cop' ? 'cop' : Math.random() < 0.15 ? 'van' : 'sedan');
  return {
    id: newId(),
    kind,
    model,
    params: MODELS[model],
    color:
      opts.color ??
      (kind === 'cop' ? '#f2f2f2' : CIVIL_COLORS[Math.floor(Math.random() * CIVIL_COLORS.length)]),
    tag: opts.tag,
    driver: 'none',
    ai: null,
    health: kind === 'cop' ? 140 : 100,
    destroyed: false,
    wreckAge: 0,
    x,
    y,
    heading,
    vx: 0,
    vy: 0,
    px: x,
    py: y,
    ph: heading,
  };
}

export function makePed(x: number, y: number, kind: Ped['kind'] = 'civil'): Ped {
  return {
    id: newId(),
    kind,
    x,
    y,
    heading: Math.floor(Math.random() * 4) * (Math.PI / 2),
    speed: 1.1 + Math.random() * 0.6,
    color: PED_COLORS[Math.floor(Math.random() * PED_COLORS.length)],
    alive: true,
    flee: 0,
    think: 0,
    deadAge: 0,
    step: 0,
    px: x,
    py: y,
  };
}
