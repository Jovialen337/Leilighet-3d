/**
 * Tegning av el og vann, og lag/filtre – på PC (mus og tastatur) og i VR
 * (emulert Quest 3, strålen fra høyre kontroller).
 */
import { expect, type Page } from '@playwright/test';
import { aimAt, collectErrors, enterVR, menuPress, press, test, waitForModel, xrState } from './helpers';

const scr = (page: Page, x: number, y: number, z: number) =>
  page.evaluate(([a, b, c]) => (window as any).leilighet.desktop.screenOf(a, b, c), [x, y, z] as const);
const model = (page: Page) => page.evaluate(() => (window as any).leilighet.store.model.data);
const clickPlan = async (page: Page, x: number, z: number) => {
  const p = await scr(page, x, 1500, z);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
};

test('PC: tegn en kabel i 2D-planen, angre, og den huskes og eksporteres', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await waitForModel(page);
  await page.keyboard.press('2');
  await page.keyboard.press('e'); // kabel
  await expect(page.getByTestId('tool-wire')).toHaveAttribute('aria-pressed', 'true');
  await clickPlan(page, 3000, 1000);
  await clickPlan(page, 3000, 3000);
  await clickPlan(page, 5000, 3000);
  await expect(page.getByTestId('plan-message')).toContainText('3 punkt · 4,00 m');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('plan-message')).toContainText('lagt inn: 4,00 m');
  let d = await model(page);
  const wire = d.wiring.find((w: any) => w.id === 'kabel-1');
  expect(wire.points).toEqual([
    [3000, 300, 1000],
    [3000, 300, 3000],
    [5000, 300, 3000],
  ]);
  await expect(page.getByTestId('draft-status')).toContainText('tegnet el og vann: 1 endring');

  // Lagret lokalt.
  await page.reload();
  await waitForModel(page);
  d = await model(page);
  expect(d.wiring.some((w: any) => w.id === 'kabel-1')).toBe(true);

  // Med i nedlastet fil.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('draft-download').click()]);
  const text = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'));
  expect(JSON.parse(text).wiring.some((w: any) => w.id === 'kabel-1')).toBe(true);

  // Angre (Ctrl+Z) fjerner kabelen.
  await page.keyboard.press('Control+z');
  d = await model(page);
  expect(d.wiring.some((w: any) => w.id === 'kabel-1')).toBe(false);
  await expect(page.getByTestId('draft')).toBeHidden();
  expect(errors).toEqual([]);
});

test('PC: sett en stikkontakt på veggen, velg den og slett den med knappen', async ({ page }) => {
  await page.goto('./');
  await waitForModel(page);
  await page.keyboard.press('2');
  await page.getByTestId('tool-fixture').click();
  await clickPlan(page, 4000, 30);
  let d = await model(page);
  const fx = d.fixtures.find((f: any) => f.id === 'stk-1');
  expect(fx).toMatchObject({ type: 'outlet', status: 'planned', mount: { wall: 'v-inngang', room: 'stue', along: 4200, height: 300 } });
  await page.getByTestId('tool-select').click();
  await clickPlan(page, 4000, 20);
  await expect(page.getByTestId('plan-message')).toContainText('Valgt');
  await page.getByTestId('plan-delete').click();
  d = await model(page);
  expect(d.fixtures.some((f: any) => f.id === 'stk-1')).toBe(false);
});

test('PC: lag og filtre – Elplan, planlagt av, røntgen, og det huskes', async ({ page }) => {
  await page.goto('./');
  await waitForModel(page);
  const vis = (id: string) => page.evaluate((i) => (window as any).leilighet.apartment.isLayerVisible(i), id);
  await page.getByTestId('preset-elplan').click();
  expect(await vis('furniture')).toBe(false);
  expect(await vis('plumbing-existing')).toBe(false);
  expect(await vis('wiring')).toBe(true);
  await expect(page.getByTestId('group-el')).toBeChecked();
  await page.getByTestId('preset-alt').click();
  expect(await vis('furniture')).toBe(true);
  // «Bare» viser bare laget (pluss bygget).
  await page.getByTestId('solo-plumbing-planned').click();
  expect(await vis('plumbing-planned')).toBe(true);
  expect(await vis('plumbing-existing')).toBe(false);
  expect(await vis('structure')).toBe(true);
  await page.getByTestId('layers-all').click();

  const planned = () =>
    page.evaluate(() => (window as any).leilighet.apartment.ranges.has('kaldt-planterom'));
  expect(await planned()).toBe(true);
  await page.getByTestId('filter-planned').uncheck();
  expect(await planned()).toBe(false);
  await page.getByTestId('filter-xray').check();
  expect(await page.evaluate(() => (window as any).leilighet.materials.wall.transparent)).toBe(true);
  await page.reload();
  await waitForModel(page);
  expect(await planned()).toBe(false);
  expect(await page.evaluate(() => (window as any).leilighet.materials.wall.transparent)).toBe(true);
  await expect(page.getByTestId('filter-xray')).toBeChecked();
});

test('PC: kabler og rør synes i 2D-planen også over snitthøyden', async ({ page }) => {
  await page.goto('./');
  await waitForModel(page);
  await page.keyboard.press('2');
  const r = await page.evaluate(() => {
    const m = (window as any).leilighet.materials;
    return { linesClipped: (m.lines.clippingPlanes ?? []).length, depthTest: m.lines.depthTest, wallsClipped: m.wall.clippingPlanes.length };
  });
  expect(r).toEqual({ linesClipped: 0, depthTest: false, wallsClipped: 1 });
});

