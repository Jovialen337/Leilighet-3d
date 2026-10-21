/**
 * Grafikk: overgangen inn i VR, «Lys» (morgen/dag/kveld/natt), sollys og bakt
 * dagslys – og budsjettet på Quest 3: maks 40 tegnekall per øye og maks
 * 32 MB teksturer, i alle rom.
 */
import { expect, type Page } from '@playwright/test';
import { collectErrors, colorDistance, enterMeasure, enterVR, frames, menuPress, pixelsAt, press, renderedFrames, screenOf, stats, test, waitForModel, xrState } from './helpers';

const app = <T = any>(page: Page, expr: string): Promise<T> => page.evaluate(`(() => { const a = window.leilighet; return ${expr}; })()`);

/** Venter til et nytt bilde er tegnet (VR-bildene kommer sjeldnere i emulatoren). */
async function settle(page: Page): Promise<void> {
  await frames(page, 6);
}

test('VR: inn fra svart med blikket mot lengste utsikt, og overgangen koster ingenting etterpå', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await enterVR(page);
  // Overgangen er ferdig etter litt over ett sekund: kula er skjult og eksponeringen tilbake.
  await expect.poll(async () => (await app(page, 'a.xr.debugState().fade')).active, { timeout: 15_000 }).toBe(false);
  const s = await app(page, 'a.xr.debugState()');
  expect(s.fade.visible).toBe(false);
  expect(s.exposure).toBeCloseTo(await app(page, 'a.xr.exposure'), 6);
  const forward = { x: -Math.sin(s.rig.yaw), z: -Math.cos(s.rig.yaw) };
  expect(forward.x).toBeGreaterThan(0.9);
  await settle(page);
  expect((await stats(page)).drawCallsPerEye).toBeLessThanOrEqual(40);
  // «Gå til rom»: svart med en gang og flyttet, så fades det inn igjen.
  await app(page, "a.xr.goToRoom('stue')");
  expect((await app(page, 'a.xr.debugState().fade')).visible).toBe(true);
  expect((await xrState(page)).floorUnderHead).toBe(180);
  await expect.poll(async () => (await app(page, 'a.xr.debugState().fade')).visible, { timeout: 10_000 }).toBe(false);
  expect(errors).toEqual([]);
});

test('VR: tegnekall og teksturer i alle rom, på «Standard» og «Høy», dag og kveld', async ({ page }) => {
  test.setTimeout(240_000);
  await enterVR(page);
  const rooms: string[] = await app(page, '[...a.store.model.rooms.keys()]');
  expect(rooms.length).toBeGreaterThan(3);
  const worst: Record<string, number> = {};
  // Kvelden har flest effekter (sol og lamper); der ser vi rundt i fire retninger.
  const runs = [
    { quality: 'medium', light: 'kveld', yaws: [0, Math.PI / 2, Math.PI, -Math.PI / 2] },
    { quality: 'medium', light: 'dag', yaws: [0] },
    { quality: 'medium', light: 'morgen', yaws: [0] },
    { quality: 'medium', light: 'natt', yaws: [0] },
    { quality: 'high', light: 'kveld', yaws: [0] },
  ];
  for (const { quality, light, yaws } of runs) {
    await app(page, `(a.view.quality.set('${quality}'), a.view.light.set('${light}'))`);
    for (const room of rooms) {
      await app(page, `a.xr.goToRoom('${room}')`);
      for (const yaw of yaws) {
        await page.evaluate((y) => (window as any).__iwer.quaternion.set(0, Math.sin(y / 2), 0, Math.cos(y / 2)), yaw);
        await settle(page);
        const st = await stats(page);
        const key = `${quality}/${light}`;
        worst[key] = Math.max(worst[key] ?? 0, st.drawCallsPerEye!);
        expect(st.drawCallsPerEye, `${key} i ${room}`).toBeLessThanOrEqual(40);
        expect(st.textureBytes, `${key} i ${room}`).toBeLessThanOrEqual(32 * 1024 * 1024);
      }
    }
  }
  // Standard er godt under grensen (bakt lys og sol koster nesten ingenting).
  expect(worst['medium/dag']).toBeLessThanOrEqual(34);
  test.info().annotations.push({ type: 'tegnekall per øye (verste)', description: JSON.stringify(worst) });
});

test('VR: «Lys» i menyen – kvelden tenner lampene, og valget huskes', async ({ page }) => {
  test.setTimeout(90_000);
  await enterVR(page);
  expect(await app(page, 'a.view.light.value')).toBe('dag');
  const dayKey = await app(page, 'a.lights.key.color.getHexString()');
  expect(await app(page, "a.apartment.lightMeshes.filter((m) => m.userData.effect === 'lamper').length")).toBe(0);
  await press(page, 'left', 'x-button');
  await menuPress(page, 'light:kveld');
  expect(await app(page, 'a.view.light.value')).toBe('kveld');
  expect(await app(page, 'a.lights.key.color.getHexString()')).not.toBe(dayKey);
  expect(await app(page, "a.apartment.lightMeshes.some((m) => m.userData.effect === 'lamper' && m.visible)")).toBe(true);
  // Valgt knapp er markert i menyen.
  expect(await app(page, "a.xr.menuItemsNow().find((i) => i.id === 'light:kveld').active")).toBe(true);
  await page.reload();
  await waitForModel(page);
  expect(await app(page, 'a.view.light.value')).toBe('kveld');
});

