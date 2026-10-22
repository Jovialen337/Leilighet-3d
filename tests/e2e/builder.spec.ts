/**
 * «Lag ny modell»: tegn på PC (mus og tastatur), med knapper uten tastatur
 * (Quest-nettleseren), og mål opp i gjennomsyn med emulert Quest 3.
 */
import { expect, type Page } from '@playwright/test';
import { validateApartment } from '../../src/schema/validate';
import {
  buildMenu,
  buildState,
  builderDoc,
  collectErrors,
  enterBuild,
  frames,
  menuPress,
  openBuilder,
  placeholder,
  press,
  screenOf,
  test,
  touch,
  waitForModel,
} from './helpers';

/** Klikker i 2D-planen på et punkt (mm). */
async function clickPlan(page: Page, x: number, z: number): Promise<void> {
  const p = await screenOf(page, x, 0, z);
  await page.mouse.move(p.x - 3, p.y - 3);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
}

/** Drar fra ett punkt til et annet i planen (mm). */
async function dragPlan(page: Page, from: { x: number; z: number }, to: { x: number; z: number }): Promise<void> {
  const a = await screenOf(page, from.x, 0, from.z);
  const b = await screenOf(page, to.x, 0, to.z);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 6, a.y + ((b.y - a.y) * i) / 6);
  await page.mouse.up();
}

const near = (a: number, b: number, tol = 25): boolean => Math.abs(a - b) <= tol;

/** Laster ned apartment.json fra byggeren og returnerer innholdet. */
async function downloadExport(page: Page): Promise<{ text: string; doc: any }> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('builder-download').click()]);
  expect(download.suggestedFilename()).toBe('apartment.json');
  const text = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'));
  return { text, doc: JSON.parse(text) };
}

test('tegn med mus: rektangel, rom inntil, dør og vindu – sjekk og last ned', async ({ page }) => {
  const errors = collectErrors(page);
  await openBuilder(page);
  await expect(page.getByTestId('builder-start')).toBeVisible();
  await page.getByTestId('builder-new').click();
  await expect(page.getByTestId('builder-work')).toBeVisible();
  // En ny tegning starter med rektangelverktøyet, i 2D.
  await expect(page.getByTestId('builder-tool-rect')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (window as any).leilighet.view.cameraMode.value)).toBe('top');
  await expect(page.getByTestId('builder-overlay')).toBeVisible();
  // Verktøylinja ligger over planen; uten rom er sjekken et «kom i gang», ikke en feil.
  await expect(page.getByTestId('builder-toolbar')).toBeVisible();
  await expect(page.getByTestId('builder-status')).toHaveText('Tegn første rom for å komme i gang');
  await expect(page.getByTestId('builder-status')).toHaveClass(/todo/);
  await expect(page.getByTestId('builder-save-blocked')).toBeHidden();

  await clickPlan(page, 0, 0);
  await clickPlan(page, 4000, 3000);
  let doc = await builderDoc(page);
  expect(doc.rooms).toHaveLength(1);
  const gang = doc.rooms[0];
  expect(gang.name).toBe('Gang');
  const xs = gang.polygon.map((p: any) => p.x);
  const zs = gang.polygon.map((p: any) => p.z);
  expect(near(Math.max(...xs) - Math.min(...xs), 4000)).toBe(true);
  expect(near(Math.max(...zs) - Math.min(...zs), 3000)).toBe(true);

  // Rom inntil høyre kant: skillevegg på 100 mm, like dypt som kanten er lang.
  await page.keyboard.press('i');
  await clickPlan(page, Math.max(...xs), 1500);
  doc = await builderDoc(page);
  expect(doc.rooms).toHaveLength(2);
  expect(doc.rooms[1].name).toBe('Stue');
  expect(Math.min(...doc.rooms[1].polygon.map((p: any) => p.x))).toBe(Math.max(...xs) + 100);

  // Dør i ytterveggen til venstre (blir inngangsdør), dør inn til stua og vindu i stua.
  await page.keyboard.press('d');
  await clickPlan(page, Math.min(...xs), 1500);
  // Uten dør inn til stua sier sjekken fra.
  await expect(page.getByTestId('builder-issues')).toContainText('kommer ikke inn i «Stue»');
  await clickPlan(page, Math.max(...xs), 1500);
  await page.keyboard.press('v');
  await clickPlan(page, Math.max(...xs) + 1600, Math.max(...zs));
  doc = await builderDoc(page);
  expect(doc.openings.map((o: any) => o.type)).toEqual(['door', 'door', 'window']);
  expect(doc.openings[0].entrance).toBe(true);
  expect(doc.openings[1].entrance).toBeUndefined();
  // Det som nettopp ble satt inn, kan justeres i panelet med en gang.
  await expect(page.getByTestId('builder-op-width')).toBeVisible();

  await expect(page.getByTestId('builder-summary')).toContainText('2 rom');
  await expect(page.getByTestId('builder-issues')).toContainText('Modellen er gyldig');
  await expect(page.getByTestId('builder-status')).toHaveText('Klar til å lagres');
  // «Vis hele» legger tegningen under verktøylinja.
  await page.getByTestId('builder-fit').click();
  const barBottom = await page.getByTestId('builder-toolbar').locator('.tb-bar').evaluate((e) => e.getBoundingClientRect().bottom);
  expect(await page.evaluate(() => (window as any).leilighet.desktop.screenOf(0, 0, 0).y)).toBeGreaterThan(barBottom);
  // Forhåndsvisningen er den nye modellen (2 rom), ikke fila.
  expect(await page.evaluate(() => (window as any).leilighet.store.model.rooms.size)).toBe(2);

  const { doc: file } = await downloadExport(page);
  expect(validateApartment(file).ok).toBe(true);
  expect(file.rooms).toHaveLength(2);
  expect(file.walls.length).toBeGreaterThanOrEqual(5);
  // Døra mellom rommene går inn i stua (rommet på den andre siden av skilleveggen).
  expect(file.openings.find((o: any) => o.type === 'door' && !o.entrance)?.into).toBe('stue');
  // Origo i hjørnet ved inngangsdøra, gangens gulv = 0.
  const entrance = file.openings.find((o: any) => o.entrance);
  expect(entrance?.type).toBe('door');
  const hall = file.rooms.find((r: any) => r.id === 'gang');
  expect(hall.polygon.some(([x, z]: [number, number]) => x === 0 && z === 0)).toBe(true);
  expect(hall.floorLevel).toBe(0);
  await expect(page.getByTestId('builder-upload')).toHaveAttribute('href', 'https://github.com/Jovialen337/Leilighet-3d/upload/main/public');
  expect(errors).toEqual([]);
});

