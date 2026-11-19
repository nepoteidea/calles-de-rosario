// Colours from the Claude Design screens (Calles de Rosario — first screens).

import { Tile } from '../map/format.ts';

export const C = {
  ink: '#15161b',
  paper: '#f3efe6',
  sun: '#F6B40E',
  sky: '#74ACDF',
  copRed: '#e23b3b',
  copBlue: '#3b6fe2',
  road: '#3b3c43',
  avenue: '#34353b',
  laneYellow: 'rgba(233,196,74,0.55)',
  laneWhite: 'rgba(240,240,240,0.35)',
  sidewalk: '#a29d92',
  sidewalkSeam: '#8c877c',
  park: '#4f7d3c',
  pitch: '#5b8a45',
  tree: ['#2f5a2a', '#356a2e', '#3c7334'],
  water: '#2c6a88',
  sand: '#cdbd8f',
  rail: '#6d6256',
  plaza: '#c4bba8',
  ground: '#8b877e',
  shadow: 'rgba(0,0,0,0.28)',
};

/** Roof colours: [base, highlight, shade] */
export const ROOFS: [string, string, string][] = [
  ['#b4553d', '#cf7a5f', '#8a3d2b'],
  ['#8a7d6b', '#a99c88', '#6a5f50'],
  ['#c9b48c', '#ded0ae', '#a08c66'],
  ['#66737e', '#85929d', '#4c5761'],
  ['#9b4b39', '#ba6a56', '#743527'],
  ['#8f949b', '#aeb3ba', '#6d7279'],
  ['#c7894c', '#dca66e', '#9d6835'],
  ['#71604f', '#8f7e6c', '#544638'],
];

/** Flat colour per tile type for the minimap and the city map. */
export const MAP_COLORS: Record<number, string> = {
  [Tile.Ground]: '#2a2c33',
  [Tile.Road]: '#e8e3d3',
  [Tile.Sidewalk]: '#55565c',
  [Tile.Building]: '#6e6a62',
  [Tile.Park]: '#4f7d3c',
  [Tile.Water]: '#2c6a88',
  [Tile.Rail]: '#55565c',
  [Tile.Plaza]: '#77746c',
  [Tile.Sand]: '#cdbd8f',
};