test('PC: «Lys»-valget og L-tasten, sol på «Standard», stråler bare på «Høy»', async ({ page }) => {
  await page.goto('./');
  await waitForModel(page);
  const vis = (kind: string) => app<boolean>(page, `a.apartment.lightMeshes.some((m) => m.userData.effect === '${kind}' && m.visible)`);
  expect(await vis('sol')).toBe(true);
  expect(await vis('stråler')).toBe(false);
  await page.getByTestId('setting-quality').selectOption({ label: 'Høy' });
  expect(await vis('stråler')).toBe(true);
  await page.getByTestId('setting-quality').selectOption({ label: 'Rask' });
  expect(await vis('sol')).toBe(false);
  // Rask: flate farger (ikke bakt lys).
  expect(await app(page, 'a.apartment.currentEffects.baked')).toBe(false);
  await page.getByTestId('setting-quality').selectOption({ label: 'Standard' });
  expect(await app(page, 'a.apartment.currentEffects.baked')).toBe(true);

  await page.getByTestId('setting-light').selectOption({ label: 'Kveld' });
  expect(await app(page, 'a.view.light.value')).toBe('kveld');
  // L: neste lys (kveld → natt → morgen).
  await page.locator('body').click({ position: { x: 1200, y: 400 } });
  await page.keyboard.press('l');
  expect(await app(page, 'a.view.light.value')).toBe('natt');
  await expect(page.getByTestId('setting-light')).toHaveValue('3');
  // Natt: stjerner, ingen sol, lampene lyser.
  expect(await app(page, "a.sky.getObjectByName('himmel:kuppel').material.uniforms.stars.value")).toBe(1);
  expect(await vis('sol')).toBe(false);
  expect(await vis('lamper')).toBe(true);
  await page.keyboard.press('l');
  expect(await app(page, 'a.view.light.value')).toBe('morgen');
  await expect(page.getByTestId('setting-light')).toHaveValue('0');
  expect(await app(page, "a.sky.getObjectByName('himmel:kuppel').material.uniforms.stars.value")).toBe(0);
  // 2D-planen: ingen sol eller himmel.
  await page.keyboard.press('2');
  expect(await vis('sol')).toBe(false);
  expect(await app(page, 'a.sky.visible')).toBe(false);
  await page.keyboard.press('h');
  await expect(page.getByTestId('help')).toContainText('Lys');
});

test('PC: 2D-planen har alltid dagslys – «Lys» gjelder bare 3D og VR', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await page.goto('./');
  await waitForModel(page);
  await page.getByTestId('mode-top').click();
  await renderedFrames(page);
  // Gulvet i gangen, stua og planterommet: samme farge i alle fire.
  const spots = [
    [1500, 0, 1400],
    [3200, 180, 1000],
    [6100, 0, 1500],
  ] as const;
  const points = await Promise.all(spots.map(([x, y, z]) => screenOf(page, x, y, z)));
  // Ett skjermbilde per «Lys» (alle tre punktene fra det).
  const colours = async (): Promise<number[][]> => {
    await renderedFrames(page);
    return pixelsAt(page, points);
  };
  const day = await colours();
  for (const l of ['morgen', 'kveld', 'natt'] as const) {
    await app(page, `a.view.light.set('${l}')`);
    const c = await colours();
    for (let i = 0; i < spots.length; i++) expect(colorDistance(c[i]!, day[i]!), `${l} ${spots[i]}`).toBeLessThan(3);
  }
  // Tilbake i 3D gjelder «Natt» igjen: gulvet i stua er mye mørkere enn om dagen.
  await page.getByTestId('mode-orbit').click();
  const stue = async (): Promise<number> => {
    await renderedFrames(page);
    const p = await screenOf(page, 3200, 180, 1000);
    const [c] = await pixelsAt(page, [p]);
    return c![0] + c![1] + c![2];
  };
  const night3d = await stue();
  await app(page, "a.view.light.set('dag')");
  expect(night3d).toBeLessThan((await stue()) - 60);
  expect(errors).toEqual([]);
});

test('VR-menyen: ingen tekst er forkortet på noen side', async ({ page }) => {
  await page.goto('./');
  await waitForModel(page);
  const cut = (setup: string): Promise<string[]> =>
    app(page, `(() => { ${setup}; const x = a.xr; x.menu.setState(x.menuState()); return x.menu.truncated; })()`);
  for (const tab of ['visning', 'effekter', 'lag', 'lagliste', 'tegn', 'ga', 'komfort', 'hjelp', 'farger'])
    expect(await cut(`a.xr.menuTab = '${tab}'`), tab).toEqual([]);
  // Lengste kurs i kursfilteret og for nye kabler, og «Egendefinert».
  const longest = "a.store.model.data.circuits.reduce((p, c) => (c.name.length > p.name.length ? c : p)).id";
  expect(await cut(`a.view.circuit.set(${longest}); a.xr.menuTab = 'lag'`)).toEqual([]);
  expect(await cut(`a.planCtrl.set({ circuit: ${longest} }); a.xr.menuTab = 'tegn'`)).toEqual([]);
  expect(await cut(`a.view.quality.set('custom'); a.xr.menuTab = 'effekter'`)).toEqual([]);
});