test('skriv mål med tastaturet: rektangel, angre og gjør om', async ({ page }) => {
  await openBuilder(page);
  await page.getByTestId('builder-new').click();
  // Tall går rett i breddefeltet, Tab til dybden, Enter lager rommet.
  await page.keyboard.type('4,2');
  await expect(page.getByTestId('builder-rect-w')).toBeFocused();
  await expect(page.getByTestId('builder-rect-w')).toHaveValue('4,2');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('builder-rect-d')).toBeFocused();
  await page.keyboard.type('3');
  await page.keyboard.press('Enter');
  let doc = await builderDoc(page);
  expect(doc.rooms).toHaveLength(1);
  const xs = doc.rooms[0].polygon.map((p: any) => p.x);
  const zs = doc.rooms[0].polygon.map((p: any) => p.z);
  expect(Math.max(...xs) - Math.min(...xs)).toBe(4200);
  expect(Math.max(...zs) - Math.min(...zs)).toBe(3000);

  await page.keyboard.press('Escape'); // ut av feltet
  await page.keyboard.press('Control+z');
  expect((await builderDoc(page)).rooms).toHaveLength(0);
  await page.keyboard.press('Control+y');
  expect((await builderDoc(page)).rooms).toHaveLength(1);

  // Endre en kant ved å skrive en ny lengde (relativt med +).
  await page.keyboard.press('s');
  await clickPlan(page, (Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2);
  await expect(page.getByTestId('builder-room-name')).toHaveValue('Gang');
  const first = page.getByTestId('builder-edge-len-0');
  await first.fill('+300');
  await first.press('Enter');
  doc = await builderDoc(page);
  const lens = doc.rooms[0].polygon.map((p: any, i: number, a: any[]) => Math.hypot(a[(i + 1) % a.length].x - p.x, a[(i + 1) % a.length].z - p.z));
  expect(Math.round(lens[0])).toBe(4500);
  // Fokus blir i feltet etter Enter, så man kan fortsette å justere.
  await expect(page.getByTestId('builder-edge-len-0')).toBeFocused();
});

test('mangekant med skrevne lengder og pilknapper (L-formet rom)', async ({ page }) => {
  await openBuilder(page);
  await page.getByTestId('builder-new').click();
  await page.keyboard.press('m');
  await clickPlan(page, 0, 0);
  const seg = async (len: string, dir: 'right' | 'down' | 'left' | 'up'): Promise<void> => {
    await page.keyboard.type(len);
    await expect(page.getByTestId('builder-seg-len')).toBeFocused();
    await page.getByTestId(`builder-seg-${dir}`).click();
  };
  await seg('5', 'right');
  await seg('2', 'down');
  await seg('3', 'left');
  await seg('2', 'down');
  await seg('2', 'left');
  await page.getByTestId('builder-poly-finish').click();
  const doc = await builderDoc(page);
  expect(doc.rooms).toHaveLength(1);
  const p0 = doc.rooms[0].polygon[0];
  const rel = doc.rooms[0].polygon.map((p: any) => [p.x - p0.x, p.z - p0.z]);
  expect(rel).toEqual([
    [0, 0],
    [5000, 0],
    [5000, 2000],
    [2000, 2000],
    [2000, 4000],
    [0, 4000],
  ]);
  await expect(page.getByTestId('builder-message')).toContainText('Rom lagt til');
});

test('dra et hjørne og en kant – hvert drag er ett angresteg', async ({ page }) => {
  await openBuilder(page);
  await page.getByTestId('builder-new').click();
  await page.getByTestId('builder-rect-w').fill('4000');
  await page.getByTestId('builder-rect-d').fill('3000');
  await page.getByTestId('builder-rect-make').click();
  await page.keyboard.press('s');
  const before = (await builderDoc(page)).rooms[0];
  const id = before.id;
  // Velg rommet, dra hjørne 2 (motsatt hjørne) 500 mm til høyre.
  await clickPlan(page, before.polygon[0].x + 2000, before.polygon[0].z + 1500);
  const c = before.polygon[2];
  await expect(page.getByTestId(`bo-corner-${id}-2`)).toBeVisible();
  await dragPlan(page, c, { x: c.x + 500, z: c.z });
  let room = (await builderDoc(page)).rooms[0];
  expect(near(room.polygon[2].x, c.x + 500, 15)).toBe(true);
  await page.getByTestId('builder-undo').click();
  room = (await builderDoc(page)).rooms[0];
  expect(room.polygon).toEqual(before.polygon);

  // Dra kant 0 (øverst) 300 mm opp: begge hjørnene følger.
  await clickPlan(page, before.polygon[0].x + 2000, before.polygon[0].z + 1500);
  const mid = { x: (before.polygon[0].x + before.polygon[1].x) / 2, z: before.polygon[0].z };
  await expect(page.getByTestId(`bo-edge-${id}-0`)).toBeVisible();
  await dragPlan(page, mid, { x: mid.x, z: mid.z - 300 });
  room = (await builderDoc(page)).rooms[0];
  expect(near(room.polygon[0].z, before.polygon[0].z - 300, 15)).toBe(true);
  expect(room.polygon[0].z).toBe(room.polygon[1].z);
  // Piltastene flytter det valgte (her kanten, valgt av draget) 10 mm, Shift 100 mm.
  expect(await page.evaluate(() => (window as any).leilighet.builder.editor.selection.value)).toEqual({ kind: 'edge', room: id, edge: 0 });
  const z0 = room.polygon[0].z;
  await page.keyboard.press('Shift+ArrowUp');
  room = (await builderDoc(page)).rooms[0];
  expect(room.polygon[0].z).toBe(z0 - 100);
});

test('start fra nåværende modell tar med alt, og «Lukk» viser fila igjen', async ({ page }) => {
  const errors = collectErrors(page);
  await openBuilder(page);
  await page.getByTestId('builder-from-current').click();
  const fixture = placeholder();
  const doc = await builderDoc(page);
  expect(doc.rooms.map((r: any) => r.id).sort()).toEqual(fixture.rooms.map((r: any) => r.id).sort());
  await expect(page.getByTestId('builder-issues')).not.toContainText('✗');
  // Veggene beholder id-ene (installasjoner og tegninger peker på dem).
  const { doc: file } = await downloadExport(page);
  expect(validateApartment(file).ok).toBe(true);
  const fixtureWalls = new Set(fixture.walls.map((w: any) => w.id));
  const kept = file.walls.filter((w: any) => fixtureWalls.has(w.id)).length;
  expect(kept).toBeGreaterThanOrEqual(Math.min(fixture.walls.length, file.walls.length) - 2);
  expect(file.fixtures.length).toBe(fixture.fixtures.length);
  expect(file.furniture.length).toBe(fixture.furniture.length);

  await page.getByTestId('builder-close').click();
  await expect(page.getByTestId('builder')).toBeHidden();
  await expect(page.getByTestId('builder-toolbar')).toBeHidden();
  await expect(page.getByTestId('builder-entry')).toHaveText('Fortsett på ny modell …');
  expect(await page.evaluate(() => (window as any).leilighet.store.doc.meta.name)).toBe(fixture.meta.name);
  expect(errors).toEqual([]);
});

test('tegningen huskes etter omlasting, og fila kan lagres og åpnes som tegning', async ({ page }) => {
  await openBuilder(page);
  await page.getByTestId('builder-new').click();
  await page.getByTestId('builder-rect-make').click();
  await page.getByTestId('builder-name').fill('Hytta');
  await page.getByTestId('builder-name').press('Enter');
  await page.reload();
  await waitForModel(page);
  await expect(page.getByTestId('builder-work')).toBeVisible();
  const doc = await builderDoc(page);
  expect(doc.name).toBe('Hytta');
  expect(doc.rooms).toHaveLength(1);
  expect(await page.evaluate(() => (window as any).leilighet.store.model.rooms.size)).toBe(1);

  // Lagre tegningen som fil, forkast, og åpne den igjen.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('builder-save-draft').click()]);
  expect(download.suggestedFilename()).toBe('hytta.tegning.json');
  const path = await download.path();
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('builder-discard').click();
  await expect(page.getByTestId('builder-start')).toBeVisible();
  await page.getByTestId('builder-open-file').setInputFiles(path!);
  await expect(page.getByTestId('builder-work')).toBeVisible();
  expect((await builderDoc(page)).name).toBe('Hytta');
  // Feil fil gir en forklaring.
  await page.getByTestId('builder-open-file').setInputFiles({ name: 'feil.json', mimeType: 'application/json', buffer: Buffer.from('{"x":1}') });
  await expect(page.getByTestId('builder-message')).toContainText('ikke en tegning');
});

