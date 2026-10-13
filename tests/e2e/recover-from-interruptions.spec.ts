import { expect, test } from '@playwright/test';
import {
  acceptedJobHeaders,
  activeJobHeaders,
  failedJob,
  finishedJobHeaders,
  processingJob,
  queuedJob,
  replacementQueuedJob,
  replacementSourceUrl,
  replacementTranscriptionStatusUrl,
  sourceUrl,
  transcriptionCancellationUrl,
} from './support/transcriptionJobFixtures';

test('should show plain-language terminal recovery when a transcription finishes unsuccessfully', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
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
      body: JSON.stringify(failedJob),
    });
  });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));

  await page.getByLabel('Video link').fill(sourceUrl);
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await expect(page.getByRole('article', { name: 'Transcription status' })).toBeVisible();
  await page.waitForTimeout(10);
  await page.clock.fastForward(2_000);

  const recoveryPanel = page.getByRole('alert');
  await expect(recoveryPanel.getByRole('heading', { name: "We couldn't transcribe this link" })).toBeVisible();
  await expect(recoveryPanel).toContainText("The media may be private, region-locked or in a format we can't read. Check the link and try again.");
  const recoveryCopy = await recoveryPanel.innerText();
  expect(recoveryCopy).not.toContain(failedJob.error.message);

  for (const technicalTerm of ['job', 'queue', 'api', 'capability', 'provider', 'status code']) {
    expect(recoveryCopy.toLowerCase()).not.toContain(technicalTerm);
  }
});

test('should preserve and resubmit a rejected link when the visitor retries or edits it', async ({ page }) => {
  const postBodies: Array<string | null> = [];

  await page.route('**/api/transcription-jobs**', async (route) => {
    if (route.request().method() === 'POST') {
      postBodies.push(route.request().postData());
      await route.fulfill({ status: 400 });
      return;
    }

    await route.abort();
  });
  await page.goto('/');

  const videoLink = page.getByLabel('Video link');
  await videoLink.fill(sourceUrl);
  await page.getByRole('button', { name: 'Transcribe' }).click();

  const recoveryPanel = page.getByRole('alert');
  await expect(recoveryPanel.getByRole('heading', { name: "We couldn't transcribe this link" })).toBeVisible();
  await expect(videoLink).toHaveValue(sourceUrl);

  await page.getByRole('button', { name: 'Try again' }).click();
  await expect.poll(() => postBodies).toEqual([JSON.stringify({ url: sourceUrl }), JSON.stringify({ url: sourceUrl })]);

  await page.getByRole('button', { name: 'Edit link' }).click();
  await expect(recoveryPanel).not.toBeVisible();
  await expect(videoLink).toHaveValue(sourceUrl);
  await expect(videoLink).toBeFocused();
});

test('should show Temporary interruption when transcription updates are unavailable', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.route('**/api/transcription-jobs**', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 202,
        headers: acceptedJobHeaders,
        body: JSON.stringify(queuedJob),
      });
      return;
    }

    await route.fulfill({ status: 503 });
  });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));

  await page.getByLabel('Video link').fill(sourceUrl);
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await expect(page.getByRole('article', { name: 'Transcription status' })).toBeVisible();
  await page.waitForTimeout(10);
  await page.clock.fastForward(2_000);

  const recoveryPanel = page.getByRole('alert');
  await expect(recoveryPanel.getByRole('heading', { name: 'Temporary interruption' })).toBeVisible();
  const updateMessage = recoveryPanel.locator('p:not(.submitted-url)');
  const updateEllipsis = updateMessage.locator('.processing-ellipsis');
  const updateDots = updateEllipsis.locator('.processing-ellipsis-dot');

  await expect(updateEllipsis).toBeVisible();
  expect(await updateMessage.textContent()).toBe(
    "We can't check for updates right now. Your transcription may still be running. We'll keep you updated...",
  );
  expect(await recoveryPanel.ariaSnapshot()).not.toContain('...');
  await expect(updateDots).toHaveCount(3);
  await expect(recoveryPanel).toContainText("We can't check for updates right now. Your transcription may still be running. We'll keep you updated.");
  await expect(recoveryPanel).toContainText(sourceUrl);
  const recoveryCopy = await recoveryPanel.innerText();

  for (const technicalTerm of ['job', 'queue', 'api', 'capability', 'provider', 'status code']) {
    expect(recoveryCopy.toLowerCase()).not.toContain(technicalTerm);
  }
});

test('should return to the active transcription when the visitor retries a temporary interruption', async ({ page }) => {
  let statusRequestCount = 0;

  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
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
      status: statusRequestCount === 1 ? 503 : 200,
      headers: activeJobHeaders,
      body: JSON.stringify(processingJob),
    });
  });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));

  await page.getByLabel('Video link').fill(sourceUrl);
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await expect(page.getByRole('article', { name: 'Transcription status' })).toBeVisible();
  await page.waitForTimeout(10);
  await page.clock.fastForward(2_000);
  await expect(page.getByRole('alert')).toBeVisible();

  await page.getByRole('button', { name: 'Retry now' }).click();
  await page.waitForTimeout(10);
  await page.clock.fastForward(1);

  await expect(page.getByRole('article', { name: 'Transcription status' })).toContainText('Turning your video into text');
  expect(statusRequestCount).toBe(2);
});

