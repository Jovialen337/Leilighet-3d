/**
 * Den publiserte fila (public/apartment.json) kan inneholde ekte mål og
 * endres når som helst. Her sjekkes bare at den lastes og tegnes uten feil.
 */
import { expect, test } from '@playwright/test';
import { collectErrors, waitForModel } from './helpers';

test('den publiserte apartment.json lastes og tegnes uten feil', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('./');
  await waitForModel(page);
  await expect(page.getByTestId('status')).toContainText('rom');
  await expect(page.getByTestId('errors')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).leilighet.stats().mergedMeshes)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