test('når den eksporterte fila er publisert, ryddes tegningen bort', async ({ page }) => {
  await openBuilder(page);
  await page.getByTestId('builder-new').click();
  await page.getByTestId('builder-rect-make').click();
  await page.keyboard.press('d');
  const room = (await builderDoc(page)).rooms[0];
  await clickPlan(page, room.polygon[0].x, room.polygon[0].z + 1500);
  const { text } = await downloadExport(page);
  await page.route('**/apartment.json', (route) => route.fulfill({ body: text, contentType: 'application/json' }));
  await page.reload();
  await waitForModel(page);
  await expect(page.getByTestId('builder-notice')).toContainText('lagt ut');
  expect(await builderDoc(page)).toBeNull();
  expect(await page.evaluate(() => (window as any).leilighet.store.doc.meta.description)).toContain('Lag ny modell');
});

test('feil i tegningen vises med «Vis», og lagring er sperret til de er rettet', async ({ page }) => {
  await openBuilder(page);
  await page.getByTestId('builder-new').click();
  await page.getByTestId('builder-rect-make').click();
  // Et rom til oppå det første.
  await page.getByTestId('builder-rect-make').click();
  await expect(page.getByTestId('builder-issues')).toContainText('overlapper');
  await expect(page.getByTestId('builder-download')).toBeDisabled();
  const doc = await builderDoc(page);
  await page.getByTestId(`builder-issue-show-${doc.rooms[1].id}`).click();
  expect(await page.evaluate(() => (window as any).leilighet.builder.editor.selection.value)).toEqual({ kind: 'room', room: doc.rooms[1].id });
  await page.getByTestId('builder-room-delete').click();
  await expect(page.getByTestId('builder-issues')).not.toContainText('overlapper');
});

test('apartment.json med feil: «Lag ny modell i stedet»', async ({ page }) => {
  await page.route('**/apartment.json', (route) => route.fulfill({ body: '{ ødelagt', contentType: 'application/json' }));
  await page.goto('./');
  await expect(page.getByTestId('errors')).toBeVisible();
  await page.getByTestId('errors-builder').click();
  await expect(page.getByTestId('builder-start')).toBeVisible();
  await expect(page.getByTestId('errors')).toBeHidden();
  await page.getByTestId('builder-new').click();
  await page.getByTestId('builder-rect-make').click();
  await expect(page.getByTestId('builder-issues')).toContainText('inngangsdør');
  expect(await page.evaluate(() => (window as any).leilighet.store.model.rooms.size)).toBe(1);
});

test('bakgrunnsbilde: velg, sett målestokk med to klikk, flytt, og det huskes', async ({ page }) => {
  await openBuilder(page);
  await page.getByTestId('builder-new').click();
  await page.getByTestId('builder-backdrop').locator('summary').click();
  // Et lite testbilde (400 × 300 px) laget i nettleseren.
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 400, 300);
    g.strokeStyle = '#000';
    g.strokeRect(20, 20, 360, 260);
    return c.toDataURL('image/png').split(',')[1]!;
  });
  await page.getByTestId('builder-backdrop-file').setInputFiles({ name: 'skisse.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
  await expect(page.getByTestId('builder-backdrop-image')).toBeVisible();
  await expect(page.getByTestId('builder-backdrop-calibrate')).toHaveAttribute('aria-pressed', 'true');
  const state = () => page.evaluate(() => (window as any).leilighet.builder.backdrop.state);
  expect((await state()).w).toBe(400);
  expect((await state()).w * (await state()).mmPerPx).toBeCloseTo(10_000, 0);

  // Målestokk: to punkter 2 m fra hverandre i bildet er egentlig 4 m → bildet blir dobbelt så stort.
  await clickPlan(page, 1000, 1000);
  await clickPlan(page, 3000, 1000);
  await expect(page.getByTestId('bo-mark-1')).toBeVisible();
  await page.getByTestId('builder-backdrop-real').fill('4 m');
  await page.getByTestId('builder-backdrop-apply').click();
  const scaled = await state();
  expect(scaled.w * scaled.mmPerPx).toBeGreaterThan(19_500);
  expect(scaled.w * scaled.mmPerPx).toBeLessThan(20_500);
  // Ingen rom ble tegnet av klikkene.
  expect((await builderDoc(page)).rooms).toHaveLength(0);

  // Flytt bildet 1 m mot høyre.
  await page.getByTestId('builder-backdrop-move').click();
  const x0 = scaled.x;
  await dragPlan(page, { x: 0, z: 0 }, { x: 1000, z: 0 });
  await page.getByTestId('builder-backdrop-move').click();
  expect(Math.abs((await state()).x - (x0 + 1000))).toBeLessThan(30);

  // Huskes etter omlasting.
  await page.reload();
  await waitForModel(page);
  await expect(page.getByTestId('builder-backdrop-image')).toBeVisible();
  expect(Math.round((await state()).mmPerPx * 1000)).toBe(Math.round(scaled.mmPerPx * 1000));
  await page.getByTestId('builder-backdrop').locator('summary').click();
  await page.getByTestId('builder-backdrop-remove').click();
  await expect(page.getByTestId('builder-backdrop-image')).toBeHidden();
  expect(await state()).toBeNull();
});

test.describe('Quest-nettleseren (laserpeker, uten tastatur)', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/35.0 SamsungBrowser/4.0 Chrome/126.0 VR Safari/537.36',
  });

  test('alt kan gjøres med knapper og store håndtak', async ({ page }) => {
    await openBuilder(page);
    await page.getByTestId('builder-new').click();
    await page.getByTestId('builder-rect-w').fill('3,5 m');
    await page.getByTestId('builder-rect-d').fill('280 cm');
    await page.getByTestId('builder-rect-make').click();
    let doc = await builderDoc(page);
    const id = doc.rooms[0].id;
    // Store håndtak for laserpekeren (rommet som ble laget, er valgt).
    await page.getByTestId('builder-tool-select').click();
    await expect(page.getByTestId(`bo-corner-${id}-0`).locator('circle')).toHaveAttribute('r', '16');
    // Kant 4 (venstre) → «Dør her».
    await page.getByTestId('builder-room-edge-3').click();
    await page.getByTestId('builder-edge-door').click();
    doc = await builderDoc(page);
    expect(doc.openings).toHaveLength(1);
    await page.getByTestId('builder-op-width').fill('1,0');
    await page.getByTestId('builder-op-width').press('Enter');
    expect((await builderDoc(page)).openings[0].width).toBe(1000);
    // Fra venstre hjørne, sett fra rommet.
    await page.getByTestId('builder-op-left').fill('200');
    await page.getByTestId('builder-op-left').press('Enter');
    // Venstre kant går nedenfra og opp; sett fra rommet er venstre hjørne det nederste (kantens start).
    expect((await builderDoc(page)).openings[0].offset).toBe(200);
    await expect(page.getByTestId('builder-issues')).toContainText('Modellen er gyldig');
  });

  test('store håndtak og mål ligger aldri oppå hverandre', async ({ page }) => {
    await openBuilder(page);
    await page.getByTestId('builder-from-current').click();
    await page.getByTestId('builder-tool-select').click();
    const doc = await builderDoc(page);
    for (const id of [null, ...doc.rooms.map((r: any) => r.id)]) {
      await page.evaluate((rid) => (window as any).leilighet.builder.editor.select(rid ? { kind: 'room', room: rid } : null), id);
      await frames(page, 3);
      const o = await overlayOverlaps(page);
      expect({ id, dimDim: o.dimDim, dimRoom: o.dimRoom, dimHandle: o.dimHandle, handleHandle: o.handleHandle }).toEqual({ id, dimDim: 0, dimRoom: 0, dimHandle: 0, handleHandle: 0 });
    }
  });
});

