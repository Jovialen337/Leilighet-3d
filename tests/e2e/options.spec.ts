/**
 * Valg og kontroll: lagrede innstillinger, «Gå til rom», dukkehus og
 * snitthøyde, hurtigtaster, VR-menyen (X) og snu-valg.
 */
import { expect } from '@playwright/test';
import {
  collectErrors,
  enterVR,
  menuPress,
  press,
  stick,
  test,
  waitForModel,
  xrState,
} from './helpers';

test('innstillingene huskes etter omlasting', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await waitForModel(page);
  await page.getByTestId('toggle-ceilings').uncheck();
  await page.getByTestId('layer-furniture').uncheck();
  await page.getByTestId('setting-turn').selectOption({ label: '45° om gangen' });
  await page.reload();
  await waitForModel(page);
  await expect(page.getByTestId('toggle-ceilings')).not.toBeChecked();
  await expect(page.getByTestId('layer-furniture')).not.toBeChecked();
  expect(await page.evaluate(() => (window as any).leilighet.apartment.isLayerVisible('furniture'))).toBe(false);
  expect(await page.evaluate(() => (window as any).leilighet.view.turn.value)).toBe(45);
  // Tilbakestill gir standard igjen.
  await page.getByTestId('reset-settings').click();
  await expect(page.getByTestId('toggle-ceilings')).toBeChecked();
  await expect(page.getByTestId('layer-furniture')).toBeChecked();
  expect(errors).toEqual([]);
});

test('ødelagt lagring stopper ikke appen', async ({ page }) => {
  const errors = collectErrors(page);
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error('blokkert');
    };
    Storage.prototype.setItem = () => {
      throw new Error('blokkert');
    };
  });
  await page.goto('./');
  await waitForModel(page);
  await page.getByTestId('toggle-ceilings').uncheck();
  expect(errors).toEqual([]);
});

test('«Gå til rom» flytter kameraet til rommet', async ({ page }) => {
  await page.goto('./');
  await waitForModel(page);
  await page.getByTestId('room-kjokken').click();
  await page.waitForFunction(() => {
    const t = (window as any).leilighet.desktop.orbit.target;
    return t.x > 6.1 && t.x < 9.1 && t.z > 0 && t.z < 4.2;
  });
  await page.getByTestId('mode-top').click();
  await page.getByTestId('room-bad').click();
  await page.waitForFunction(() => {
    const t = (window as any).leilighet.desktop.plan.target;
    return t.x > 2.4 && t.x < 4.6 && t.z > 4.3 && t.z < 5.5 && (window as any).leilighet.desktop.ortho.zoom > 1.5;
  });
});

test('dukkehus og snitthøyde kutter modellen', async ({ page }) => {
  await page.goto('./');
  await waitForModel(page);
  const clip = () => page.evaluate(() => (window as any).leilighet.materials.solid.clippingPlanes.map((p: any) => p.constant));
  expect(await clip()).toEqual([]);
  await page.keyboard.press('k');
  expect(await clip()).toEqual([1.5]);
  const slider = page.getByTestId('section-height');
  await expect(slider).toBeVisible();
  await slider.fill('900');
  expect((await clip())[0]).toBeCloseTo(0.9, 6);
  await page.getByTestId('toggle-dollhouse').uncheck();
  expect(await clip()).toEqual([]);
  await expect(slider).toBeHidden();
});

test('hurtigtaster og hjelp', async ({ page }) => {
  await page.goto('./');
  await waitForModel(page);
  await page.keyboard.press('2');
  expect(await page.evaluate(() => (window as any).leilighet.view.cameraMode.value)).toBe('top');
  await page.keyboard.press('1');
  expect(await page.evaluate(() => (window as any).leilighet.view.cameraMode.value)).toBe('orbit');
  await page.keyboard.press('t');
  await expect(page.getByTestId('toggle-ceilings')).not.toBeChecked();
  // F virker også etter at en avkrysningsboks er klikket.
  await page.getByTestId('toggle-measure').check();
  await page.keyboard.press('f');
  await expect(page.getByTestId('fps')).toBeVisible();
  await page.keyboard.press('h');
  await expect(page.getByTestId('help')).toBeVisible();
  await expect(page.getByTestId('help')).toContainText('Dukkehus');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('help')).toBeHidden();
});

test('VR-menyen (X): pek og trykk for å skru av taket og gå til et rom', async ({ page }) => {
  const errors = collectErrors(page);
  await enterVR(page);
  await press(page, 'left', 'x-button');
  let s = await xrState(page);
  expect(s.menu.open).toBe(true);
  expect(s.menu.tab).toBe('visning');
  await menuPress(page, 'toggle:ceilings');
  expect(await page.evaluate(() => (window as any).leilighet.view.ceilings.value)).toBe(false);
  // Lag-fanen → «Alle lag …»: skjul bare møblene.
  await menuPress(page, 'tab:lag');
  expect((await xrState(page)).menu.tab).toBe('lag');
  await menuPress(page, 'tab:lagliste');
  expect((await xrState(page)).menu.tab).toBe('lagliste');
  await menuPress(page, 'layer:furniture');
  expect(await page.evaluate(() => (window as any).leilighet.view.layers.isVisible('furniture'))).toBe(false);
  expect(await page.evaluate(() => (window as any).leilighet.view.layers.isVisible('workshop-zone'))).toBe(true);
  // Gruppebryteren skjuler hele gruppen («Interiør»).
  await menuPress(page, 'tab:lag');
  await menuPress(page, 'group:interior');
  expect(await page.evaluate(() => (window as any).leilighet.view.layers.isVisible('workshop-zone'))).toBe(false);
  // Gå til stua: opp trinnet, og menyen lukkes.
  await menuPress(page, 'tab:ga');
  await menuPress(page, 'room:stue');
  s = await xrState(page);
  expect(s.menu.open).toBe(false);
  expect(s.rig.y).toBeCloseTo(0.18, 3);
  expect(s.head.x).toBeGreaterThan(2.4);
  expect(s.head.x).toBeLessThan(6.0);
  expect(s.head.z).toBeGreaterThan(0);
  expect(s.head.z).toBeLessThan(4.2);
  expect(errors).toEqual([]);
});

test('snu-valg i VR: 45° og 180° bakover', async ({ page }) => {
  await enterVR(page);
  await press(page, 'left', 'x-button');
  await menuPress(page, 'tab:komfort');
  await menuPress(page, 'turn:45');
  await press(page, 'left', 'x-button');
  expect(await page.evaluate(() => (window as any).leilighet.view.turn.value)).toBe(45);
  const s0 = await xrState(page);
  await stick(page, 'right', 1, 0);
  await stick(page, 'right', 0, 0);
  const s1 = await xrState(page);
  expect(s1.rig.yaw - s0.rig.yaw).toBeCloseTo(-Math.PI / 4, 6);
  await stick(page, 'right', 0, 1);
  await stick(page, 'right', 0, 0);
  const s2 = await xrState(page);
  const d = s2.rig.yaw - s1.rig.yaw;
  expect(Math.abs(Math.cos(d) + 1)).toBeLessThan(1e-6);
  expect(Math.hypot(s2.head.x - s1.head.x, s2.head.z - s1.head.z)).toBeLessThan(0.01);
});
