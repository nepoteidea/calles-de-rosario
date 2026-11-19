import { expect, test, type Page } from '@playwright/test';

interface CdrState {
  state: string;
  x: number;
  y: number;
  speed: number;
  inVehicle: boolean;
  wanted: number;
  money: number;
  lives: number;
  mission: string | null;
  vehicles: number;
  peds: number;
}

type Hook = {
  state(): CdrState;
  giveCar(): boolean;
  setWanted(n: number): void;
  spawnCop(): boolean;
  teleport(place: string): void;
};

/** Calls a method of the ?test hook (window.__cdr) in the page. */
const call = <K extends keyof Hook>(page: Page, name: K, ...args: Parameters<Hook[K]>) =>
  page.evaluate(
    ([n, a]) => {
      const h = (window as unknown as { __cdr: Record<string, (...x: unknown[]) => unknown> }).__cdr;
      return h[n as string](...(a as unknown[]));
    },
    [name, args] as const,
  ) as Promise<ReturnType<Hook[K]>>;

const state = (page: Page) => call(page, 'state');

async function startGame(page: Page) {
  await page.goto('/?test');
  await page.getByRole('button', { name: 'JUGAR' }).click();
  await page.waitForFunction(
    () => (window as unknown as { __cdr?: Hook }).__cdr?.state().state === 'playing',
    null,
    {
      timeout: 30_000,
    },
  );
  await expect(page.getByTestId('hud')).toBeVisible();
}

test('main menu shows the title, the menu and the OSM credit', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ROSARIO' })).toBeVisible();
  for (const name of ['JUGAR', 'MAPA DE LA CIUDAD', 'CONTROLES', 'OPCIONES']) {
    await expect(page.getByRole('button', { name })).toBeVisible();
  }
  const osm = page.getByRole('link', { name: 'OpenStreetMap' });
  await expect(osm).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
});

test('controls and options screens open and close', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'CONTROLES' }).click();
  await expect(page.getByRole('heading', { name: 'CONTROLES' })).toBeVisible();
  await page.getByRole('button', { name: 'VOLVER' }).click();
  await page.getByRole('button', { name: 'OPCIONES' }).click();
  await expect(page.getByText('Se guarda en este dispositivo.')).toBeVisible();
  await page.getByRole('button', { name: 'VOLVER' }).click();
  await expect(page.getByRole('button', { name: 'JUGAR' })).toBeVisible();
});

test('the city map shows Rosario with the zones', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'MAPA DE LA CIUDAD' }).click();
  const map = page.getByTestId('city-map');
  await expect(map.getByRole('heading', { name: 'MAPA' })).toBeVisible();
  await expect(map.getByText('Fase 1 · Centro y Pichincha')).toBeVisible();
  await expect(map.getByText('ABIERTA', { exact: true })).toHaveCount(1);
  await expect(map.getByText('CERRADA', { exact: true })).toHaveCount(2);
  await expect(map.getByText('Monumento', { exact: true })).toBeVisible();
  await map.getByRole('button', { name: 'MENÚ' }).click();
  await expect(page.getByRole('button', { name: 'JUGAR' })).toBeVisible();
});

test('starts the game on a real Rosario street with the HUD', async ({ page }) => {
  await startGame(page);
  await expect(page.getByTestId('money')).toHaveText('$ 000.000');
  await expect(page.getByTestId('pager')).toContainText('teléfono');
  await expect(page.getByTestId('where')).toContainText(/ENTRE R.OS|RIOJA/);
  await expect(page.getByTestId('wanted')).toHaveAttribute('data-level', '0');
  await expect(page.getByText('© OpenStreetMap')).toBeVisible();
  // traffic and pedestrians come to life around the player
  await expect.poll(async () => (await state(page)).vehicles, { timeout: 10_000 }).toBeGreaterThan(3);
  await expect.poll(async () => (await state(page)).peds, { timeout: 10_000 }).toBeGreaterThan(3);
});

test('drives a car', async ({ page, isMobile }) => {
  await startGame(page);
  expect(await call(page, 'giveCar')).toBe(true);
  const before = await state(page);
  expect(before.inVehicle).toBe(true);
  // Hold the gas until the car has clearly moved. Headless WebKit on CI has no GPU and
  // renders few frames, so the fixed-step simulation runs slower than real time there.
  const moved = async () => {
    const s = await state(page);
    return Math.hypot(s.x - before.x, s.y - before.y);
  };
  if (isMobile) {
    const gas = page.getByRole('button', { name: 'GAS' });
    const box = (await gas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect.poll(moved, { timeout: 15_000 }).toBeGreaterThan(5);
    await page.mouse.up();
  } else {
    await page.keyboard.down('ArrowUp');
    await expect.poll(moved, { timeout: 15_000 }).toBeGreaterThan(5);
    await page.keyboard.up('ArrowUp');
  }
  expect((await state(page)).inVehicle).toBe(true);
});

test('opens the map from the game and goes back', async ({ page, isMobile }) => {
  await startGame(page);
  if (isMobile) await page.getByRole('button', { name: 'Mapa' }).click();
  else await page.keyboard.press('KeyM');
  const map = page.getByTestId('city-map');
  await expect(map.getByText('ESTÁS EN')).toBeVisible();
  await expect(map.getByRole('img', { name: 'Tu posición' })).toBeVisible();
  await map.getByRole('button', { name: 'VOLVER AL JUEGO' }).click();
  await expect(map).toBeHidden();
  await expect.poll(async () => (await state(page)).state).toBe('playing');
});

test('pauses and resumes', async ({ page }) => {
  await startGame(page);
  await page.getByRole('button', { name: 'Pausa' }).click();
  await expect(page.getByTestId('pause')).toBeVisible();
  expect((await state(page)).state).toBe('paused');
  await page.getByRole('button', { name: 'SEGUIR' }).click();
  await expect.poll(async () => (await state(page)).state).toBe('playing');
});

test('the police catch you: ¡TE AGARRARON!', async ({ page }) => {
  await startGame(page);
  await call(page, 'setWanted', 1);
  await expect(page.getByTestId('wanted')).toHaveAttribute('data-level', '1');
  await call(page, 'spawnCop');
  const caught = page.getByTestId('caught');
  await expect(caught).toBeVisible({ timeout: 20_000 });
  await expect(caught).toHaveAttribute('data-kind', 'busted');
  await expect(caught.getByRole('heading', { name: '¡TE AGARRARON!' })).toBeVisible();
  await expect(caught.getByText('Te queda una menos')).toBeVisible();
  await caught.getByRole('button', { name: 'REINTENTAR' }).click();
  await expect(caught).toBeHidden();
  const s = await state(page);
  expect(s.state).toBe('playing');
  expect(s.lives).toBe(2);
  expect(s.wanted).toBe(0);
});

test('answering a phone starts a job', async ({ page }) => {
  await startGame(page);
  await call(page, 'teleport', 'laprida_cordoba');
  await expect.poll(async () => (await state(page)).mission, { timeout: 5_000 }).toBe('coupe');
  await expect(page.getByTestId('pager')).toContainText('coupé amarilla');
});

test('progress is saved on the device', async ({ page }) => {
  await startGame(page);
  await call(page, 'teleport', 'sarmiento_mendoza');
  await expect.poll(async () => (await state(page)).mission).toBe('encomienda');
  await page.getByRole('button', { name: 'Pausa' }).click();
  await page.getByRole('button', { name: 'MENÚ' }).click();
  await page.getByRole('button', { name: 'OPCIONES' }).click();
  await expect(page.getByText('Fase 1', { exact: true })).toBeVisible();
});
