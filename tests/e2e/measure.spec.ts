/**
 * Guidet oppmåling med emulert Meta Quest 3 i gjennomsynsmodus (immersive-ar).
 */
import { expect } from '@playwright/test';
import {
  align,
  collectErrors,
  enterMeasure,
  frames,
  measureCurrent,
  measureState,
  placeTipLocal,
  press,
  test,
  waitForModel,
} from './helpers';

test('«Mål opp leiligheten» starter gjennomsyn og ber om justering ved døra', async ({ page }) => {
  const errors = collectErrors(page);
  await enterMeasure(page);
  const s = await measureState(page);
  expect(s.phase).toBe('align-0');
  expect(s.panel?.title).toBe('Start: hjørnet ved døra');
  expect(s.panel?.body).toContain('inngangsdøra');
  expect(s.method).toBe('touch');
  expect(await page.evaluate(() => (window as any).leilighet.xr.debugState().mode)).toBe('measure');
  // Gjennomsyn: den tette modellen er skjult, bare trådskjelettet vises (etter justering).
  expect(await page.evaluate(() => (window as any).leilighet.apartment.root.visible)).toBe(false);
  expect(s.beacon).toBe(false);
  await expect(page.getByTestId('measure-button')).toHaveText('Avslutt oppmåling');
  expect(errors).toEqual([]);
});

test('to berøringer legger modellen oppå rommet', async ({ page }) => {
  await enterMeasure(page);
  await align(page);
  const s = await measureState(page);
  expect(s.phase).toBe('measure');
  expect(s.status?.text).toContain('lagt på plass');
  expect(s.rig.yaw).toBeCloseTo(-Math.PI / 6, 3);
  // Hjørnet ved døra er nå origo i verden (= modellen).
  await placeTipLocal(page, 0.5, 0.02, -1.0);
  const tip = (await measureState(page)).tip;
  expect(Math.hypot(tip.x, tip.y, tip.z)).toBeLessThan(0.002);
  // Første oppgave: hjørnet ved døra, med lysende merke og trådskjelett.
  expect(s.task).toBe('hjorne:gang:0');
  expect(s.beacon).toBe(true);
  expect(s.overlayTriangles).toBeGreaterThan(500);
  expect(s.panel?.title).toBe('Gang: hjørne 1 av 4');
  expect(s.panel?.badge).toBe('Berør');
});

test('for kort justering avvises med forklaring', async ({ page }) => {
  await enterMeasure(page);
  await placeTipLocal(page, 0, 0.02, -1);
  await press(page, 'right', 'trigger');
  await placeTipLocal(page, 0.2, 1, -1.05);
  await press(page, 'right', 'trigger');
  const s = await measureState(page);
  expect(s.phase).toBe('align-1');
  expect(s.status).toEqual({ text: expect.stringContaining('For nær hjørnet'), tone: 'error' });
  // B går tilbake til første steg.
  await press(page, 'right', 'b-button');
  expect((await measureState(page)).phase).toBe('align-0');
});

test('mål, hopp over og angre med kontrollerne', async ({ page }) => {
  await enterMeasure(page);
  await align(page);
  await measureCurrent(page, 12, 0, -8);
  let s = await measureState(page);
  expect(s.status).toEqual({ text: 'Målt: Gang: hjørne 1 av 4', tone: 'ok' });
  expect(s.task).toBe('hjorne:gang:1');
  expect(s.panel?.header).toMatch(/^Gang · 1 av \d+ +· +totalt 1 av \d+$/);
  const corner = await page.evaluate(() => (window as any).leilighet.measure.draft.rooms[0].polygon[0]);
  expect(corner).toEqual([
    { value: 12, measured: true },
    { value: -8, measured: true },
  ]);

  await press(page, 'right', 'a-button');
  s = await measureState(page);
  expect(s.task).toBe('hjorne:gang:2');
  expect(s.status?.text).toContain('Hoppet over');

  await press(page, 'right', 'b-button');
  s = await measureState(page);
  expect(s.task).toBe('hjorne:gang:1');
  expect(s.status?.text).toContain('Angret');
  await press(page, 'right', 'b-button');
  expect((await measureState(page)).task).toBe('hjorne:gang:0');
  expect(await page.evaluate(() => (window as any).leilighet.measure.progress().done)).toBe(0);

  // Venstre stikke blar i listen uten å hoppe over.
  await page.evaluate(() => (window as any).__iwer.controllers.left.updateAxes('thumbstick', 1, 0));
  await frames(page, 3);
  await page.evaluate(() => (window as any).__iwer.controllers.left.updateAxes('thumbstick', 0, 0));
  await frames(page, 3);
  expect((await measureState(page)).task).toBe('hjorne:gang:1');
  expect(await page.evaluate(() => (window as any).leilighet.measure.progress().skipped)).toBe(0);
});

