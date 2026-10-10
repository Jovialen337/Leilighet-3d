import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { collectErrors, colorDistance, pixelAt, renderedFrames, screenOf, stats, waitForModel } from './helpers';

const apartment = (): any =>
  JSON.parse(readFileSync(fileURLToPath(new URL('../../public/apartment.json', import.meta.url)), 'utf8'));

test('laster fra Pages-stien uten feil, med norsk UI', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await waitForModel(page);
  await expect(page).toHaveTitle('Leilighet 3D');
  const panel = page.getByTestId('panel');
  for (const text of ['Visning', 'Lag', 'Konstruksjon', 'Dører og vinduer', 'Møbler', 'Elektrisk – planlagt', 'Vis tak', 'Ovenfra (2D)']) {
    await expect(panel).toContainText(text);
  }
  await expect(page.getByTestId('status')).toContainText('6 rom');
  await expect(page.getByTestId('measure-info')).toContainText('1 delvis');
  // Hodeløs Chromium har ingen VR-enhet: knappen skal si det på norsk.
  await expect(page.getByTestId('vr-button')).toHaveText(/VR støttes ikke her|Nettleseren mangler WebXR/);
  await expect(page.getByTestId('vr-button')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('hele leiligheten tegnes med få tegnekall', async ({ page }) => {
  await page.goto('./');
  await waitForModel(page);
  await renderedFrames(page);
  const s = await stats(page);
  expect(s.drawCalls).toBeGreaterThan(5);
  expect(s.drawCalls).toBeLessThanOrEqual(30);
  expect(s.sceneTriangles).toBeLessThan(50_000);
});

test('lagbrytere skjuler og viser lag', async ({ page }) => {
  await page.goto('./');
  await waitForModel(page);
  // Tallene gjelder siste tegnede ramme. På trege maskiner kan det ta litt før
  // neste ramme er tegnet, så vi venter på resultatet i stedet for en fast tid.
  const rendered = async (): Promise<number> => (await stats(page)).trianglesRendered!;
  await expect.poll(rendered).toBeGreaterThan(0);
  const before = await rendered();
  const box = page.getByTestId('layer-furniture');
  await box.uncheck();
  expect(await page.evaluate(() => (window as any).leilighet.apartment.isLayerVisible('furniture'))).toBe(false);
  await expect.poll(rendered).toBeLessThan(before);
  await box.check();
  expect(await page.evaluate(() => (window as any).leilighet.apartment.isLayerVisible('furniture'))).toBe(true);
  await expect.poll(rendered).toBe(before);

  // Alle lag av → ingenting tegnes.
  const ids = await page.evaluate(() => (window as any).leilighet.view.layers.layers.map((l: any) => l.id));
  for (const id of ids) await page.getByTestId(`layer-${id}`).uncheck();
  await expect.poll(rendered).toBe(0);
  for (const id of ids) await page.getByTestId(`layer-${id}`).check();
});

test('ovenfra-visningen er i riktig målestokk', async ({ page }) => {
  await page.goto('./');
  await waitForModel(page);
  await page.getByTestId('mode-top').click();
  await expect(page.getByTestId('scalebar')).toBeVisible();
  await renderedFrames(page);

  // Avstand på skjermen mellom to kjente hjørner = lengde × piksler per meter.
  const pxPerM = Number(await page.getByTestId('scalebar').getAttribute('data-px-per-m'));
  expect(pxPerM).toBeGreaterThan(20);
  const a = await screenOf(page, 0, 0, 0);
  const b = await screenOf(page, 9100, 0, 0);
  const c = await screenOf(page, 0, 0, 5700);
  expect(Math.hypot(b.x - a.x, b.y - a.y) / pxPerM).toBeCloseTo(9.1, 2);
  expect(Math.hypot(c.x - a.x, c.y - a.y) / pxPerM).toBeCloseTo(5.7, 2);
  // Ikke speilvendt: x mot høyre, z nedover.
  expect(b.x).toBeGreaterThan(a.x);
  expect(c.y).toBeGreaterThan(a.y);

  // Koordinater under musepekeren.
  const p = await screenOf(page, 6100, 0, 1500);
  await page.mouse.move(p.x, p.y);
  const coords = page.getByTestId('coords');
  await expect(coords).toContainText('mm');
  expect(Math.abs(Number(await coords.getAttribute('data-x')) - 6100)).toBeLessThanOrEqual(15);
  expect(Math.abs(Number(await coords.getAttribute('data-z')) - 1500)).toBeLessThanOrEqual(15);

  // Gangen (mørkt gulv) og stua (lyst gulv) havner der planen sier.
  const gang = await screenOf(page, 1500, 0, 1400);
  const stue = await screenOf(page, 3200, 180, 1000);
  const cGang = await pixelAt(page, gang.x, gang.y);
  const cStue = await pixelAt(page, stue.x, stue.y);
  expect(colorDistance(cGang, cStue)).toBeGreaterThan(30);
  expect(cStue[0]).toBeGreaterThan(cGang[0]);
});

test('en endring i apartment.json endrer modellen', async ({ page }) => {
  const doc = apartment();
  doc.rooms.find((r: any) => r.id === 'stue').floorLevel = 300;
  doc.walls.find((w: any) => w.id === 'v-inngang').thickness = 400;
  const plante = doc.rooms.find((r: any) => r.id === 'planterom');
  plante.polygon = [[0, 2500], [2300, 2500], [2300, 6000], [0, 6000]];
  await page.route('**/apartment.json', (route) => route.fulfill({ json: doc }));
  await page.goto('./');
  await waitForModel(page);
  expect(await page.evaluate(() => (window as any).leilighet.floorAt(3.0, 1.0))).toBeCloseTo(0.3, 6);
  const wallMinZ = await page.evaluate(() => {
    const p = (window as any).leilighet.apartment.proxies.find((m: any) => m.userData.id === 'v-inngang');
    return p.geometry.boundingBox.min.z;
  });
  expect(wallMinZ).toBeCloseTo(-0.4, 5);
  // Større planterom → større totalareal og en advarsel om kontrollmålet.
  await expect(page.getByTestId('status')).toContainText('46,5 m²');
  await expect(page.getByTestId('warnings')).toContainText('kontrollmålet lengde');
});

test('feil i apartment.json vises som norske feilmeldinger', async ({ page }) => {
  const doc = apartment();
  doc.rooms[0].polygon = [[0, 0], [1, 1]];
  doc.openings[0].wall = 'finnes-ikke';
  await page.route('**/apartment.json', (route) => route.fulfill({ json: doc }));
  await page.goto('./');
  const box = page.getByTestId('errors');
  await expect(box).toBeVisible();
  await expect(box).toContainText('Feil i apartment.json');
  await expect(box).toContainText('minst 3 punkter');

  await page.unroute('**/apartment.json');
  await page.route('**/apartment.json', (route) => route.fulfill({ body: '{ "rooms": [ ', contentType: 'application/json' }));
  await page.getByRole('button', { name: 'Prøv igjen' }).click();
  await expect(box).toContainText('ikke gyldig JSON');
});

test('skjult bildefrekvens vises med F', async ({ page }) => {
  await page.goto('./');
  await waitForModel(page);
  const fps = page.getByTestId('fps');
  await expect(fps).toBeHidden();
  await page.keyboard.press('f');
  await expect(fps).toBeVisible();
  await expect(fps).toContainText('fps', { timeout: 5000 });
  await page.keyboard.press('f');
  await expect(fps).toBeHidden();
});

test('plassholdere kan markeres', async ({ page }) => {
  await page.goto('./');
  await waitForModel(page);
  const read = () =>
    page.evaluate(() => {
      const m = (window as any).leilighet.apartment.merged.find((x: any) => x.layer === 'structure' && x.bucket === 'solid');
      return Array.from(m.mesh.geometry.getAttribute('color').array.slice(0, 3)) as number[];
    });
  const base = await read();
  await page.getByTestId('toggle-measure').check();
  await expect(page.locator('.legend')).toBeVisible();
  await expect(page.locator('.legend')).toContainText('plassholder');
  expect(await read()).not.toEqual(base);
  await page.getByTestId('toggle-measure').uncheck();
  expect(await read()).toEqual(base);
});