test('VR: tegn et kaldtvannsrør på veggen med strålen, avslutt med A og angre med B', async ({ page }) => {
  const errors = collectErrors(page);
  await enterVR(page);
  await press(page, 'left', 'x-button');
  await menuPress(page, 'tab:tegn');
  await menuPress(page, 'draw:pipe:cold');
  let s = await xrState(page);
  expect(s.menu.open).toBe(false);
  expect(s.draw.tool).toBe('draw:pipe:cold');
  const before = (await model(page)).pipes.length;
  // Veggen mellom gangen og planterommet (z ≈ 2,35 m), én meter over gulvet.
  await aimAt(page, 'right', { x: 0.6, y: 1.0, z: 2.35 });
  await press(page, 'right', 'trigger');
  await aimAt(page, 'right', { x: 1.6, y: 1.0, z: 2.35 });
  s = await xrState(page);
  expect(s.draw.hover?.h).toBeGreaterThan(900);
  await press(page, 'right', 'trigger');
  expect((await xrState(page)).draw.points).toBe(2);
  await press(page, 'right', 'a-button');
  let d = await model(page);
  expect(d.pipes.length).toBe(before + 1);
  const pipe = d.pipes.at(-1);
  expect(pipe).toMatchObject({ kind: 'cold', status: 'planned' });
  expect(Math.abs(pipe.points[0][1] - pipe.points[1][1])).toBeLessThan(1); // vannrett
  await press(page, 'right', 'b-button');
  d = await model(page);
  expect(d.pipes.length).toBe(before);
  expect(errors).toEqual([]);
});

test('VR: Lag-fanen – forhåndsvalg og filtre', async ({ page }) => {
  await enterVR(page);
  await press(page, 'left', 'x-button');
  await menuPress(page, 'tab:lag');
  await menuPress(page, 'preset:rorplan');
  const vis = (id: string) => page.evaluate((i) => (window as any).leilighet.apartment.isLayerVisible(i), id);
  expect(await vis('plumbing-existing')).toBe(true);
  expect(await vis('wiring')).toBe(false);
  await menuPress(page, 'toggle:xray');
  expect(await page.evaluate(() => (window as any).leilighet.view.xray.value)).toBe(true);
});

test('PC: grafikkvalitet – himmel, myke skygger og skarphet, og valget huskes', async ({ browser }) => {
  const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.route('**/apartment.json', async (route) =>
    route.fulfill({ json: JSON.parse((await import('node:fs')).readFileSync(new URL('../fixtures/placeholder.json', import.meta.url), 'utf8')) }),
  );
  await page.goto('./');
  await waitForModel(page);
  const state = () =>
    page.evaluate(() => {
      const a = (window as any).leilighet;
      return { sky: a.sky.visible, shades: a.apartment.shades.every((m: any) => m.visible), ratio: a.renderer.getPixelRatio() };
    });
  expect(await state()).toEqual({ sky: true, shades: true, ratio: 2 });
  await page.getByTestId('setting-quality').selectOption({ label: 'Rask' });
  expect(await state()).toEqual({ sky: false, shades: false, ratio: 1.25 });
  await page.getByTestId('setting-quality').selectOption({ label: 'Høy' });
  expect(await state()).toEqual({ sky: true, shades: true, ratio: 3 });
  await page.reload();
  await waitForModel(page);
  expect((await state()).ratio).toBe(3);
  await expect(page.getByTestId('setting-quality')).toHaveValue('2');
  await ctx.close();
});

test('VR: grafikkvalitet velges i menyen', async ({ page }) => {
  await enterVR(page);
  await press(page, 'left', 'x-button');
  await menuPress(page, 'quality:low');
  expect(await page.evaluate(() => (window as any).leilighet.view.quality.value)).toBe('low');
  expect(await page.evaluate(() => (window as any).leilighet.apartment.shades.some((m: any) => m.visible))).toBe(false);
});

test('PC: kursfilteret viser bare én kurs', async ({ page }) => {
  await page.goto('./');
  await waitForModel(page);
  const has = (id: string) => page.evaluate((i) => (window as any).leilighet.apartment.ranges.has(i), id);
  expect(await has('kabel-planterom')).toBe(true);
  await page.getByTestId('filter-circuit').selectOption({ label: 'Kurs 1 – gang og stue' });
  expect(await has('kabel-planterom')).toBe(false); // kurs 2
  expect(await has('lampe-stue')).toBe(true); // kurs 1
  expect(await has('kran-bad')).toBe(true); // vann har ingen kurs
  await page.getByTestId('filter-circuit').selectOption({ label: 'Alle kurser' });
  expect(await has('kabel-planterom')).toBe(true);
});

test('lagrede tegninger som ikke passer med fila legges til side – modellen vises likevel', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem(
      'leilighet:plan:v1',
      JSON.stringify({
        version: 1,
        ops: [
          { op: 'put', c: 'fixtures', obj: { id: 'stk-x', type: 'outlet', layer: 'electrical-planned', status: 'planned', mount: { wall: 'finnes-ikke', room: 'stue', along: 100, height: 300 } } },
          { op: 'put', c: 'wiring', obj: { id: 'k-ok', layer: 'wiring', status: 'planned', kind: 'power', points: [[3000, 300, 1000], [4000, 300, 1000]] } },
        ],
      }),
    );
  });
  await page.goto('./');
  await waitForModel(page);
  const d = await model(page);
  expect(d.wiring.some((w: any) => w.id === 'k-ok')).toBe(true);
  expect(d.fixtures.some((f: any) => f.id === 'stk-x')).toBe(false);
  expect(await page.evaluate(() => (window as any).leilighet.stats().mergedMeshes)).toBeGreaterThan(10);
  await expect(page.getByTestId('plan-stale')).toContainText('1 tegnet endring passet ikke');
  await page.getByTestId('plan-stale-discard').click();
  await expect(page.getByTestId('plan-stale')).toBeHidden();
  expect(errors).toEqual([]);
});
