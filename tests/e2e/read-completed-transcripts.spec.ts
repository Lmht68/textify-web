import { expect, test } from '@playwright/test';
import {
  acceptedJobHeaders,
  finishedJobHeaders,
  queuedJob,
  readingSucceededJob,
  sourceUrl,
} from './support/transcriptionJobFixtures';

const readingParagraphs = [
  'First sentence. Second sentence.',
  'Third sentence. Fourth sentence. Fifth sentence.',
  'Sixth fragment seventh fragment eighth fragment',
  'ninth fragment',
  'Hour sentence one. Hour sentence two.',
];

test('should present source details and Reading paragraphs when a Current transcription succeeds', async ({ page }) => {
  let statusRequestCount = 0;

  await page.route('**/api/transcription-jobs**', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 202,
        headers: acceptedJobHeaders,
        body: JSON.stringify(queuedJob),
      });
      return;
    }

    statusRequestCount += 1;
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
  await expect(activeTranscription).toBeVisible();
  await expect(activeTranscription).not.toContainText('How small teams ship faster');
  await expect(activeTranscription).not.toContainText('1:01:05');
  await expect(activeTranscription).not.toContainText('English');

  await page.clock.fastForward(2_000);

  const completedTranscript = page.getByRole('article', { name: 'Your transcript' });
  const sourceLink = completedTranscript.getByRole('link', { name: 'How small teams ship faster' });
  const reading = completedTranscript.getByRole('region', { name: 'Reading' });
  const transcriptView = completedTranscript.getByRole('radiogroup', { name: 'Transcript view' });

  await expect(sourceLink).toHaveAttribute('href', sourceUrl);
  await expect(sourceLink).toHaveAttribute('target', '_blank');
  await expect(sourceLink).toHaveAttribute('rel', /(?=.*\bnoopener\b)(?=.*\bnoreferrer\b)/u);
  await expect(completedTranscript).toContainText('1:01:05');
  await expect(completedTranscript).toContainText('English');
  await expect(transcriptView.getByRole('radio', { name: 'Text only' })).toBeChecked();
  await expect(reading.locator('time')).toHaveCount(0);
  await expect(reading.locator('p')).toHaveText(readingParagraphs);

  await transcriptView.getByRole('radio', { name: 'With timestamps' }).check();

  await expect(transcriptView.getByRole('radio', { name: 'With timestamps' })).toBeChecked();
  await expect(reading.locator('p')).toHaveText(readingParagraphs);
  await expect(reading.locator('time')).toHaveText(['00:00', '00:02', '00:08', '00:14', '1:01:01']);

  await page.reload();

  await expect(completedTranscript.getByRole('link', { name: 'How small teams ship faster' })).toBeVisible();
  await expect(transcriptView.getByRole('radio', { name: 'With timestamps' })).toBeChecked();
  await expect(reading.locator('p')).toHaveText(readingParagraphs);
  expect(statusRequestCount).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