test('PC: «Egendefinert» – hver effekt for seg, settet huskes, og et forhåndsvalg tar over', async ({ page }) => {
  await page.goto('./');
  await waitForModel(page);
  const vis = (kind: string) => app<boolean>(page, `a.apartment.lightMeshes.some((m) => m.userData.effect === '${kind}' && m.visible)`);
  await page.getByTestId('effects').locator('summary').click();
  await expect(page.getByTestId('effect-shafts')).not.toBeChecked();
  await expect(page.getByTestId('effect-sun')).toBeChecked();
  // Lysstråler på «Standard»: blir «Egendefinert».
  await page.getByTestId('effect-shafts').check();
  expect(await vis('stråler')).toBe(true);
  await expect(page.getByTestId('setting-quality')).toHaveValue('3');
  await page.getByTestId('effect-detail').uncheck();
  expect(await app(page, 'a.apartment.currentEffects.detail')).toBe(false);
  await page.reload();
  await waitForModel(page);
  expect(await app(page, 'a.view.quality.value')).toBe('custom');
  expect(await vis('stråler')).toBe(true);
  expect(await app(page, 'a.apartment.currentEffects.detail')).toBe(false);
  // «Standard» igjen: alt som før, men settet er tatt vare på.
  await page.getByTestId('setting-quality').selectOption({ label: 'Standard' });
  expect(await vis('stråler')).toBe(false);
  expect(await app(page, 'a.apartment.currentEffects.detail')).toBe(true);
  await page.getByTestId('setting-quality').selectOption({ label: 'Egendefinert' });
  await expect(page.getByTestId('effects')).toHaveAttribute('open', '');
  expect(await vis('stråler')).toBe(true);
  // Skarpere bilde gir «Høy»-oppløsningen på laptopen; himmel av.
  await page.getByTestId('effect-sky').uncheck();
  expect(await app(page, 'a.sky.visible')).toBe(false);
  await page.getByTestId('setting-quality').selectOption({ label: 'Høy' });
  expect(await app(page, 'a.sky.visible')).toBe(true);
  await expect(page.getByTestId('effect-shafts')).toBeChecked();
  await expect(page.getByTestId('effect-sharp')).toBeChecked();
});

test('VR: «Egendefinert» i menyen – lysstråler uten skarpere bilde, og «Standard» igjen', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await enterVR(page);
  await press(page, 'left', 'x-button');
  await menuPress(page, 'quality:custom');
  const st = await xrState(page);
  expect(st.menu.tab).toBe('effekter');
  await menuPress(page, 'effect:shafts');
  expect(await app(page, 'a.view.quality.value')).toBe('custom');
  expect(await app(page, "a.apartment.lightMeshes.some((m) => m.userData.effect === 'stråler' && m.visible)")).toBe(true);
  // Ingen beskjed om oppløsning: «Skarpere bilde» er fortsatt av.
  expect(await app(page, 'a.xr.menuLabels().map((l) => l.text)')).not.toContain('Skarpere nå – full oppløsning neste gang i VR.');
  await settle(page);
  expect((await stats(page)).drawCallsPerEye).toBeLessThanOrEqual(40);
  await menuPress(page, 'tab:visning');
  expect(await app(page, "a.xr.menuItemsNow().find((i) => i.id === 'quality:custom').active")).toBe(true);
  await menuPress(page, 'quality:medium');
  expect(await app(page, "a.apartment.lightMeshes.some((m) => m.userData.effect === 'stråler' && m.visible)")).toBe(false);
  // Pekestrålen synes bare mens menyen er åpen.
  expect(await app(page, 'a.xr.slots.map((s) => s.line.visible).filter(Boolean).length')).toBe(1);
  await press(page, 'left', 'x-button');
  expect(await app(page, 'a.xr.slots.some((s) => s.line.visible)')).toBe(false);
  expect(errors).toEqual([]);
});

test('gjennomsyn (oppmåling): ingen himmel, sol, lamper eller overgang', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('./?emulator');
  await waitForModel(page);
  await app(page, "a.view.light.set('kveld')");
  await enterMeasure(page, false);
  expect(await app(page, 'a.sky.visible')).toBe(false);
  expect(await app(page, 'a.apartment.lightMeshes.some((m) => m.visible)')).toBe(false);
  expect(await app(page, 'a.apartment.shades.some((m) => m.visible)')).toBe(false);
  expect((await app(page, 'a.xr.debugState().fade')).visible).toBe(false);
  expect(await app(page, 'a.renderer.toneMappingExposure')).toBeCloseTo(await app(page, 'a.xr.exposure'), 6);
});
