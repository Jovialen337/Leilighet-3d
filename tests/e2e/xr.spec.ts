/**
 * VR-sjekker med emulert Meta Quest 3 (Meta Immersive Web Emulation Runtime,
 * samme motor som Immersive Web Emulator-utvidelsen).
 */
import { expect } from '@playwright/test';
import { button, collectErrors, enterVR, frames, menuPress, press, stats, stick, teleport, test, waitForModel, xrState } from './helpers';

test('går inn i VR og starter stående innenfor inngangsdøra', async ({ page }) => {
  const errors = collectErrors(page);
  await enterVR(page);
  const s = await xrState(page);
  expect(s.presenting).toBe(true);
  // Inngangsdøra er x 200–1100 mm i veggen z = 0; startpunktet er inne i gangen.
  expect(s.head.x).toBeGreaterThan(0.2);
  expect(s.head.x).toBeLessThan(1.1);
  expect(s.head.z).toBeGreaterThan(0.3);
  expect(s.head.z).toBeLessThan(1.2);
  expect(s.rig.y).toBeCloseTo(0, 6);
  expect(s.floorUnderHead).toBe(0);
  // Blikket mot lengste utsikt: gjennom åpningene mot stua og kjøkkenet (+x), ikke rett i gangveggen (+z).
  const forward = { x: -Math.sin(s.rig.yaw), z: -Math.cos(s.rig.yaw) };
  expect(forward.x).toBeGreaterThan(0.9);
  expect(forward.z).toBeGreaterThan(0);
  await expect(page.getByTestId('vr-button')).toHaveText('Avslutt VR');
  expect(errors).toEqual([]);
});

test('teleport opp trinnet til stua og ned igjen til gangen', async ({ page }) => {
  await enterVR(page);
  // Sikt mot +x (stua), litt nedover, gjennom åpningen gang–stue.
  const up = await teleport(page, 1, 0, -15);
  expect(up.aim.aiming).toBe(true);
  expect(up.aim.arcHit?.valid).toBe(true);
  expect(up.aim.arcHit?.id).toBe('stue');
  expect(up.after.teleports).toBe(1);
  expect(up.after.rig.y).toBeCloseTo(0.18, 3);
  expect(up.after.head.x).toBeGreaterThan(2.4);
  expect(up.after.floorUnderHead).toBe(180);

  // Tilbake mot −x (gangen).
  const down = await teleport(page, -1, 0, -15);
  expect(down.aim.arcHit?.id).toBe('gang');
  expect(down.after.teleports).toBe(2);
  expect(down.after.rig.y).toBeCloseTo(0, 3);
  expect(down.after.head.x).toBeLessThan(2.3);
});

test('ugyldig mål (vegg) teleporterer ikke', async ({ page }) => {
  await enterVR(page);
  // Rett mot veggen gang/planterom til venstre for døra.
  await page.evaluate(() => (window as any).__iwer.controllers.left.position.set(0.3, 1.3, 0));
  const r = await teleport(page, 0, 1, 5);
  expect(r.aim.arcHit?.valid).toBe(false);
  expect(r.after.teleports).toBe(0);
});

test('snu 30° med høyre stikke, rundt hodet', async ({ page }) => {
  await enterVR(page);
  const s0 = await xrState(page);
  await stick(page, 'right', 1, 0);
  await stick(page, 'right', 0, 0);
  const s1 = await xrState(page);
  expect(s1.turns).toBe(1);
  expect(s1.rig.yaw - s0.rig.yaw).toBeCloseTo(-Math.PI / 6, 6);
  expect(Math.hypot(s1.head.x - s0.head.x, s1.head.z - s0.head.z)).toBeLessThan(0.01);
  // Holder man stikken ute, snur man bare én gang.
  await stick(page, 'right', -1, 0);
  await frames(page, 10);
  await stick(page, 'right', 0, 0);
  const s2 = await xrState(page);
  expect(s2.turns).toBe(2);
  expect(s2.rig.yaw).toBeCloseTo(s0.rig.yaw, 6);
});