test('should retry exactly after two seconds when a temporary interruption continues', async ({ page }) => {
  let statusRequestCount = 0;

  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
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
      status: statusRequestCount === 1 ? 503 : 200,
      headers: activeJobHeaders,
      body: JSON.stringify(queuedJob),
    });
  });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));

  await page.getByLabel('Video link').fill(sourceUrl);
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await expect(page.getByRole('article', { name: 'Transcription status' })).toBeVisible();
  await page.waitForTimeout(10);
  await page.clock.fastForward(2_000);
  await expect(page.getByRole('alert')).toBeVisible();
  await page.waitForTimeout(10);

  await page.clock.fastForward(1_999);
  expect(statusRequestCount).toBe(1);

  await page.clock.fastForward(1);
  await expect(page.getByRole('article', { name: 'Transcription status' })).toContainText('Getting your transcript ready');
  expect(statusRequestCount).toBe(2);
});

test('should clear an interrupted transcription when the visitor cancels it', async ({ page }) => {
  let cancellationPath: string | null = null;

  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.route('**/api/transcription-jobs**', async (route) => {
    const request = route.request();

    if (request.method() === 'POST') {
      await route.fulfill({
        status: 202,
        headers: acceptedJobHeaders,
        body: JSON.stringify(queuedJob),
      });
      return;
    }

    if (request.method() === 'PUT') {
      cancellationPath = new URL(request.url()).pathname;
      await route.fulfill({ status: 202 });
      return;
    }

    await route.fulfill({ status: 503 });
  });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));

  const videoLink = page.getByLabel('Video link');
  await videoLink.fill(sourceUrl);
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await expect(page.getByRole('article', { name: 'Transcription status' })).toBeVisible();
  await page.waitForTimeout(10);
  await page.clock.fastForward(2_000);
  await expect(page.getByRole('alert')).toBeVisible();

  await page.getByRole('button', { name: 'Cancel' }).click();

  await expect(page.getByRole('alert')).not.toBeVisible();
  await expect(videoLink).toHaveValue('');
  await expect(videoLink).toBeEnabled();
  await expect.poll(() => cancellationPath).toBe(transcriptionCancellationUrl);
});

test('should recover the active transcription when the browser reconnects', async ({ context, page }) => {
  let statusRequestCount = 0;

  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
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
      headers: activeJobHeaders,
      body: JSON.stringify(processingJob),
    });
  });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));

  await page.getByLabel('Video link').fill(sourceUrl);
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await expect(page.getByRole('article', { name: 'Transcription status' })).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByRole('alert').getByRole('heading', { name: 'Temporary interruption' })).toBeVisible();
  expect(statusRequestCount).toBe(0);

  await context.setOffline(false);
  await page.waitForTimeout(10);
  await page.clock.fastForward(1);

  await expect(page.getByRole('article', { name: 'Transcription status' })).toContainText('Turning your video into text');
  expect(statusRequestCount).toBe(1);
});

test('should replace interrupted work when the visitor submits another link', async ({ page }) => {
  const postBodies: Array<string | null> = [];
  let cancellationPath: string | null = null;

  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.route('**/api/transcription-jobs**', async (route) => {
    const request = route.request();

    if (request.method() === 'POST') {
      const postBody = request.postData();
      postBodies.push(postBody);
      const isReplacement = postBody === JSON.stringify({ url: replacementSourceUrl });
      await route.fulfill({
        status: 202,
        headers: isReplacement
          ? { ...acceptedJobHeaders, Location: replacementTranscriptionStatusUrl }
          : acceptedJobHeaders,
        body: JSON.stringify(isReplacement ? replacementQueuedJob : queuedJob),
      });
      return;
    }

    if (request.method() === 'PUT') {
      cancellationPath = new URL(request.url()).pathname;
      await route.fulfill({ status: 202 });
      return;
    }

    await route.fulfill({ status: 503 });
  });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));

  const videoLink = page.getByLabel('Video link');
  await videoLink.fill(sourceUrl);
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await expect(page.getByRole('article', { name: 'Transcription status' })).toBeVisible();
  await page.waitForTimeout(10);
  await page.clock.fastForward(2_000);
  await expect(page.getByRole('alert')).toBeVisible();

  await videoLink.fill(replacementSourceUrl);
  await page.getByRole('button', { name: 'Transcribe' }).click();

  await expect(page.getByRole('article', { name: 'Transcription status' })).toContainText(replacementSourceUrl);
  await expect.poll(() => cancellationPath).toBe(transcriptionCancellationUrl);
  expect(postBodies).toEqual([JSON.stringify({ url: sourceUrl }), JSON.stringify({ url: replacementSourceUrl })]);
});