test('pek-modus: uten romskanning forklares det, og man kan bytte tilbake', async ({ page }) => {
  await enterMeasure(page);
  await align(page);
  await press(page, 'right', 'thumbstick');
  let s = await measureState(page);
  expect(s.method).toBe('point');
  expect(s.panel?.badge).toBe('Pek');
  expect(s.hitTest).toBe('unavailable');
  await press(page, 'right', 'trigger');
  s = await measureState(page);
  expect(s.status?.tone).toBe('error');
  expect(s.status?.text).toContain('Pek-modus virker ikke her');
  expect(await page.evaluate(() => (window as any).leilighet.measure.progress().done)).toBe(0);
  await press(page, 'right', 'thumbstick');
  expect((await measureState(page)).method).toBe('touch');
});

test('målingene lagres lokalt, vises i modellen og kan lastes ned eller forkastes', async ({ page }) => {
  const errors = collectErrors(page);
  await enterMeasure(page);
  await align(page);
  await measureCurrent(page, 40, 0, 0);
  // Hjørne 2 har fulgt etter (+40 mm) og måles der modellen nå tror det er.
  await measureCurrent(page);
  await page.evaluate(() => (window as any).leilighet.xr.exit());
  await page.waitForFunction(() => (window as any).leilighet.xr.presenting === false);

  // Utkastet vises i modellen og i panelet.
  await expect(page.getByTestId('draft')).toBeVisible();
  await expect(page.getByTestId('draft-status')).toContainText('målinger: 2 av');
  expect(await page.evaluate(() => (window as any).leilighet.apartment.root.visible)).toBe(true);
  const shown = await page.evaluate(() => (window as any).leilighet.store.doc.rooms[0].polygon[1][0]);
  expect(shown).toEqual({ value: 2340, measured: true });

  // Overlever omlasting (lagret i nettleseren).
  await page.reload();
  await waitForModel(page);
  await expect(page.getByTestId('draft-status')).toContainText('målinger: 2 av');
  await expect(page.getByTestId('measure-button')).toHaveText('Fortsett oppmålingen');
  expect(await page.evaluate(() => (window as any).leilighet.store.doc.rooms[0].polygon[1][0])).toEqual({
    value: 2340,
    measured: true,
  });

  // Last ned apartment.json.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('draft-download').click()]);
  expect(download.suggestedFilename()).toBe('apartment.json');
  const text = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'));
  const doc = JSON.parse(text);
  expect(doc.rooms[0].polygon[0]).toEqual([
    { value: 40, measured: true },
    { value: 0, measured: true },
  ]);
  expect(doc.meta.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByTestId('draft-upload')).toHaveAttribute(
    'href',
    'https://github.com/Jovialen337/Leilighet-3d/upload/main/public',
  );

  // Forkast (bekreft dialogen).
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('draft-discard').click();
  await expect(page.getByTestId('draft')).toBeHidden();
  expect(await page.evaluate(() => (window as any).leilighet.store.doc.rooms[0].polygon[1][0])).toBe(2300);
  await expect(page.getByTestId('measure-button')).toHaveText('Mål opp leiligheten');
  expect(errors).toEqual([]);
});

test('når den nedlastede fila er publisert, ryddes de lokale målingene', async ({ page }) => {
  await enterMeasure(page);
  await align(page);
  await measureCurrent(page, 25, 0, 0);
  await page.evaluate(() => (window as any).leilighet.xr.exit());
  await page.waitForFunction(() => (window as any).leilighet.xr.presenting === false);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('draft-download').click()]);
  const text = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'));
  // «Publiser»: siden får den nedlastede fila som apartment.json.
  await page.route('**/apartment.json', (route) => route.fulfill({ body: text, contentType: 'application/json' }));
  await page.reload();
  await waitForModel(page);
  await expect(page.getByTestId('draft-published')).toBeVisible();
  await expect(page.getByTestId('draft')).toBeHidden();
  expect(await page.evaluate(() => (window as any).leilighet.measure.tasks[0].key)).toBe('hjorne:gang:1');
});
