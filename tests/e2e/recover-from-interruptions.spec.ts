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
  await page.route('**/api/v1/transcription-jobs**', async (route) => {
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
  const postKeys: Array<string | undefined> = [];

  await page.route('**/api/v1/transcription-jobs**', async (route) => {
    if (route.request().method() === 'POST') {
      postBodies.push(route.request().postData());
      postKeys.push(route.request().headers()['idempotency-key']);
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
  expect(postKeys).toHaveLength(2);
  expect(postKeys[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  expect(postKeys[1]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  expect(postKeys[1]).not.toBe(postKeys[0]);

  await page.getByRole('button', { name: 'Edit link' }).click();
  await expect(recoveryPanel).not.toBeVisible();
  await expect(videoLink).toHaveValue(sourceUrl);
  await expect(videoLink).toBeFocused();
});

test('should reuse an idempotency key after an ambiguous submission failure', async ({ page }) => {
  const postKeys: Array<string | undefined> = [];

  await page.route('**/api/v1/transcription-jobs**', async (route) => {
    if (route.request().method() === 'POST') {
      postKeys.push(route.request().headers()['idempotency-key']);
      if (postKeys.length === 1) {
        await route.abort();
        return;
      }

      await route.fulfill({
        status: 202,
        headers: acceptedJobHeaders,
        body: JSON.stringify(queuedJob),
      });
      return;
    }

    await route.abort();
  });
  await page.goto('/');

  await page.getByLabel('Video link').fill(sourceUrl);
  await page.getByRole('button', { name: 'Transcribe' }).click();
  const recoveryPanel = page.getByRole('alert');
  await expect(recoveryPanel).toContainText("Textify couldn't start this transcript. Try again in a moment.");

  await page.getByRole('button', { name: 'Try again' }).click();
  await expect.poll(() => postKeys).toHaveLength(2);
  expect(postKeys[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  expect(postKeys[1]).toBe(postKeys[0]);
});

test('should reuse a persisted idempotency key after reload when the first submission is ambiguous', async ({ page }) => {
  const postKeys: Array<string | undefined> = [];

  await page.route('**/api/v1/transcription-jobs**', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.abort();
      return;
    }

    postKeys.push(route.request().headers()['idempotency-key']);

    if (postKeys.length === 1) {
      await route.abort();
      return;
    }

    await route.fulfill({
      status: 202,
      headers: acceptedJobHeaders,
      body: JSON.stringify({
        ...queuedJob,
        additive_response_field: true,
        links: { ...queuedJob.links, additive_link_field: 'ignored' },
      }),
    });
  });
  await page.goto('/');
  await page.getByLabel('Video link').fill(sourceUrl);
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await expect(page.getByRole('alert')).toContainText("Textify couldn't start this transcript. Try again in a moment.");

  await page.reload();
  await expect(page.getByLabel('Video link')).toHaveValue(sourceUrl);
  await page.getByRole('button', { name: 'Try again' }).click();

  await expect.poll(() => postKeys).toHaveLength(2);
  expect(postKeys[1]).toBe(postKeys[0]);
});

test('should enforce an integer capacity retry delay when the backend reports capacity exhaustion', async ({ page }) => {
  const postKeys: Array<string | undefined> = [];

  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.route('**/api/v1/transcription-jobs**', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.abort();
      return;
    }

    postKeys.push(route.request().headers()['idempotency-key']);

    if (postKeys.length === 1) {
      await route.fulfill({
        status: 503,
        headers: { 'content-type': 'application/json', 'Retry-After': '2' },
        body: JSON.stringify({
          error: {
            code: 'transcription_capacity_exceeded',
            message: 'Capacity is currently full.',
          },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 202,
      headers: acceptedJobHeaders,
      body: JSON.stringify(queuedJob),
    });
  });
  await page.goto('/');
  await page.getByLabel('Video link').fill(sourceUrl);
  await page.getByRole('button', { name: 'Transcribe' }).click();

  const retryButton = page.getByRole('button', { name: 'Try again' });
  await expect(retryButton).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Transcribe' })).toBeDisabled();
  await page.clock.fastForward(1_000);
  await expect(retryButton).toBeDisabled();
  await page.clock.fastForward(1_000);
  await expect(retryButton).toBeEnabled();
  await retryButton.click();

  await expect.poll(() => postKeys).toHaveLength(2);
  expect(postKeys[1]).toBe(postKeys[0]);
});

test('should show Temporary interruption when transcription updates are unavailable', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.route('**/api/v1/transcription-jobs**', async (route) => {
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
  await page.route('**/api/v1/transcription-jobs**', async (route) => {
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
  await page.route('**/api/v1/transcription-jobs**', async (route) => {
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
  await page.route('**/api/v1/transcription-jobs**', async (route) => {
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
  await page.route('**/api/v1/transcription-jobs**', async (route) => {
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
  await page.route('**/api/v1/transcription-jobs**', async (route) => {
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
