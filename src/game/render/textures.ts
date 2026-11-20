// Procedural textures for the ground layer, painted once per resolution.
// Each texture is a small tileable canvas; the ground painter uses them as
// patterns anchored to world coordinates, so they line up across tiles.
// All art is original: noise, tiles and stripes drawn here.

export type TextureName =
  | 'asphalt'
  | 'avenue'
  | 'stone'
  | 'patio'
  | 'grass'
  | 'park'
  | 'forest'
  | 'water'
  | 'sand'
  | 'plaza'
  | 'travertine'
  | 'concrete'
  | 'dirt';

const rand = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

const hex = (c: string) => {
  const n = parseInt(c.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

/** Base colour plus per-pixel noise. */
function noise(size: number, base: string, amount: number, seed: number, speckle = 0) {
  const [c, g] = canvas(size);
  const img = g.createImageData(size, size);
  const [r, gg, b] = hex(base);
  const rn = rand(seed);
  for (let i = 0; i < size * size; i++) {
    let d = (rn() - 0.5) * amount;
    if (speckle && rn() < speckle) d += (rn() - 0.5) * amount * 3;
    img.data[i * 4] = r + d;
    img.data[i * 4 + 1] = gg + d;
    img.data[i * 4 + 2] = b + d;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return { c, g, rn };
}

/** Square paving: tiles of `tileM` metres with grout lines and a lit edge. */
function paving(ppm: number, tileM: number, colors: string[], grout: string, seed: number) {
  const t = Math.max(4, Math.round(tileM * ppm));
  const size = t * 2;
  const { c, g, rn } = noise(size, grout, 10, seed);
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 2; x++) {
      g.fillStyle = colors[(x + y * 2) % colors.length];
      g.fillRect(x * t + 1, y * t + 1, t - 2, t - 2);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(x * t + 1, y * t + 1, t - 2, 1);
      g.fillRect(x * t + 1, y * t + 1, 1, t - 2);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      for (let k = 0; k < 4; k++) g.fillRect(x * t + 2 + rn() * (t - 5), y * t + 2 + rn() * (t - 5), 2, 1);
    }
  }
  return c;
}

export function makeTextures(ppm: number): Record<TextureName, HTMLCanvasElement> {
  const size = Math.max(32, Math.round(ppm * 8));

  const asphalt = noise(size, '#4a4e60', 16, 1, 0.04).c;
  const avenue = noise(size, '#43465a', 16, 2, 0.04).c;

  const grassOf = (base: string, seed: number, blades: string[]) => {
    const { c, g, rn } = noise(size, base, 14, seed);
    for (let i = 0; i < size * 1.5; i++) {
      g.fillStyle = blades[i % blades.length];
      g.fillRect(rn() * size, rn() * size, 1, 2);
    }
    return c;
  };
  const grass = grassOf('#55813f', 3, ['#6a9a4d', '#46713a']);
  const park = grassOf('#4c7f3a', 4, ['#6a9c4c', '#3a6a2c']);
  const forest = grassOf('#3d6a30', 5, ['#4f8240', '#2f5726']);

  const water = (() => {
    const { c, g, rn } = noise(size, '#4f6c70', 8, 6);
    g.strokeStyle = 'rgba(160,190,186,0.35)';
    g.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const x = rn() * size,
        y = rn() * size,
        w = size * 0.18;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + w / 2, y - 2, x + w, y);
      g.stroke();
    }
    return c;
  })();

  const sand = noise(size, '#d6c69a', 18, 7, 0.05).c;
  const dirt = noise(size, '#8d7a5c', 18, 8, 0.05).c;

  const patio = (() => {
    // block interiors: backyards, patios and the odd bit of lawn
    const { c, g, rn } = noise(size, '#8f8a7d', 12, 9);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = rn() < 0.5 ? 'rgba(80,120,60,0.35)' : 'rgba(170,160,140,0.35)';
      const s = size * (0.15 + rn() * 0.25);
      g.fillRect(rn() * (size - s), rn() * (size - s), s, s * (0.5 + rn()));
    }
    return c;
  })();

  return {
    asphalt,
    avenue,
    stone: paving(ppm, 1.6, ['#d1c8a3', '#cbc19b', '#c7bd96', '#d5cda9'], '#a2987a', 10),
    plaza: paving(ppm, 1.2, ['#c9c0ad', '#c2b9a5', '#cfc7b4'], '#9f9786', 11),
    travertine: paving(ppm, 2.4, ['#e4dccb', '#ddd4c1', '#e8e1d1'], '#bdb39a', 12),
    concrete: paving(ppm, 4, ['#a9a9a6', '#a3a3a0'], '#8c8c89', 13),
    patio,
    grass,
    park,
    forest,
    water,
    sand,
    dirt,
  };
}
