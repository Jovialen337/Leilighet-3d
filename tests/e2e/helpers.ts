import { test as base, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Fast kopi av plassholder-leiligheten (testene skal ikke avhenge av den publiserte fila). */
export const placeholder = (): any =>
  JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/placeholder.json', import.meta.url)), 'utf8'));

/**
 * Som Playwrights `test`, men appen får plassholder-leiligheten i stedet for
 * public/apartment.json. En test kan selv legge en ny rute oppå (nyeste vinner).
 */
export const test = base.extend<{ placeholderRoute: void }>({
  placeholderRoute: [
    async ({ page }, use) => {
      const doc = placeholder();
      await page.route('**/apartment.json', (route) => route.fulfill({ json: doc }));
      await use();
    },
    { auto: true },
  ],
});

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

/** Venter til nettleseren har tegnet `n` nye rammer (appens tegnesløyfe går på requestAnimationFrame). */
export async function renderedFrames(page: Page, n = 3): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const tick = (): void => {
          if (--left <= 0) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    n,
  );
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
  menu: { open: boolean; tab: string; hovered: string | null };
  draw: { tool: string | null; points: number; hover: { x: number; h: number; z: number } | null };
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

/* ------------------------- Oppmåling (gjennomsyn) ------------------------- */

export interface MeasureDebug {
  phase: 'align-0' | 'align-1' | 'measure';
  method: 'touch' | 'point';
  task: string | null;
  title: string;
  status: { text: string; tone: string } | null;
  captures: number;
  tip: { x: number; y: number; z: number };
  rig: { x: number; y: number; z: number; yaw: number };
  hitTest: string;
  beacon: boolean;
  overlayTriangles: number;
  panel: { header: string; title: string; body: string; badge?: string } | null;
}

export const measureState = (page: Page): Promise<MeasureDebug> =>
  page.evaluate(() => (window as any).leilighet.xr.measureDebug());

/** Starter oppmåling (AR) i emulert Quest 3. */
export async function enterMeasure(page: Page, goto = true): Promise<void> {
  if (goto) {
    await page.goto('./?emulator');
    await waitForModel(page);
  }
  await expect(page.getByTestId('measure-button')).toBeEnabled();
  await page.getByTestId('measure-button').click();
  await page.waitForFunction(() => (window as any).leilighet.xr.presenting === true);
  await frames(page, 4);
  // Avstanden fra kontrolleren til måletuppen, målt med kontrolleren rett fram.
  await page.evaluate(() => {
    const c = (window as any).__iwer.controllers.right;
    c.quaternion.set(0, 0, 0, 1);
    c.position.set(0, 1, 0);
  });
  await frames(page, 3);
  const tip = (await measureState(page)).tip;
  await page.evaluate((o) => ((window as any).__tipOffset = o), { x: tip.x, y: tip.y - 1, z: tip.z });
}

/** Flytter høyre kontroller så måletuppen står i et punkt i referanserommet (m). */
export async function placeTipLocal(page: Page, x: number, y: number, z: number): Promise<void> {
  await page.evaluate(
    ([px, py, pz]) => {
      const o = (window as any).__tipOffset;
      (window as any).__iwer.controllers.right.position.set(px - o.x, py - o.y, pz - o.z);
    },
    [x, y, z] as const,
  );
  await frames(page, 3);
}

/** Flytter måletuppen til et punkt i verden, dvs. modellens koordinater (m) etter justering. */
export async function placeTip(page: Page, x: number, y: number, z: number): Promise<void> {
  const local = await page.evaluate(
    ([px, py, pz]) => {
      const rig = (window as any).leilighet.xr.rig;
      const v = rig.position.clone().set(px, py, pz);
      rig.worldToLocal(v);
      return { x: v.x, y: v.y, z: v.z };
    },
    [x, y, z] as const,
  );
  await placeTipLocal(page, local.x, local.y, local.z);
}

/** Trykker og slipper en knapp. */
export async function press(page: Page, hand: 'left' | 'right', id: string): Promise<void> {
  await button(page, hand, id, 1);
  await button(page, hand, id, 0);
}

/**
 * Justerer: hjørnet ved døra står i (0.5, 0.02, −1.0) i referanserommet og
 * inngangsveggen går 30° på skrå – modellen må altså både flyttes og vris.
 */
export async function align(page: Page): Promise<void> {
  const a = Math.PI / 6;
  await placeTipLocal(page, 0.5, 0.02, -1.0);
  await press(page, 'right', 'trigger');
  await placeTipLocal(page, 0.5 + 2 * Math.cos(a), 1.1, -1.0 - 2 * Math.sin(a));
  await press(page, 'right', 'trigger');
}

/** Måler oppgaven som står for tur, (dx, dy, dz) mm fra der modellen tror den er. */
export async function measureCurrent(page: Page, dx = 0, dy = 0, dz = 0): Promise<void> {
  const t = await page.evaluate(() => (window as any).leilighet.measure.current().target);
  await placeTip(page, (t.x + dx) / 1000, (t.y + dy) / 1000, (t.z + dz) / 1000);
  await press(page, 'right', 'trigger');
}

/** Retter en kontroller mot et punkt i verden (m). */
export async function aimAt(page: Page, hand: 'left' | 'right', w: { x: number; y: number; z: number }): Promise<void> {
  await page.evaluate(
    ([h, p]) => {
      const xr = (window as any).leilighet.xr;
      const c = (window as any).__iwer.controllers[h];
      const t = xr.rig.position.clone().set(p.x, p.y, p.z);
      xr.rig.worldToLocal(t);
      const dx = t.x - c.position.x;
      const dy = t.y - c.position.y;
      const dz = t.z - c.position.z;
      const l = Math.hypot(dx, dy, dz);
      const bx = dx / l;
      const by = dy / l;
      const bz = dz / l;
      // Rotasjon fra (0, 0, −1) til b.
      const n = Math.hypot(by, bx, 1 - bz);
      c.quaternion.set(by / n, -bx / n, 0, (1 - bz) / n);
    },
    [hand, w] as const,
  );
  await frames(page, 3);
}

/** Åpner VR-menyen (X) og trykker på en knapp i den med høyre kontroller. */
export async function menuPress(page: Page, id: string): Promise<void> {
  const p = await page.evaluate((i) => (window as any).leilighet.xr.menuItemWorld(i), id);
  if (!p) throw new Error(`fant ikke menyknappen ${id}`);
  await aimAt(page, 'right', p);
  await press(page, 'right', 'trigger');
}
