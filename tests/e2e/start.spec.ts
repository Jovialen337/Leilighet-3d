import { expect, type Page } from '@playwright/test';
import { collectErrors, enterVR, frames, menuPress, press, stick, teleport, test, waitForModel } from './helpers';

const app = (page: Page, expr: string): Promise<any> => page.evaluate(`(() => { const a = window.leilighet; return ${expr}; })()`);
const wrist = (page: Page): Promise<{ lines: string[]; title: string | null }> =>
  app(page, '({ lines: a.xr.wrist.lines, title: a.xr.wrist.title })');

test.describe('startmenyen', () => {
  test.use({ startMenu: true });

  test('er det første man ser, med neste steg; «Se leiligheten» viser appen', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./');
    await waitForModel(page);
    const menu = page.getByTestId('start-menu');
    await expect(menu).toBeVisible();
    // Panelet skjules bak menyen.
    await expect(page.getByTestId('panel')).toBeHidden();
    await expect(page.getByTestId('start-summary')).toContainText('rom');
    await expect(page.getByTestId('start-next')).toContainText('plassholdere');
    // Første gang: velkommen, med vei til opplæringen.
    await expect(page.getByTestId('start-welcome-learn')).toBeVisible();
    for (const id of ['start-new', 'start-load', 'start-settings', 'start-learn']) await expect(page.getByTestId(id)).toBeVisible();
    await page.getByTestId('start-continue').click();
    await expect(menu).toBeHidden();
    await expect(page.getByTestId('panel')).toBeVisible();
    // Velkommen vises bare første gang.
    await page.getByTestId('open-start').click();
    await expect(menu).toBeVisible();
    await expect(page.getByTestId('start-welcome-learn')).toHaveCount(0);
    // Esc: fra en underside tilbake til hovedsiden, så lukkes menyen.
    await page.getByTestId('start-settings').click();
    await expect(page.getByTestId('start-quality')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('start-settings')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('innstillingene virker med en gang og huskes; menyen kan slås av', async ({ page }) => {
    await page.goto('./');
    await waitForModel(page);
    await page.getByTestId('start-settings').click();
    await page.getByTestId('start-light').getByRole('button', { name: 'Kveld' }).click();
    await page.getByTestId('start-quality').getByRole('button', { name: 'Høy' }).click();
    await page.getByTestId('start-turn').getByRole('button', { name: 'Myk' }).click();
    expect(await app(page, '[a.view.light.value, a.view.quality.value, a.view.turn.value]')).toEqual(['kveld', 'high', 'smooth']);
    await expect(page.getByTestId('start-light').getByRole('button', { name: 'Kveld' })).toHaveAttribute('aria-pressed', 'true');
    // Av: neste gang åpner appen rett i modellen.
    await page.getByTestId('start-show-2').uncheck();
    await page.reload();
    await waitForModel(page);
    await expect(page.getByTestId('start-menu')).toBeHidden();
    expect(await app(page, '[a.view.light.value, a.view.quality.value]')).toEqual(['kveld', 'high']);
    // ?start viser den likevel, og «Tilbakestill» slår den på igjen.
    await page.goto('./?start');
    await waitForModel(page);
    await expect(page.getByTestId('start-menu')).toBeVisible();
    await page.getByTestId('start-settings').click();
    await page.getByTestId('start-reset').click();
    expect(await app(page, '[a.view.light.value, a.view.quality.value, a.view.startMenu.value]')).toEqual(['dag', 'medium', true]);
  });

  test('«Last inn» og «Ny modell» fører videre', async ({ page }) => {
    await page.goto('./');
    await waitForModel(page);
    await page.getByTestId('start-load').click();
    await expect(page.getByTestId('start-load-model')).toContainText('rom');
    await page.getByTestId('start-load-model').click();
    await expect(page.getByTestId('start-menu')).toBeHidden();
    await page.getByTestId('open-start').click();
    await page.getByTestId('start-new').click();
    await page.getByTestId('start-new-current').click();
    await expect(page.getByTestId('start-menu')).toBeHidden();
    await expect.poll(() => app(page, 'a.builder.open.value')).toBe(true);
  });
});

test('«Farger» forklarer fargene som er i bruk; «Vis alle» viser resten', async ({ page }) => {
  await page.goto('./');
  await waitForModel(page);
  const dialog = page.getByTestId('legend-dialog');
  await page.getByTestId('open-legend').click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('section[data-group="el"]')).toContainText('Stiplet: planlagt kabel');
  await expect(dialog.locator('section[data-group="vann"]')).toContainText('Kaldtvann');
  await expect(dialog.locator('section[data-group="oppmalt"]')).toHaveCount(0);
  await page.getByTestId('legend-all').check();
  await expect(dialog.locator('section')).toHaveCount(6);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // Med «Marker umålte mål» på kommer forklaringen av oransje / gult / grønt.
  await page.getByTestId('toggle-measure').check();
  await page.getByTestId('open-legend').click();
  await expect(dialog.locator('section[data-group="oppmalt"]')).toContainText('Oransje: plassholder');
  await page.getByTestId('legend-close').click();
  await expect(dialog).toBeHidden();
});

test.describe('opplæringen', () => {
  test.use({ startMenu: true });

  test('på PC-en: hvert steg venter på at man gjør det, og ferdig huskes', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./');
    await waitForModel(page);
    await page.getByTestId('start-welcome-learn').click();
    await expect(page.getByTestId('start-legend')).toContainText('Kaldtvann');
    await page.getByTestId('start-tutorial-pc').click();
    const card = page.getByTestId('tutorial');
    const title = page.getByTestId('tutorial-title');
    await expect(card).toContainText('1 av 6');
    await expect(title).toHaveText('Se deg rundt');
    // Dra i modellen.
    const box = (await page.getByTestId('viewport').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, { steps: 5 });
    await page.mouse.up();
    await expect(title).toHaveText('Gå til et rom');
    await expect(page.getByTestId('rooms')).toHaveClass(/tutorial-target/);
    await page.getByTestId('room-stue').click();
    await expect(title).toHaveText('Ovenfra (2D)');
    await expect(page.getByTestId('rooms')).not.toHaveClass(/tutorial-target/);
    await page.getByTestId('mode-top').click();
    await expect(title).toHaveText('Hva er målt?');
    await page.getByTestId('toggle-measure').check();
    await expect(title).toHaveText('Hva fargene betyr');
    await page.getByTestId('open-legend').click();
    await expect(title).toHaveText('Neste steg');
    await page.getByTestId('legend-close').click();
    await expect(page.getByTestId('open-start')).toHaveClass(/tutorial-target/);
    await page.getByTestId('tutorial-next').click();
    await expect(card).toBeHidden();
    // Startmenyen viser at den er gjort.
    await page.getByTestId('open-start').click();
    await page.getByTestId('start-learn').click();
    await expect(page.getByTestId('start-tutorial-pc')).toHaveText('Kom i gang på PC-en ✓');
    expect(errors).toEqual([]);
  });

  test('«Hopp over» og «Avslutt»', async ({ page }) => {
    await page.goto('./');
    await waitForModel(page);
    await page.getByTestId('start-learn').click();
    await page.getByTestId('start-tutorial-pc').click();
    await page.getByTestId('tutorial-skip').click();
    await expect(page.getByTestId('tutorial-title')).toHaveText('Gå til et rom');
    await page.getByTestId('tutorial-stop').click();
    await expect(page.getByTestId('tutorial')).toBeHidden();
    expect(await app(page, "a.tutorial.completed('pc')")).toBe(false);
  });
});

