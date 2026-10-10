import { expect, type Page } from '@playwright/test';

/** Venter til appen har lastet og validert apartment.json. */
export async function waitForModel(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).leilighet?.store?.model != null);
  await expect(page.getByTestId('overlay')).toBeHidden();
}

/** Samler konsollfeil og sidefeil. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

export const stats = (page: Page): Promise<Record<string, number>> =>
  page.evaluate(() => (window as any).leilighet.stats());

/** Skjermposisjon (CSS-px i lerretet) for et punkt i mm. */
export const screenOf = (page: Page, x: number, y: number, z: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([a, b, c]) => (window as any).leilighet.desktop.screenOf(a, b, c), [x, y, z] as const);

/** Leser en piksel fra et skjermbilde av siden (RGBA). */
export async function pixelAt(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const shot = await page.screenshot({ clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!] as [number, number, number];
  }, shot.toString('base64'));
}

export const colorDistance = (a: number[], b: number[]): number =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

/* ------------------------- Emulert Quest 3 (IWER) ------------------------- */

export interface XRState {
  presenting: boolean;
  rig: { x: number; y: number; z: number; yaw: number };
  head: { x: number; y: number; z: number };
  aiming: boolean;
  arcHit: { x: number; y: number; z: number; valid: boolean; id: string } | null;
  teleports: number;
  turns: number;
  floorUnderHead: number | null;
}

export const xrState = (page: Page): Promise<XRState> =>
  page.evaluate(() => (window as any).leilighet.xr.debugState());

export async function enterVR(page: Page): Promise<void> {
  await page.goto('./?emulator');
  await waitForModel(page);
  await expect(page.getByTestId('vr-button')).toHaveText('Gå inn i VR');
  await page.getByTestId('vr-button').click();
  await page.waitForFunction(() => (window as any).leilighet.xr.presenting === true);
  // Vent til riggen er plassert ved inngangsdøra (skjer etter noen rammer).
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const d = (window as any).__iwer;
    d.controllers.left.position.set(-0.2, 1.3, -0.3);
    d.controllers.right.position.set(0.2, 1.3, -0.3);
  });
  await frames(page, 4);
}

/** Venter noen rammer (IWER bruker verdiene fra neste ramme). */
export async function frames(page: Page, n = 3): Promise<void> {
  await page.waitForTimeout(60 * n);
}

export async function stick(page: Page, hand: 'left' | 'right', x: number, y: number): Promise<void> {
  await page.evaluate(([h, a, b]) => (window as any).__iwer.controllers[h].updateAxes('thumbstick', a, b), [hand, x, y] as const);
  await frames(page, 3);
}

export async function button(page: Page, hand: 'left' | 'right', id: string, value: number): Promise<void> {
  await page.evaluate(([h, b, v]) => (window as any).__iwer.controllers[h].updateButtonValue(b, v), [hand, id, value] as const);
  await frames(page, 3);
}

/**
 * Peker kontrolleren mot en retning i verden. `worldYaw` er retningen i
 * verden (rad, three-konvensjon: 0 = −z), `pitch` er helning (negativ = ned).
 */
export async function pointController(page: Page, hand: 'left' | 'right', worldX: number, worldZ: number, pitchDeg: number): Promise<void> {
  const s = await xrState(page);
  const worldYaw = Math.atan2(-worldX, -worldZ);
  const a = worldYaw - s.rig.yaw;
  const p = (pitchDeg * Math.PI) / 180;
  const cy = Math.cos(a / 2);
  const sy = Math.sin(a / 2);
  const cx = Math.cos(p / 2);
  const sx = Math.sin(p / 2);
  const q = [cy * sx, sy * cx, -sy * sx, cy * cx];
  await page.evaluate(([h, qq]) => (window as any).__iwer.controllers[h].quaternion.set(qq[0], qq[1], qq[2], qq[3]), [hand, q] as const);
  await frames(page, 3);
}

/** Sikter med venstre stikke og slipper. Returnerer tilstanden etter slipp. */
export async function teleport(page: Page, worldX: number, worldZ: number, pitchDeg: number): Promise<{ aim: XRState; after: XRState }> {
  await pointController(page, 'left', worldX, worldZ, pitchDeg);
  await stick(page, 'left', 0, -1);
  const aim = await xrState(page);
  await stick(page, 'left', 0, 0);
  return { aim, after: await xrState(page) };
}