test('rom: kopier, skillevegg, roter, flytt med tall, negative koordinater og «Rett opp rommene»', async ({ page }) => {
  const errors = collectErrors(page);
  await openBuilder(page);
  await page.getByTestId('builder-new').click();
  await page.getByTestId('builder-rect-w').fill('3000');
  await page.getByTestId('builder-rect-d').fill('2000');
  await page.getByTestId('builder-rect-make').click();
  // Navnefeltene har samme stil som målefeltene (ikke nettleserens standard).
  for (const id of ['builder-name', 'builder-room-name']) await expect(page.getByTestId(id)).toHaveCSS('border-radius', '6px');
  let doc = await builderDoc(page);
  const a = doc.rooms[0];
  const ax = (r: any) => r.polygon.map((p: any) => p.x);
  const az = (r: any) => r.polygon.map((p: any) => p.z);
  const right = Math.max(...ax(a));
  const top = Math.min(...az(a));

  // Kopier: kopien legges inntil, med standard skillevegg (100 mm), og blir valgt.
  await page.getByTestId('builder-room-copy').click();
  doc = await builderDoc(page);
  expect(doc.rooms).toHaveLength(2);
  let b = doc.rooms[1];
  expect(Math.min(...ax(b))).toBe(right + 100);
  await expect(page.getByTestId('builder-message')).toContainText('Kopi: «Gang 2»');

  // Skilleveggens tykkelse på kopiens kant mot originalen: naborommet (originalen) flyttes.
  await page.getByTestId('builder-tool-select').click();
  await page.getByTestId(`bo-move-${b.id}`).click();
  await page.getByTestId('builder-room-edge-3').click();
  await expect(page.getByTestId('builder-message')).toContainText('Valgt: kant 4 i «Gang 2»');
  await page.getByTestId('builder-edge-partition').fill('150');
  await page.getByTestId('builder-edge-partition').press('Enter');
  doc = await builderDoc(page);
  expect(doc.rooms[1].polygon).toEqual(b.polygon);
  const aRight = Math.max(...ax(doc.rooms[0]));
  expect(aRight).toBe(right - 50);

  // Roter 90°: 2 × 3 m i stedet for 3 × 2 m.
  await page.getByTestId(`bo-move-${b.id}`).click();
  await page.getByTestId('builder-room-rotate').click();
  b = (await builderDoc(page)).rooms[1];
  expect(Math.max(...ax(b)) - Math.min(...ax(b))).toBe(2000);
  expect(Math.max(...az(b)) - Math.min(...az(b))).toBe(3000);
  // Angre og gjør om: meldingen sier hva som skjedde (ikke «dreid» etter at det er angret).
  await page.getByTestId('builder-undo').click();
  await expect(page.getByTestId('builder-message')).toHaveText('Angret.');
  await page.getByTestId('builder-redo').click();
  await expect(page.getByTestId('builder-message')).toHaveText('Gjort om.');
  expect((await builderDoc(page)).rooms[1].polygon).toEqual(b.polygon);

  // Flytt med tall (negative tall flytter mot venstre/opp): inntil A igjen, 100 mm luke.
  const dx = aRight + 100 - Math.min(...ax(b));
  await page.getByTestId('builder-move-x').fill(String(dx));
  await page.getByTestId('builder-move-x').press('Enter');
  await expect(page.getByTestId('builder-move-z')).toBeFocused();
  await page.getByTestId('builder-move-z').fill('0');
  await page.getByTestId('builder-move-z').press('Enter');
  b = (await builderDoc(page)).rooms[1];
  expect(Math.min(...ax(b))).toBe(aRight + 100);
  expect(dx).toBeLessThan(0);

  // Negative koordinater og gulvnivå skrives som de er; «+=» legger til.
  await clickPlan(page, (Math.min(...ax(a)) + aRight) / 2, top + 1000);
  await expect(page.getByTestId('builder-room-name')).toHaveValue('Gang');
  await page.getByTestId('builder-room-floor').fill('-150');
  await page.getByTestId('builder-room-floor').press('Enter');
  expect((await builderDoc(page)).rooms[0].floor).toBe(-150);
  await page.getByTestId(`bo-corner-${a.id}-0`).click();
  await page.getByTestId('builder-corner-x').fill('-1100');
  await page.getByTestId('builder-corner-x').press('Enter');
  expect((await builderDoc(page)).rooms[0].polygon[0].x).toBe(-1100);
  await page.getByTestId('builder-corner-x').fill(`+${a.polygon[0].x + 1100}`);
  await page.getByTestId('builder-corner-x').press('Enter');
  expect((await builderDoc(page)).rooms[0].polygon[0].x).toBe(a.polygon[0].x);

  // Et skjevt rom (hjørnet 60 mm ut): varsel med «Rett opp rommene», som retter det.
  b = (await builderDoc(page)).rooms[1];
  const tl = b.polygon.findIndex((p: any) => p.x === Math.min(...ax(b)) && p.z === Math.min(...az(b)));
  await clickPlan(page, (Math.min(...ax(b)) + Math.max(...ax(b))) / 2, (Math.min(...az(b)) + Math.max(...az(b))) / 2 + 400);
  await expect(page.getByTestId('builder-room-name')).toHaveValue('Gang 2');
  await page.getByTestId(`bo-corner-${b.id}-${tl}`).click();
  await page.getByTestId('builder-corner-x').fill(String(aRight + 160));
  await page.getByTestId('builder-corner-x').press('Enter');
  await expect(page.getByTestId('builder-issues')).toContainText('er ikke parallelle (1,1°)');
  await page.getByTestId('builder-fix-straighten').first().click();
  await expect(page.getByTestId('builder-issues')).not.toContainText('parallelle');
  b = (await builderDoc(page)).rooms[1];
  expect(new Set(b.polygon.map((p: any) => p.x)).size).toBe(2);
  expect(top).toBe(Math.min(...az((await builderDoc(page)).rooms[0])));
  expect(errors).toEqual([]);
});

test('«Del rommet» lager to rom med skillevegg midt i, og modellen er gyldig', async ({ page }) => {
  await openBuilder(page);
  await page.getByTestId('builder-new').click();
  await page.getByTestId('builder-rect-w').fill('5000');
  await page.getByTestId('builder-rect-d').fill('3000');
  await page.getByTestId('builder-rect-make').click();
  await page.getByTestId('builder-room-edge-3').click();
  await page.getByTestId('builder-edge-door').click();
  const room = (await builderDoc(page)).rooms[0];
  const xs = room.polygon.map((p: any) => p.x);
  await page.evaluate((id) => (window as any).leilighet.builder.editor.select({ kind: 'room', room: id }), room.id);
  await page.getByText('Del rommet').click();
  // Forslaget: loddrett midt i (rommet er bredere enn dypt).
  await expect(page.getByTestId('builder-split-axis')).toHaveValue('x');
  await expect(page.getByTestId('builder-split-at')).toHaveValue(String((Math.min(...xs) + Math.max(...xs)) / 2));
  await page.getByTestId('builder-split-go').click();
  const doc = await builderDoc(page);
  expect(doc.rooms).toHaveLength(2);
  await expect(page.getByTestId('builder-message')).toContainText('med 100 mm skillevegg');
  await expect(page.getByTestId('builder-summary')).toContainText('2 rom');
  // Rommet bak skillet har ingen dør ennå: varsel om at man ikke kommer inn, ingen feil.
  await expect(page.getByTestId('builder-issues')).toContainText('kommer ikke inn');
  await expect(page.getByTestId('builder-issues')).not.toContainText('✗');
});