test('i VR: «Hjelp» viser neste steg og fargene, og opplæringen går på håndleddet', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectErrors(page);
  await enterVR(page);
  await press(page, 'left', 'x-button');
  await menuPress(page, 'tab:hjelp');
  const labels = (): Promise<string[]> => app(page, 'a.xr.menuLabels().map((l) => l.text)');
  expect((await labels()).join(' ')).toContain('plassholdere');
  await menuPress(page, 'tab:farger');
  expect(await labels()).toEqual(expect.arrayContaining(['Kaldtvann', 'Grønn bue: du kan lande der']));
  await menuPress(page, 'tab:hjelp');

  // Opplæringen: menyen lukkes, og første steg står på håndleddet.
  await menuPress(page, 'tutorial:start');
  expect(await app(page, 'a.xr.menu.open')).toBe(false);
  expect((await wrist(page)).title).toBe('Teleporter · 1/6');
  await teleport(page, 1, 0, -15);
  await expect.poll(async () => (await wrist(page)).title).toBe('Snu deg · 2/6');
  await stick(page, 'right', 1, 0);
  await stick(page, 'right', 0, 0);
  await expect.poll(async () => (await wrist(page)).title).toBe('Menyen · 3/6');
  await press(page, 'left', 'x-button');
  await expect.poll(async () => (await wrist(page)).title).toBe('Gå til et rom · 4/6');
  // Håndleddet synes også mens menyen er åpen; ringen peker på «Gå til», så på rommene.
  expect(await app(page, 'a.xr.wrist.mesh.visible')).toBe(true);
  const hinted = (): Promise<string[]> => app(page, 'a.xr.menuItemsNow().filter((i) => i.hint).map((i) => i.id)');
  expect(await hinted()).toEqual(['tab:ga']);
  await menuPress(page, 'tab:ga');
  expect(await hinted()).toContain('room:kjokken');
  await menuPress(page, 'room:kjokken');
  await expect.poll(async () => (await wrist(page)).title).toBe('Hva fargene betyr · 5/6');
  await press(page, 'left', 'x-button');
  await menuPress(page, 'tab:hjelp');
  expect(await hinted()).toEqual(['tab:farger']);
  await menuPress(page, 'tab:farger');
  await expect.poll(async () => (await wrist(page)).title).toBe('Ferdig! · 6/6');
  await press(page, 'left', 'x-button');
  await expect.poll(() => app(page, 'a.tutorial.active')).toBe(false);
  expect(await app(page, "a.tutorial.completed('vr')")).toBe(true);
  await frames(page, 3);
  expect((await wrist(page)).title).not.toMatch(/\d\/6/);
  expect(errors).toEqual([]);
});