test('håndleddet: hjelp til kontrollene er lært, så bare rommet du står i; én mesh per kontroller', async ({ page }) => {
  test.setTimeout(90_000);
  await enterVR(page);
  const wrist = () =>
    page.evaluate(() => {
      const w = (window as any).leilighet.xr.wrist;
      return { lines: w.lines as string[], title: w.title as string | null };
    });
  // Hver kontroller er én mesh (ett tegnekall).
  const meshes = await page.evaluate(() =>
    (window as any).leilighet.xr.slots.map((s: any) => s.grip.children.filter((c: any) => c.isMesh && c.name === 'kontroller').length),
  );
  expect(meshes).toEqual([1, 1]);
  expect((await wrist()).lines).toContain('Venstre stikke: teleport');
  expect((await xrState(page)).wrist).toEqual({ learned: false, place: 'Gang' });
  // Teleport til stua og snu: da viser håndleddet bare rommet og arealet.
  await teleport(page, 1, 0, -15);
  expect((await xrState(page)).wrist.learned).toBe(false);
  await stick(page, 'right', 1, 0);
  await stick(page, 'right', 0, 0);
  expect((await xrState(page)).wrist).toEqual({ learned: true, place: 'Stue' });
  const w = await wrist();
  expect(w.title).toBe('Stue');
  expect(w.lines).toEqual([expect.stringMatching(/^\d+(,\d)? m² · X: meny$/)]);
  // «Gå til rom» viser det nye rommet.
  await page.evaluate(() => (window as any).leilighet.xr.goToRoom('kjokken'));
  await expect.poll(async () => (await wrist()).title, { timeout: 5_000 }).toBe('Kjøkken');
  // «Vis alltid hjelp på håndleddet» (Komfort): hjelpen kommer tilbake, og valget huskes.
  await press(page, 'left', 'x-button');
  await menuPress(page, 'tab:komfort');
  await menuPress(page, 'toggle:wristhelp');
  expect(await page.evaluate(() => (window as any).leilighet.xr.menuItemsNow().find((i: any) => i.id === 'toggle:wristhelp').active)).toBe(true);
  expect((await wrist()).lines).toContain('Venstre stikke: teleport');
  await page.reload();
  await waitForModel(page);
  expect(await page.evaluate(() => (window as any).leilighet.view.wristHelp.value)).toBe(true);
});

test('går man fysisk opp trinnet, følger gulvhøyden etter', async ({ page }) => {
  // 25 skritt med flere bilder hver: tar 40–50 s på en travel maskin.
  test.setTimeout(90_000);
  await enterVR(page);
  // Gå mot +x i leiligheten (mot stua): retningen i det fysiske rommet følger riggens vinkel.
  const yaw = (await xrState(page)).rig.yaw;
  for (let i = 1; i <= 25; i++) {
    const d = i * 0.1;
    await page.evaluate(([x, z]) => (window as any).__iwer.position.set(x, 1.6, z), [d * Math.cos(yaw), d * Math.sin(yaw)] as const);
    await frames(page, 1);
  }
  await frames(page, 10);
  const s = await xrState(page);
  expect(s.head.x).toBeGreaterThan(2.5);
  expect(s.floorUnderHead).toBe(180);
  expect(s.rig.y).toBeCloseTo(0.18, 3);
  // Hodet er 1,6 m over det nye gulvet.
  expect(s.head.y).toBeCloseTo(1.78, 2);
});

test('Y-knappen viser bildefrekvens i VR, og tegnekallene er få', async ({ page }) => {
  await enterVR(page);
  expect(await page.evaluate(() => (window as any).leilighet.view.fps.value)).toBe(false);
  await button(page, 'left', 'y-button', 1);
  await button(page, 'left', 'y-button', 0);
  expect(await page.evaluate(() => (window as any).leilighet.view.fps.value)).toBe(true);
  const s = await stats(page);
  // Budsjettet på Quest 3: maks 40 tegnekall per øye.
  expect(s.drawCallsPerEye).toBeLessThanOrEqual(40);
  expect(s.drawCalls).toBe(s.drawCallsPerEye! * 2);
});

test('avslutt VR går tilbake til laptopvisning', async ({ page }) => {
  await enterVR(page);
  await page.evaluate(() => (window as any).leilighet.xr.exit());
  await page.waitForFunction(() => (window as any).leilighet.xr.presenting === false);
  await expect(page.getByTestId('vr-button')).toHaveText('Gå inn i VR');
});