test('«Del rommet» på en importert modell gir aldri en ugyldig fil (dører inn i rommet følger med)', async ({ page }) => {
  await openBuilder(page);
  await page.getByTestId('builder-from-current').click();
  await page.getByTestId('builder-tool-select').click();
  const doc = await builderDoc(page);
  let splits = 0;
  for (const room of doc.rooms) {
    await page.evaluate((id) => (window as any).leilighet.builder.editor.select({ kind: 'room', room: id }), room.id);
    await page.getByText('Del rommet').click();
    await page.getByTestId('builder-split-go').click();
    const after = await builderDoc(page);
    if (after.rooms.length === doc.rooms.length) {
      // Avvist: meldingen sier hvorfor (en åpning i veien, eller for lite plass).
      await expect(page.getByTestId('builder-message')).toContainText(/går gjennom|minst 0,25 m²|formet som en U/);
      continue;
    }
    splits++;
    await expect(page.getByTestId('builder-message')).toContainText('Delt i');
    await expect(page.getByTestId('builder-issues')).not.toContainText('✗');
    await expect(page.getByTestId('builder-issues')).not.toContainText('ikke ligger ved veggen');
    await page.getByTestId('builder-undo').click();
    expect((await builderDoc(page)).rooms).toHaveLength(doc.rooms.length);
  }
  expect(splits).toBeGreaterThan(0);
});

test('åpning: dra enden for å gjøre den bredere – håndtakene ligger aldri oppå hverandre', async ({ page }) => {
  await openBuilder(page);
  await page.getByTestId('builder-new').click();
  await page.getByTestId('builder-rect-w').fill('4000');
  await page.getByTestId('builder-rect-d').fill('3000');
  await page.getByTestId('builder-rect-make').click();
  await page.getByTestId('builder-room-edge-0').click();
  await page.getByTestId('builder-edge-window').click();
  await page.getByTestId('builder-tool-select').click();
  const o = (await builderDoc(page)).openings[0];
  await page.evaluate((id) => (window as any).leilighet.builder.editor.select({ kind: 'opening', id }), o.id);
  // Overlegget tegnes på nytt mens visningen glir på plass: vent til håndtakene står stille.
  const measure = async () => {
    const out = [];
    for (const k of ['move', 'start', 'end']) out.push(await page.getByTestId(`bo-opening-${k}-${o.id}`).boundingBox());
    return out;
  };
  let boxes: any[] = [];
  await expect
    .poll(async () => {
      const prev = boxes;
      boxes = await measure();
      return boxes.every((b) => b) && JSON.stringify(prev) === JSON.stringify(boxes);
    })
    .toBe(true);
  const overlap = (a: any, b: any) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlap(boxes[0], boxes[1]) || overlap(boxes[0], boxes[2]) || overlap(boxes[1], boxes[2])).toBe(false);
  // Dra høyre ende 300 mm mot høyre (kant 0 går mot +x): bredden øker, venstre ende står.
  const p0 = await screenOf(page, 0, 0, 0);
  const p1 = await screenOf(page, 1000, 0, 0);
  const pxPerMm = (p1.x - p0.x) / 1000;
  const e = boxes[2];
  const from = { x: e.x + e.width / 2, y: e.y + e.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(from.x + (300 * pxPerMm * i) / 6, from.y);
  await page.mouse.up();
  const after = (await builderDoc(page)).openings[0];
  expect(after.offset).toBe(o.offset);
  expect(Math.abs(after.width - (o.width + 300))).toBeLessThanOrEqual(20);
});

/** Teller overlapp i planen: mål mot mål, mål mot romnavn, mål mot håndtak, og håndtak mot håndtak. */
async function overlayOverlaps(page: Page): Promise<{ dims: number; dimDim: number; dimRoom: number; dimHandle: number; handleHandle: number }> {
  return page.evaluate(() => {
    const box = (el: Element) => {
      const b = el.getBoundingClientRect();
      return { x0: b.left, y0: b.top, x1: b.right, y1: b.bottom };
    };
    type B = ReturnType<typeof box>;
    const ov = (a: B, b: B) => a.x0 < b.x1 - 0.5 && b.x0 < a.x1 - 0.5 && a.y0 < b.y1 - 0.5 && b.y0 < a.y1 - 0.5;
    const dims = [...document.querySelectorAll('.builder-overlay text.bo-dim')].map(box);
    const rooms = [...document.querySelectorAll<HTMLElement>('.labels .label.room')].filter((e) => e.style.display !== 'none').map(box);
    const shapes = [...document.querySelectorAll('.builder-overlay .bo-handle')].map((g) => box(g.querySelector('circle,rect')!));
    const circ = shapes.map((b) => ({ x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, r: (b.x1 - b.x0) / 2 }));
    let dimDim = 0;
    let dimRoom = 0;
    let dimHandle = 0;
    let handleHandle = 0;
    dims.forEach((d, i) => {
      for (let j = i + 1; j < dims.length; j++) if (ov(d, dims[j]!)) dimDim++;
      for (const r of rooms) if (ov(d, r)) dimRoom++;
      for (const h of shapes) if (ov(d, h)) dimHandle++;
    });
    circ.forEach((a, i) => {
      for (let j = i + 1; j < circ.length; j++) if (Math.hypot(a.x - circ[j]!.x, a.y - circ[j]!.y) < a.r + circ[j]!.r - 0.5) handleHandle++;
    });
    return { dims: dims.length, dimDim, dimRoom, dimHandle, handleHandle };
  });
}

test('målene i planen dekker aldri hverandre, romnavnene eller håndtakene – uansett hvilket rom som er valgt', async ({ page }) => {
  await openBuilder(page);
  await page.getByTestId('builder-from-current').click();
  await page.getByTestId('builder-tool-select').click();
  const doc = await builderDoc(page);
  for (const id of [null, ...doc.rooms.map((r: any) => r.id)]) {
    await page.evaluate((rid) => (window as any).leilighet.builder.editor.select(rid ? { kind: 'room', room: rid } : null), id);
    await frames(page, 3);
    const o = await overlayOverlaps(page);
    expect({ id, ...o, dims: o.dims > 0 }).toEqual({ id, dims: true, dimDim: 0, dimRoom: 0, dimHandle: 0, handleHandle: 0 });
  }
});

test('notater og installasjonsetiketter skjules mens man lager ny modell', async ({ page }) => {
  await page.goto('./');
  await waitForModel(page);
  await page.getByTestId('mode-top').click();
  const notes = page.locator('.labels .label.note');
  await expect(notes.first()).toBeVisible();
  await openBuilder(page, null);
  await expect(notes.first()).toBeHidden();
  // Romnavnene vises fortsatt.
  await expect(page.locator('.labels .label.room').first()).toBeVisible();
  await page.getByTestId('builder-close').click();
  await expect(notes.first()).toBeVisible();
});

/* ------------------- Oppmåling i gjennomsyn (emulert Quest 3) ------------------- */

