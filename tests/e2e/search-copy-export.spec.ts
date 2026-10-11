import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  acceptedJobHeaders,
  finishedJobHeaders,
  queuedJob,
  readingSucceededJob,
  sourceUrl,
} from './support/transcriptionJobFixtures';

const textOnlyTranscript = `First sentence. Second sentence.

Third sentence. Fourth sentence.

Fifth sentence. Sixth sentence starts... after a long pause.

Seventh sentence. Eighth sentence.

Hour sentence one. Hour sentence two.

Final unfinished utterance`;

const timestampedTranscript = `[00:00] First sentence. Second sentence.

[00:02] Third sentence. Fourth sentence. Fifth sentence.

[00:08] Sixth sentence starts...

[00:12] after a long pause. Seventh sentence. Eighth sentence.

[1:01:01] Hour sentence one. Hour sentence two. Final unfinished utterance`;

const openCompletedTranscript = async (page: Page) => {
  await page.route('**/api/transcription-jobs**', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 202,
        headers: acceptedJobHeaders,
        body: JSON.stringify(queuedJob),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      headers: finishedJobHeaders,
      body: JSON.stringify(readingSucceededJob),
    });
  });
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));

  await page.getByLabel('Video link').fill(sourceUrl);
  await page.getByRole('button', { name: 'Transcribe' }).click();

  const activeTranscription = page.getByRole('article', { name: 'Transcription status' });
  await expect(activeTranscription).toContainText('Getting your transcript ready');
  await page.waitForTimeout(0);
  await page.clock.fastForward(2_000);

  return page.getByRole('article', { name: 'Your transcript' });
};

test('should highlight each case-insensitive literal match when a search query is entered', async ({ page }) => {
  const completedTranscript = await openCompletedTranscript(page);
  const clearSearch = completedTranscript.getByRole('button', { name: 'Clear search' });
  const search = completedTranscript.getByLabel('Search transcript');
  const reading = completedTranscript.getByRole('region', { name: 'Reading' });

  await expect(clearSearch).toHaveCount(0);
  await expect(completedTranscript.getByText('No matches', { exact: true })).toBeVisible();

  await search.fill('SENTENCE.');

  await expect(clearSearch).toBeVisible();
  await expect(reading.locator('mark')).toHaveCount(7);
  await expect(completedTranscript.getByText('1 of 7', { exact: true })).toBeVisible();
  await expect(completedTranscript.getByRole('button', { name: 'Previous match' })).toBeDisabled();

  const nextMatch = completedTranscript.getByRole('button', { name: 'Next match' });
  for (let index = 0; index < 6; index += 1) {
    await nextMatch.click();
  }

  await expect(completedTranscript.getByText('7 of 7', { exact: true })).toBeVisible();
  await expect(nextMatch).toBeDisabled();

  await clearSearch.click();

  await expect(clearSearch).toHaveCount(0);
  await expect(reading.locator('mark')).toHaveCount(0);
  await expect(completedTranscript.getByText('No matches', { exact: true })).toBeVisible();

  await search.fill('SENTENCE.');
  await page.reload();

  await expect(reading.locator('mark')).toHaveCount(0);

  await expect(completedTranscript).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(
    true,
  );
});

test('should copy the selected Transcript view when Copy is clicked', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const completedTranscript = await openCompletedTranscript(page);

  await completedTranscript.getByRole('button', { name: 'Copy' }).click();

  await expect(page.getByText('Transcript copied.', { exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(textOnlyTranscript);

  await completedTranscript.getByRole('radio', { name: 'With timestamps' }).check();
  await completedTranscript.getByRole('button', { name: 'Copy' }).click();

  await expect(page.getByText('Transcript copied.', { exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(timestampedTranscript);
});

test('should export each selected Transcript view when Export is clicked', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-write']);
  const completedTranscript = await openCompletedTranscript(page);

  await completedTranscript.getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByText('Transcript copied.', { exact: true })).toBeVisible();

  const textOnlyDownloadPromise = page.waitForEvent('download');
  await completedTranscript.getByRole('button', { name: 'Export' }).click();
  const textOnlyDownload = await textOnlyDownloadPromise;

  await expect(page.getByText('Transcript copied.', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Transcript download started.', { exact: true })).toHaveCount(1);
  expect(textOnlyDownload.suggestedFilename()).toBe('textify-transcript.txt');
  const textOnlyPath = await textOnlyDownload.path();

  if (textOnlyPath === null) {
    throw new Error('Text-only export did not provide a temporary download path.');
  }

  expect(await readFile(textOnlyPath, 'utf8')).toBe(textOnlyTranscript);

  await page.clock.fastForward(2_999);
  await expect(page.getByText('Transcript download started.', { exact: true })).toBeVisible();
  await page.clock.fastForward(1);
  await expect(page.getByText('Transcript download started.', { exact: true })).toHaveCount(0);

  await completedTranscript.getByRole('radio', { name: 'With timestamps' }).check();
  const timestampedDownloadPromise = page.waitForEvent('download');
  await completedTranscript.getByRole('button', { name: 'Export' }).click();
  const timestampedDownload = await timestampedDownloadPromise;

  expect(timestampedDownload.suggestedFilename()).toBe('textify-transcript.txt');
  const timestampedPath = await timestampedDownload.path();

  if (timestampedPath === null) {
    throw new Error('Timestamped export did not provide a temporary download path.');
  }

  expect(await readFile(timestampedPath, 'utf8')).toBe(timestampedTranscript);
});

test('should dismiss the clipboard failure notification after three seconds when copying fails', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error('Clipboard write rejected.')),
      },
    });
  });
  const completedTranscript = await openCompletedTranscript(page);

  await completedTranscript.getByRole('button', { name: 'Copy' }).click();

  await expect(page.getByText("Couldn't copy transcript.", { exact: true })).toHaveCount(1);
  await expect(page.getByText('Transcript copied.', { exact: true })).toHaveCount(0);
  await page.clock.fastForward(2_999);
  await expect(page.getByText("Couldn't copy transcript.", { exact: true })).toBeVisible();
  await page.clock.fastForward(1);
  await expect(page.getByText("Couldn't copy transcript.", { exact: true })).toHaveCount(0);
});
