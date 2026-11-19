// Wanted level 0–4. Crimes add heat; staying out of sight of the police cools it down.

export type Crime = 'pedKilled' | 'carjack' | 'copHit' | 'copCarDestroyed' | 'gunfire' | 'carDestroyed';

const HEAT: Record<Crime, [alone: number, witnessed: number]> = {
  pedKilled: [0.5, 1],
  carjack: [0.2, 1],
  copHit: [1, 1],
  copCarDestroyed: [1.2, 1.2],
  gunfire: [0, 0.25],
  carDestroyed: [0.3, 0.6],
};

export const MAX_WANTED = 4;

export class Wanted {
  heat = 0;
  private unseen = 0;

  get level(): number {
    return Math.min(MAX_WANTED, Math.floor(this.heat + 1e-9));
  }

  /** Seconds out of sight needed to drop one level. */
  static coolTime(level: number) {
    return 8 + level * 4;
  }

  crime(kind: Crime, witnessed: boolean) {
    const [alone, seen] = HEAT[kind];
    this.heat = Math.min(MAX_WANTED + 0.99, this.heat + (witnessed ? seen : alone));
    this.unseen = 0;
  }

  /** copInSight: a police unit is close enough to see the player this tick. */
  update(dt: number, copInSight: boolean) {
    if (this.level === 0) {
      this.unseen = 0;
      return;
    }
    if (copInSight) {
      this.unseen = 0;
      return;
    }
    this.unseen += dt;
    if (this.unseen >= Wanted.coolTime(this.level)) {
      this.heat = this.level - 1;
      this.unseen = 0;
    }
  }

  clear() {
    this.heat = 0;
    this.unseen = 0;
  }

  /** Police cars that should be hunting the player at this level. */
  static copsFor(level: number) {
    return [0, 1, 2, 3, 5][Math.min(MAX_WANTED, level)];
  }
}
