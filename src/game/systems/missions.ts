// Phone-booth missions: data plus a small state machine that the game ticks.

export type Step =
  | { kind: 'enterVehicle'; tag: string; text: string }
  | { kind: 'goto'; place: string; radius: number; text: string; inVehicle?: string; noWanted?: boolean }
  | { kind: 'destroy'; tag: string; text: string }
  | { kind: 'loseWanted'; text: string };

export interface MissionSpawn {
  tag: string;
  place: string;
  kind: 'car' | 'copCar';
  color?: string;
}

export interface MissionDef {
  id: string;
  title: string;
  /** Place id of the phone booth that starts it. */
  phone: string;
  from: string;
  timeLimit: number;
  reward: number;
  steps: Step[];
  spawns: MissionSpawn[];
  done: string;
}

export const MISSIONS: MissionDef[] = [
  {
    id: 'coupe',
    title: 'La coupé amarilla',
    phone: 'laprida_cordoba',
    from: 'EL TANO',
    timeLimit: 240,
    reward: 5000,
    spawns: [{ tag: 'coupe', place: 'oronio_rioja', kind: 'car', color: '#F6B40E' }],
    steps: [
      { kind: 'enterVehicle', tag: 'coupe', text: 'Hay una coupé amarilla en Oroño y La Rioja. Robala.' },
      {
        kind: 'goto',
        place: 'monumento',
        radius: 30,
        inVehicle: 'coupe',
        noWanted: true,
        text: 'Llevá la coupé amarilla al Monumento a la Bandera. Que no te siga nadie.',
      },
    ],
    done: 'Impecable, pibe. La coupé ya tiene dueño nuevo.',
  },
  {
    id: 'encomienda',
    title: 'Encomienda a Pichincha',
    phone: 'sarmiento_mendoza',
    from: 'LA RUSA',
    timeLimit: 200,
    reward: 3000,
    spawns: [],
    steps: [
      { kind: 'goto', place: 'balcarce_jujuy', radius: 10, text: 'Buscá el paquete en Balcarce y Jujuy.' },
      {
        kind: 'goto',
        place: 'francia_salta',
        radius: 12,
        text: 'Llevá el paquete a Francia y Salta, en Pichincha. Rápido.',
      },
    ],
    done: 'Llegó entero. Te ganaste unos mangos.',
  },
  {
    id: 'patrullero',
    title: 'Chau, patrullero',
    phone: 'corrientes_pellegrini',
    from: 'EL TANO',
    timeLimit: 300,
    reward: 8000,
    spawns: [{ tag: 'target', place: 'italia_tucuman', kind: 'copCar' }],
    steps: [
      { kind: 'destroy', tag: 'target', text: 'Hay un patrullero estacionado en Italia y Tucumán. Rompelo.' },
      { kind: 'loseWanted', text: 'Perdé a la policía. El taller de Dorrego y Mendoza te pinta el auto.' },
      { kind: 'goto', place: 'start', radius: 15, text: 'Volvé a la guarida en Entre Ríos y Rioja.' },
    ],
    done: 'Buenísimo. Ahora el norte y el oeste son tuyos.',
  },
];

export interface MissionContext {
  x: number;
  y: number;
  places: Record<string, { x: number; y: number }>;
  vehicleTag: string | null;
  wanted: number;
  isDestroyed(tag: string): boolean;
}

export type MissionEvent =
  | { type: 'step'; text: string }
  | { type: 'hint'; text: string }
  | { type: 'complete'; mission: MissionDef }
  | { type: 'failed'; reason: string };

export class MissionRunner {
  mission: MissionDef | null = null;
  step = 0;
  timeLeft = 0;
  private hinted = false;

  get active() {
    return this.mission !== null;
  }

  get currentStep(): Step | null {
    return this.mission?.steps[this.step] ?? null;
  }

  start(m: MissionDef): MissionEvent {
    this.mission = m;
    this.step = 0;
    this.timeLeft = m.timeLimit;
    this.hinted = false;
    return { type: 'step', text: m.steps[0].text };
  }

  abort() {
    this.mission = null;
  }

  /** Where the objective arrow should point, if anywhere. */
  target(ctx: Pick<MissionContext, 'places'>, tagPos: (tag: string) => { x: number; y: number } | null) {
    const s = this.currentStep;
    if (!s) return null;
    if (s.kind === 'goto') return ctx.places[s.place] ?? null;
    if (s.kind === 'enterVehicle' || s.kind === 'destroy') return tagPos(s.tag);
    return null;
  }

  update(dt: number, ctx: MissionContext): MissionEvent | null {
    const m = this.mission;
    if (!m) return null;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) return this.fail('Se acabó el tiempo.');
    const s = m.steps[this.step];

    const needs = m.steps
      .slice(this.step)
      .map((st) => ('inVehicle' in st ? st.inVehicle : st.kind === 'enterVehicle' ? st.tag : undefined));
    for (const tag of needs)
      if (tag && ctx.isDestroyed(tag)) return this.fail('Rompiste el auto que hacía falta.');

    let done = false;
    switch (s.kind) {
      case 'enterVehicle':
        done = ctx.vehicleTag === s.tag;
        break;
      case 'destroy':
        done = ctx.isDestroyed(s.tag);
        break;
      case 'loseWanted':
        done = ctx.wanted === 0;
        break;
      case 'goto': {
        const p = ctx.places[s.place];
        const inside = !!p && Math.hypot(ctx.x - p.x, ctx.y - p.y) <= s.radius;
        const vehicleOk = !s.inVehicle || ctx.vehicleTag === s.inVehicle;
        if (inside && vehicleOk && s.noWanted && ctx.wanted > 0) {
          if (!this.hinted) {
            this.hinted = true;
            return { type: 'hint', text: 'Te están siguiendo. Perdé a la policía y volvé.' };
          }
        } else if (inside && !vehicleOk && !this.hinted) {
          this.hinted = true;
          return { type: 'hint', text: 'Así no, pibe. Traé el auto que te pedí.' };
        }
        done = inside && vehicleOk && !(s.noWanted && ctx.wanted > 0);
        break;
      }
    }
    if (!done) return null;
    this.step++;
    this.hinted = false;
    if (this.step >= m.steps.length) {
      this.mission = null;
      return { type: 'complete', mission: m };
    }
    return { type: 'step', text: m.steps[this.step].text };
  }

  private fail(reason: string): MissionEvent {
    this.mission = null;
    return { type: 'failed', reason };
  }
}

/** Which phase is open given finished missions and money. */
export function unlockedPhase(completed: readonly string[], money: number): number {
  const phase1Done = MISSIONS.every((m) => completed.includes(m.id));
  if (!phase1Done) return 1;
  return money >= 50_000 ? 3 : 2;
}