/** Et rom på 4 × 3 m: veggene ved z = −1 og −4, x = −1 og 3 (referanserommet, m). */
async function captureRoom(page: Page): Promise<void> {
  await touch(page, 0.5, 1, -1);
  await touch(page, 2.5, 1, -1);
  await touch(page, 3, 1, -2);
  await touch(page, 1.5, 1, -4);
  await touch(page, -1, 1, -2.5);
  await press(page, 'right', 'a-button');
  await touch(page, 1, 0.004, -2);
  await touch(page, 1, 2.45, -2);
}

test('mål opp et rom i gjennomsyn: vegger, gulv, tak, dør og navn', async ({ page }) => {
  // Lange scenarier i emulert Quest 3: tar 40–60 s på en treg maskin.
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openBuilder(page, './?emulator');
  await enterBuild(page);
  let s = await buildState(page);
  expect(s.phase).toBe('walls');
  expect(s.panel?.title).toBe('Rom 1: første vegg');
  expect(await page.evaluate(() => (window as any).leilighet.apartment.root.visible)).toBe(false);

  await touch(page, 0.5, 1, -1);
  s = await buildState(page);
  expect(s.walls).toEqual([1]);
  expect(s.panel?.title).toBe('Første vegg: ett punkt til');
  await touch(page, 2.5, 1, -1);
  await touch(page, 3, 1, -2);
  // Spøkelseshjørnet viser hvor neste hjørne havner.
  await page.evaluate(() => (window as any).__iwer.controllers.right.position.set(1.5, 1, -3.5));
  await frames(page, 3);
  expect((await buildState(page)).ghost).not.toBeNull();
  await touch(page, 1.5, 1, -4);
  await touch(page, -1, 1, -2.5);
  s = await buildState(page);
  expect(s.walls).toEqual([2, 1, 1, 1]);
  expect(s.corners).toBe(3);
  await press(page, 'right', 'a-button');
  s = await buildState(page);
  expect(s.phase).toBe('floor');
  expect(s.status?.text).toContain('12,0 m²');
  await touch(page, 1, 0.004, -2);
  expect((await buildState(page)).phase).toBe('ceiling');
  await touch(page, 1, 2.45, -2);
  s = await buildState(page);
  expect(s.phase).toBe('ready');
  expect(s.status?.text).toContain('«Gang» er lagt til');
  let doc = await builderDoc(page);
  expect(doc.rooms[0].polygon).toEqual([
    { x: -1000, z: -1000, m: true },
    { x: 3000, z: -1000, m: true },
    { x: 3000, z: -4000, m: true },
    { x: -1000, z: -4000, m: true },
  ]);
  expect(doc.rooms[0].floor).toBe(4);
  expect(doc.rooms[0].ceiling).toBe(2446);

  // Menyen: døra (karm, karm, overkant) – blir inngangsdør.
  await buildMenu(page, 'b:door');
  s = await buildState(page);
  expect(s.phase).toBe('opening');
  expect(s.menu.open).toBe(false);
  expect(s.panel?.title).toBe('Dør: 1 av 3');
  await touch(page, 0.2, 1, -1.01);
  await touch(page, 1.1, 1, -1.01);
  await touch(page, 0.65, 2.004, -1.01);
  s = await buildState(page);
  expect(s.phase).toBe('ready');
  expect(s.status?.text).toContain('inngangsdør');
  doc = await builderDoc(page);
  // Første berøring var hengselsiden: til venstre for den som går inn (mot −z).
  expect(doc.openings[0]).toMatchObject({ type: 'door', room: 'gang', edge: 0, offset: 1200, width: 900, height: 2000, entrance: true, measured: true, hinge: 'left' });

  // Navn fra menyen; avtrekkeren måler ikke mens menyen er åpen.
  await buildMenu(page, 'b:name:Entré');
  expect((await builderDoc(page)).rooms[0].name).toBe('Entré');
  expect((await buildState(page)).captures).toBe(s.captures);
  await press(page, 'left', 'x-button');

  await page.evaluate(() => (window as any).leilighet.xr.exit());
  await page.waitForFunction(() => (window as any).leilighet.xr.presenting === false);
  // Tilbake på siden: rommet og døra er i tegningen, og modellen er gyldig.
  await expect(page.getByTestId('builder-summary')).toContainText('1 rom');
  await expect(page.getByTestId('builder-issues')).toContainText('Modellen er gyldig');
  expect(await page.evaluate(() => (window as any).leilighet.apartment.root.visible)).toBe(true);
  expect(errors).toEqual([]);
});

test('gjennomsyn: 1 cm feil på første vegg gir likevel riktig skillevegg og dybde (tegningens akse)', async ({ page }) => {
  // Lange scenarier i emulert Quest 3: tar 40–60 s på en treg maskin.
  test.setTimeout(90_000);
  const errors = collectErrors(page);
  await openBuilder(page, './?emulator');
  await page.getByTestId('builder-new').click();
  await enterBuild(page, 'builder-capture-more');
  await captureRoom(page);
  expect((await buildState(page)).phase).toBe('ready');
  // Nytt rom østenfor: egentlig x 3,1–6 m, z −1 til −4 m (100 mm skillevegg, 3 m dypt).
  // Første vegg berøres 60 cm fra hverandre, det andre punktet 1 cm ut fra veggen (≈ 1°).
  await press(page, 'right', 'a-button');
  const room2 = async (): Promise<void> => {
    for (const [x, z] of [
      [3.5, -1],
      [4.1, -1.01],
      [6, -2],
      [4.5, -4],
      [3.1, -2.5],
    ] as const)
      await touch(page, x, 1, z);
  };
  await room2();
  // Under 1 m mellom punktene, men tegningen har en akse å låne: ingen advarsel om retningen.
  await press(page, 'right', 'a-button');
  let s = await buildState(page);
  expect(s.phase).toBe('floor');
  expect(s.status?.text).toContain('Rettet inn 1,0° etter de andre rommene');
  // B + A: behold rommet slik det ble målt.
  await press(page, 'right', 'b-button');
  s = await buildState(page);
  expect(s.phase).toBe('walls');
  expect(s.status?.text).toContain('slik det ble målt');
  await press(page, 'right', 'a-button');
  expect((await buildState(page)).status?.text).toContain('Beholdt slik det ble målt');
  // Ombestemt: B + A igjen retter det inn.
  await press(page, 'right', 'b-button');
  expect((await buildState(page)).status?.text).toContain('retter det inn');
  await press(page, 'right', 'a-button');
  expect((await buildState(page)).status?.text).toContain('Rettet inn 1,0°');
  await touch(page, 4.5, 0.004, -2.5);
  await touch(page, 4.5, 2.45, -2.5);
  const doc = await builderDoc(page);
  const xs = doc.rooms[1].polygon.map((p: any) => p.x);
  const zs = doc.rooms[1].polygon.map((p: any) => p.z);
  // Skilleveggen 100 ± 5 mm, dybden 3000 ± 5 mm, østveggen der den er.
  expect(Math.abs(Math.min(...xs) - 3000 - 100)).toBeLessThanOrEqual(5);
  expect(Math.abs(Math.max(...zs) - Math.min(...zs) - 3000)).toBeLessThanOrEqual(5);
  expect(Math.abs(Math.max(...xs) - 6000)).toBeLessThanOrEqual(5);
  await page.evaluate(() => (window as any).leilighet.xr.exit());
  await page.waitForFunction(() => (window as any).leilighet.xr.presenting === false);
  await expect(page.getByTestId('builder-summary')).toContainText('2 rom');
  await expect(page.getByTestId('builder-issues')).not.toContainText('parallelle');
  await expect(page.getByTestId('builder-issues')).not.toContainText('skjevt');
  expect(errors).toEqual([]);
});

