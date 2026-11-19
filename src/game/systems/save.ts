// Progress saved on the device (localStorage). Wrapped so private mode or a
// full quota never breaks the game.

import { newScore, type Score } from './score.ts';

export interface SaveData {
  version: 1;
  score: Score;
  completed: string[];
  unlocked: number;
}

const KEY = 'calles-de-rosario/save';

export const emptySave = (): SaveData => ({ version: 1, score: newScore(), completed: [], unlocked: 1 });

export function loadSave(storage: Pick<Storage, 'getItem'> | null = safeStorage()): SaveData {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return emptySave();
    const d = JSON.parse(raw) as Partial<SaveData>;
    if (d.version !== 1 || !d.score) return emptySave();
    const base = emptySave();
    return {
      version: 1,
      score: { ...base.score, ...d.score },
      completed: Array.isArray(d.completed) ? d.completed.filter((s) => typeof s === 'string') : [],
      unlocked: Math.min(3, Math.max(1, Number(d.unlocked) || 1)),
    };
  } catch {
    return emptySave();
  }
}

export function writeSave(data: SaveData, storage: Pick<Storage, 'setItem'> | null = safeStorage()) {
  try {
    storage?.setItem(KEY, JSON.stringify(data));
  } catch {
    // storage full or blocked: progress just isn't kept
  }
}

export function clearSave(storage: Pick<Storage, 'removeItem'> | null = safeStorage()) {
  try {
    storage?.removeItem(KEY);
  } catch {
    // ignore
  }
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
