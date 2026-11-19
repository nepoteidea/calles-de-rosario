// Money, multiplier and lives, the way the late-90s top-down games kept score.

export interface Score {
  money: number;
  multiplier: number;
  lives: number;
}

export const START_LIVES = 3;
export const MAX_MULTIPLIER = 5;

export const newScore = (): Score => ({ money: 0, multiplier: 1, lives: START_LIVES });

/** Adds base × multiplier and returns what was actually earned. */
export function earn(s: Score, base: number): number {
  const gained = Math.round(base * s.multiplier);
  s.money += gained;
  return gained;
}

export function completeMission(s: Score, reward: number): number {
  const gained = earn(s, reward);
  s.multiplier = Math.min(MAX_MULTIPLIER, s.multiplier + 1);
  return gained;
}

/** Busted: the police take half your money, reset the multiplier and a life. */
export function busted(s: Score) {
  const lost = Math.ceil(s.money / 2);
  s.money -= lost;
  s.multiplier = 1;
  s.lives = Math.max(0, s.lives - 1);
  return lost;
}

/** Killed: lose a life and the multiplier, keep the money. */
export function killed(s: Score) {
  s.multiplier = 1;
  s.lives = Math.max(0, s.lives - 1);
}

export const isGameOver = (s: Score) => s.lives <= 0;

/** "$ 004.250" — dotted thousands, zero-padded like an arcade counter. */
export function formatMoney(n: number): string {
  const digits = Math.max(0, Math.floor(n)).toString().padStart(6, '0');
  return `$ ${digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}