test('gjennomsyn: første rom med kort avstand på første vegg får en advarsel om retningen', async ({ page }) => {
  await openBuilder(page, './?emulator');
  await page.getByTestId('builder-new').click();
  await enterBuild(page, 'builder-capture-more');
  await touch(page, 0.5, 1, -1);
  await touch(page, 1.1, 1, -1);
  let s = await buildState(page);
  expect(s.status?.text).toContain('bare 60 cm fra hverandre');
  // Angre og berør lenger bort: ingen advarsel.
  await press(page, 'right', 'b-button');
  await touch(page, 2.5, 1, -1);
  s = await buildState(page);
  expect(s.status?.text).toContain('Første vegg er målt. Gå videre');
});

test('gjennomsyn: angre, samme vegg, skrå vegg og hopp over gulv og tak', async ({ page }) => {
  // Lange scenarier i emulert Quest 3: tar 40–60 s på en treg maskin.
  test.setTimeout(90_000);
  await openBuilder(page, './?emulator');
  await page.getByTestId('builder-new').click();
  await enterBuild(page, 'builder-capture-more');
  await touch(page, 0, 1, -1);
  // For nær første punkt.
  await touch(page, 0.1, 1, -1);
  let s = await buildState(page);
  expect(s.status?.tone).toBe('error');
  expect(s.walls).toEqual([1]);
  await touch(page, 2, 1, -1);
  // Skrå vegg: fra (3, −1) til (2.5, −4), berørt to steder (grep + avtrekker på den andre).
  await touch(page, 2.9, 1, -1.6);
  await touch(page, 2.6, 1, -3.4, true);
  s = await buildState(page);
  expect(s.walls).toEqual([2, 2]);
  // Samme vegg igjen uten grep avvises.
  await touch(page, 2.75, 1, -2.5);
  expect((await buildState(page)).status?.text).toContain('samme vegg');
  await touch(page, 1, 1, -4);
  await touch(page, -1, 1, -2);
  // B angrer siste berøring.
  await press(page, 'right', 'b-button');
  expect((await buildState(page)).walls).toEqual([2, 2, 1]);
  await touch(page, -1, 1, -2);
  await press(page, 'right', 'a-button');
  // Hopp over gulv og tak (A): standardverdiene brukes.
  await press(page, 'right', 'a-button');
  await press(page, 'right', 'a-button');
  s = await buildState(page);
  expect(s.phase).toBe('ready');
  const room = (await builderDoc(page)).rooms[0];
  expect(room.ceiling).toBe(2400);
  expect(room.floorMeasured).toBeUndefined();
  // Den skrå veggen gir hjørnene (3000, −1000) og (2500, −4000).
  const xs = room.polygon.map((p: any) => `${p.x},${p.z}`);
  expect(xs).toContain('3000,-1000');
  expect(xs).toContain('2500,-4000');
});

test('gjennomsyn igjen: tegningen justeres ved inngangsdøra, og et rom kan måles på nytt', async ({ page }) => {
  // Lange scenarier i emulert Quest 3: tar 40–60 s på en treg maskin.
  test.setTimeout(90_000);
  await openBuilder(page, './?emulator');
  await enterBuild(page);
  await captureRoom(page);
  await buildMenu(page, 'b:door');
  await touch(page, 0.2, 1, -1.01);
  await touch(page, 1.1, 1, -1.01);
  await touch(page, 0.65, 2.004, -1.01);
  await page.evaluate(() => (window as any).leilighet.xr.exit());
  await page.waitForFunction(() => (window as any).leilighet.xr.presenting === false);

  await enterBuild(page, 'builder-capture-more');
  let s = await buildState(page);
  expect(s.phase).toBe('align-0');
  expect(s.panel?.body).toContain('inngangsdøra');
  // Ny økt der referanserommet er flyttet og dreid 90° (uten speiling): tegningens punkt
  // (x, z) ligger i (1.5 + (z + 1), 2 − (x + 1)). Hodet i (0, 0) står da midt i rommet.
  const local = (x: number, z: number): [number, number] => [1.5 + (z + 1), 2 - (x + 1)];
  const [cx, cz] = local(-1, -1);
  await touch(page, cx, 0.004, cz);
  expect((await buildState(page)).phase).toBe('align-1');
  const [ax, az] = local(1.5, -1);
  await touch(page, ax, 1.1, az);
  s = await buildState(page);
  expect(s.phase).toBe('ready');
  expect(s.status?.text).toContain('lagt på plass');
  // Hodet (0, 1.6, 0) er nå inne i rommet: «Mål «Gang» på nytt», 20 cm bredere mot øst.
  await buildMenu(page, 'b:remeasure');
  s = await buildState(page);
  expect(s.target).toBe('gang');
  const t = (x: number, y: number, z: number) => touch(page, ...(((p) => [p[0], y, p[1]])(local(x, z)) as [number, number, number]));
  await t(0.5, 1, -1);
  await t(2.5, 1, -1);
  await t(3.2, 1, -2);
  await t(1.5, 1, -4);
  await t(-1, 1, -2.5);
  await press(page, 'right', 'a-button');
  await press(page, 'right', 'a-button');
  await press(page, 'right', 'a-button');
  const doc = await builderDoc(page);
  expect(doc.rooms).toHaveLength(1);
  const xs = doc.rooms[0].polygon.map((p: any) => p.x);
  expect(Math.max(...xs)).toBe(3200);
  expect(Math.min(...xs)).toBe(-1000);
  // Døra ble med og sitter fortsatt på inngangsveggen.
  expect(doc.openings[0]).toMatchObject({ room: 'gang', width: 900, entrance: true });
});

/* ------------------- Robusthet (funnet av portvakten) ------------------- */

