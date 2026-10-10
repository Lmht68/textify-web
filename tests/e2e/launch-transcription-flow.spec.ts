import { expect, test } from '@playwright/test';
import {
  acceptedJobHeaders,
  activeJobHeaders,
  fakeCapabilityId,
  finishedJobHeaders,
  processingJob,
  queuedJob,
  sourceUrl,
  succeededJob,
} from './support/transcriptionJobFixtures';

test('should show correction feedback without an HTTP request when the link is blank or not HTTPS', async ({ page }) => {
  let submissionRequestCount = 0;

  await page.route('**/api/transcription-jobs', async (route) => {
    submissionRequestCount += 1;
    await route.abort();
  });
  await page.goto('/');

  const videoLink = page.getByLabel('Video link');
  const submit = page.getByRole('button', { name: 'Transcribe' });

  await submit.click();
  await expect(page.getByRole('alert')).toHaveText('Paste a video link to continue.');
  await expect(videoLink).toBeFocused();

  await videoLink.fill('http://www.youtube.com/watch?v=AbCdEf12345');
  await submit.click();
  await expect(page.getByRole('alert')).toHaveText('Use a complete link that starts with https://.');
  await expect(videoLink).toBeFocused();
  expect(submissionRequestCount).toBe(0);
});

test('should poll every two seconds and render completed text when the backend completes a supported link', async ({ page }) => {
  const postBodies: Array<string | null> = [];
  let statusRequestCount = 0;

  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.route('**/api/transcription-jobs**', async (route) => {
    const request = route.request();

    if (request.method() === 'POST') {
      postBodies.push(request.postData());
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
      headers: statusRequestCount === 1 ? activeJobHeaders : finishedJobHeaders,
      body: JSON.stringify(statusRequestCount === 1 ? processingJob : succeededJob),
    });
  });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));

  await page.getByLabel('Video link').fill(sourceUrl);
  await page.getByRole('button', { name: 'Transcribe' }).click();

  const activeTranscription = page.getByRole('article', { name: 'Transcription status' });

  await expect(activeTranscription.getByText('Getting your transcript ready', { exact: true })).toBeVisible();
  await expect(activeTranscription.getByText(sourceUrl, { exact: true })).toBeVisible();
  await expect(activeTranscription.getByText("We'll check again in 2 seconds. You can leave this tab open.")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Transcribe' })).toBeEnabled();
  await expect(page.getByLabel('Video link')).toBeEnabled();
  expect(postBodies).toEqual([JSON.stringify({ url: sourceUrl })]);

  await page.clock.fastForward(1_999);
  expect(statusRequestCount).toBe(0);

  await page.clock.fastForward(1);
  await expect(activeTranscription.getByText('Turning your video into text', { exact: true })).toBeVisible();
  expect(statusRequestCount).toBe(1);

  await page.clock.fastForward(2_000);
  await expect(page.getByRole('heading', { name: 'Your transcript' })).toBeVisible();
  await expect(page.getByText('Retention result.', { exact: true })).toBeVisible();
  expect(statusRequestCount).toBe(2);

  expect(await page.locator('body').innerText()).not.toContain(fakeCapabilityId);
  expect(page.url()).not.toContain(fakeCapabilityId);

  await page.clock.fastForward(2_000);
  expect(statusRequestCount).toBe(2);
});
