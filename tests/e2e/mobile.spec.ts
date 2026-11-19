// Runs in the phone projects only (see playwright.config.ts): touch, landscape.
import { expect, test } from '@playwright/test';

type Pos = { state: string; x: number; y: number };
const pos = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { __cdr: { state(): Pos } }).__cdr.state());

test('landscape shows the touch controls', async ({ page }) => {
  await page.goto('/?test');
  await page.getByRole('button', { name: 'JUGAR' }).click();
  const controls = page.getByTestId('touch-controls');
  await expect(controls).toBeVisible({ timeout: 30_000 });
  for (const name of ['GAS', 'FRENO', 'ACCIÓN', 'TIRO']) {
    await expect(controls.getByRole('button', { name })).toBeVisible();
  }
  await expect(page.getByTestId('rotate')).toBeHidden();
});

test('the joystick walks the player', async ({ page }) => {
  await page.goto('/?test');
  await page.getByRole('button', { name: 'JUGAR' }).click();
  await page.waitForFunction(
    () => (window as unknown as { __cdr?: { state(): Pos } }).__cdr?.state().state === 'playing',
    null,
    { timeout: 30_000 },
  );
  const before = await pos(page);
  const stick = page.getByTestId('touch-controls').locator('.stick');
  const box = (await stick.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy, { steps: 4 });
  await page.waitForTimeout(1200);
  await page.mouse.up();
  const after = await pos(page);
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(1);
});

test.describe('in portrait', () => {
  test.use({ viewport: { width: 412, height: 839 } });

  test('asks you to rotate the phone', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('rotate')).toBeVisible();
    await expect(page.getByText('GIRÁ EL CELULAR')).toBeVisible();
  });
});