test('en ødelagt tegning – fra fil eller i lagringen – stopper aldri appen', async ({ page }) => {
  const errors = collectErrors(page);
  await openBuilder(page);
  // Et rom uten navn: avvises med riktig forklaring, ingenting lagres.
  const bad = { version: 1, doc: { version: 1, name: 'Ødelagt', rooms: [{ id: 'gang', polygon: [{ x: 0, z: 0 }, { x: 3000, z: 0 }, { x: 3000, z: 2000 }], floor: 0, ceiling: 2400 }], openings: [] } };
  await page.getByTestId('builder-open-file').setInputFiles({ name: 'feil.tegning.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
  await expect(page.getByTestId('builder-notice')).toContainText('mangler navn');
  expect(await builderDoc(page)).toBeNull();
  // Ligger en slik tegning i lagringen (f.eks. fra en eldre versjon), starter appen likevel.
  await page.evaluate((v) => localStorage.setItem('leilighet:ny-modell:v1', JSON.stringify(v)), bad);
  await page.reload();
  await waitForModel(page);
  await expect(page.getByTestId('status')).toContainText('rom');
  await expect(page.getByTestId('builder-notice')).toContainText('kunne ikke leses');
  expect(await page.evaluate(() => localStorage.getItem('leilighet:ny-modell:v1:ødelagt'))).toContain('Ødelagt');
  expect(errors).toEqual([]);
});

test('tegnet el og vann som ble med i den nye modellen, legges ikke på igjen når den er publisert', async ({ page }) => {
  await page.goto('./');
  await waitForModel(page);
  // En kabel tegnet på den gamle modellen.
  await page.keyboard.press('2');
  await page.keyboard.press('e');
  for (const [x, z] of [
    [3000, 1000],
    [3000, 3000],
  ]) {
    const p = await page.evaluate(([a, b]) => (window as any).leilighet.desktop.screenOf(a, 1500, b), [x, z] as const);
    await page.mouse.move(p.x, p.y);
    await page.mouse.click(p.x, p.y);
  }
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as any).leilighet.plan.ops.length)).toBe(1);

  // Ny modell fra den nåværende, med hjørnet ved inngangsdøra flyttet 50 mm (origo flyttes).
  await page.getByTestId('builder-entry').click();
  await page.getByTestId('builder-from-current').click();
  await page.evaluate(() => {
    const ed = (window as any).leilighet.builder.editor;
    const d = ed.doc;
    const door = d.openings.find((o: any) => o.entrance);
    const room = d.rooms.find((r: any) => r.id === door.room);
    const n = room.polygon.length;
    const a = room.polygon[door.edge];
    const b = room.polygon[(door.edge + 1) % n];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const nearStart = door.offset <= len - (door.offset + door.width);
    // Kanten vinkelrett på inngangsveggen i hjørnet ved døra.
    const edge = nearStart ? (door.edge + n - 1) % n : (door.edge + 1) % n;
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    ed.selection.set({ kind: 'edge', room: room.id, edge });
    ed.nudge(ux * 50, uz * 50);
  });
  const { text, doc: file } = await downloadExport(page);
  const cable = file.wiring.find((w: any) => w.id === 'kabel-1');
  expect(cable).toBeTruthy();
  await page.route('**/apartment.json', (route) => route.fulfill({ body: text, contentType: 'application/json' }));
  await page.reload();
  await waitForModel(page);
  // Byggeren var åpen: beskjeden står på startsiden i panelet.
  await expect(page.getByTestId('builder-notice')).toContainText('lagt ut');
  // Kabelen er med i fila (flyttet med rammen) og ligger ikke lenger som lokal endring.
  expect(await page.evaluate(() => (window as any).leilighet.plan.ops.length)).toBe(0);
  const shown = await page.evaluate(() => (window as any).leilighet.store.doc.wiring.find((w: any) => w.id === 'kabel-1').points);
  expect(shown).toEqual(cable.points);
  await expect(page.getByTestId('draft')).toBeHidden();
});

test('VR gjennom en ny modell: tegning av el og vann er av (den ville havnet feil)', async ({ page }) => {
  await openBuilder(page, './?emulator');
  await page.getByTestId('builder-from-current').click();
  await expect(page.getByTestId('builder-vr')).toBeEnabled();
  await page.getByTestId('builder-vr').click();
  await page.waitForFunction(() => (window as any).leilighet.xr.presenting === true);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const d = (window as any).__iwer;
    d.controllers.left.position.set(-0.2, 1.3, -0.3);
    d.controllers.right.position.set(0.2, 1.3, -0.3);
  });
  await frames(page, 4);
  await press(page, 'left', 'x-button');
  await menuPress(page, 'tab:tegn');
  const labels = await page.evaluate(() => (window as any).leilighet.xr.menuLabels().map((l: any) => l.text).join(' '));
  expect(labels).toContain('Tegning av el og vann er av');
  expect(await page.evaluate(() => (window as any).leilighet.xr.menuItemWorld('draw:pipe:cold'))).toBeNull();
  await page.evaluate(() => (window as any).leilighet.xr.exit());
  await page.waitForFunction(() => (window as any).leilighet.xr.presenting === false);
  // Etter «Lukk» kan man tegne igjen (i VR vises verktøyene).
  await page.getByTestId('builder-close').click();
  expect(await page.evaluate(() => (window as any).leilighet.xr.canDraw())).toBe(true);
});

test('bakgrunnsbilde som ikke får plass i lagringen: et eldre bilde dukker ikke opp igjen', async ({ page }) => {
  await openBuilder(page);
  await page.getByTestId('builder-new').click();
  await page.evaluate(() => {
    localStorage.setItem('leilighet:ny-modell:bilde:v1', JSON.stringify({ src: 'data:image/png;base64,AAAA', w: 10, h: 10, x: 0, z: 0, mmPerPx: 100, opacity: 0.5, visible: true }));
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === 'leilighet:ny-modell:bilde:v1') throw new DOMException('full', 'QuotaExceededError');
      return orig.call(this, k, v);
    };
  });
  await page.getByTestId('builder-backdrop').locator('summary').click();
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 48;
    c.getContext('2d')!.fillRect(0, 0, 10, 10);
    return c.toDataURL('image/png').split(',')[1]!;
  });
  await page.getByTestId('builder-backdrop-file').setInputFiles({ name: 'skisse.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
  await expect(page.getByTestId('builder-backdrop-image')).toBeVisible();
  await expect(page.getByTestId('builder-message')).toContainText('for stort til å huskes');
  expect(await page.evaluate(() => localStorage.getItem('leilighet:ny-modell:bilde:v1'))).toBeNull();
  await page.reload();
  await waitForModel(page);
  expect(await page.evaluate(() => (window as any).leilighet.builder.backdrop.state)).toBeNull();
});

test('gjennomsyn: mister hodesettet sporingen, må tegningen justeres på nytt', async ({ page }) => {
  // Lange scenarier i emulert Quest 3: tar 40–60 s på en treg maskin.
  test.setTimeout(90_000);
  await openBuilder(page, './?emulator');
  await enterBuild(page);
  await captureRoom(page);
  // Begynt på neste rom når sporingen nullstilles (referanserommet flyttes).
  await touch(page, 0.5, 1, -5);
  expect((await buildState(page)).walls).toEqual([1]);
  await page.evaluate(() => (window as any).leilighet.renderer.xr.getReferenceSpace().dispatchEvent(new Event('reset')));
  await frames(page, 2);
  const s = await buildState(page);
  expect(s.phase).toBe('align-0');
  expect(s.walls).toEqual([]);
  expect(s.status).toEqual({ text: expect.stringContaining('Sporingen ble nullstilt'), tone: 'warn' });
  expect(s.rig).toEqual({ x: 0, y: 0, z: 0, yaw: 0 });
  // Rommet som var målt, er ikke rørt.
  expect((await builderDoc(page)).rooms).toHaveLength(1);
});

test('el og vann tegnet mot en eldre fil (f.eks. publisert fra en annen enhet) får et varsel', async ({ page }) => {
  await page.goto('./');
  await waitForModel(page);
  await page.keyboard.press('2');
  await page.keyboard.press('e');
  for (const [x, z] of [
    [3000, 1000],
    [3000, 3000],
  ]) {
    const p = await page.evaluate(([a, b]) => (window as any).leilighet.desktop.screenOf(a, 1500, b), [x, z] as const);
    await page.mouse.move(p.x, p.y);
    await page.mouse.click(p.x, p.y);
  }
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('plan-older')).toBeHidden();
  // Fila byttes (rom flyttet) uten at denne nettleseren eksporterte den.
  const moved = placeholder();
  moved.rooms[0].polygon = moved.rooms[0].polygon.map(([x, z]: [number, number]) => [x + 50, z]);
  await page.route('**/apartment.json', (route) => route.fulfill({ json: moved }));
  await page.reload();
  await waitForModel(page);
  await expect(page.getByTestId('plan-older')).toContainText('eldre utgave av rom og vegger');
  await page.getByTestId('plan-older-keep').click();
  await expect(page.getByTestId('plan-older')).toBeHidden();
  await page.reload();
  await waitForModel(page);
  await expect(page.getByTestId('plan-older')).toBeHidden();
  expect(await page.evaluate(() => (window as any).leilighet.plan.size)).toBe(1);
});
