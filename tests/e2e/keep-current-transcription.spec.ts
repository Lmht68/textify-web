import { expect, test } from '@playwright/test';
import {
  acceptedJobHeaders,
  activeJobHeaders,
  fakeCapabilityId,
  finishedJobHeaders,
  processingJob,
  queuedJob,
  sourceUrl,
  transcriptionCancellationUrl,
  transcriptionStatusUrl,
  replacementSourceUrl,
  replacementSucceededJob,
  replacementTranscriptionStatusUrl,
  replacementQueuedJob,
  succeededJob,
} from './support/transcriptionJobFixtures';

test('should restore active Current transcription after reload and continue polling', async ({ page }) => {
  let statusRequestCount = 0;

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
  await expect(page.getByRole('article', { name: 'Transcription status' })).toContainText('Getting your transcript ready');

  await page.reload();

  const activeTranscription = page.getByRole('article', { name: 'Transcription status' });
  await expect(activeTranscription).toContainText(sourceUrl);
  await expect(activeTranscription).toContainText('Getting your transcript ready');
  expect(statusRequestCount).toBe(0);

  await page.clock.fastForward(2_000);
  await expect(activeTranscription).toContainText('Turning your video into text');
  expect(statusRequestCount).toBe(1);

  await page.clock.fastForward(2_000);
  await expect(page.getByText('Retention result.', { exact: true })).toBeVisible();
  expect(statusRequestCount).toBe(2);
  expect(await page.locator('body').innerText()).not.toContain(fakeCapabilityId);
  expect(page.url()).not.toContain(fakeCapabilityId);
});

test('should restore a completed Current transcription after reopening without a status lookup', async ({ context, page }) => {
  let statusRequestCount = 0;

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

    statusRequestCount += 1;
    await route.fulfill({
      status: 200,
      headers: finishedJobHeaders,
      body: JSON.stringify(succeededJob),
    });
  });
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));

  await page.getByLabel('Video link').fill(sourceUrl);
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await expect(page.getByRole('article', { name: 'Transcription status' })).toBeVisible();
  await page.clock.fastForward(2_000);
  await expect(page.getByText('Retention result.', { exact: true })).toBeVisible();
  expect(statusRequestCount).toBe(1);

  await page.close();

  const restoredPage = await context.newPage();
  await restoredPage.goto('/');

  await expect(restoredPage.getByText('Retention result.', { exact: true })).toBeVisible();
  expect(statusRequestCount).toBe(1);
  expect(await restoredPage.locator('body').innerText()).not.toContain(fakeCapabilityId);
  expect(restoredPage.url()).not.toContain(fakeCapabilityId);
});

test('should clear Current transcription before an active cancellation request completes', async ({ page }) => {
  let cancellationMethod: string | null = null;
  let cancellationPath: string | null = null;
  let cancellationBody: string | null = null;
  let releaseCancellation: (() => void) | null = null;

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
      cancellationMethod = request.method();
      cancellationPath = new URL(request.url()).pathname;
      cancellationBody = request.postData();
      await new Promise<void>((resolve) => {
        releaseCancellation = resolve;
      });
      await route.fulfill({ status: 202 });
      return;
    }

    await route.abort();
  });
  await page.goto('/');

  await page.getByLabel('Video link').fill(sourceUrl);
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await expect(page.getByRole('article', { name: 'Transcription status' })).toBeVisible();

  await page.getByRole('button', { name: 'Cancel' }).click();

  await expect(page.getByRole('article', { name: 'Transcription status' })).not.toBeVisible();
  await expect(page.getByLabel('Video link')).toHaveValue('');
  await expect(page.getByLabel('Video link')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Transcribe' })).toBeEnabled();
  await expect.poll(() => cancellationPath).toBe(transcriptionCancellationUrl);
  expect(cancellationMethod).toBe('PUT');
  expect(cancellationBody).toBeNull();

  releaseCancellation?.();
});

test('should replace Current transcription and ignore a late response from the prior job', async ({ page }) => {
  const requestEvents: Array<string> = [];
  const postBodies: Array<string | null> = [];
  let firstCancellationBody: string | null = null;
  let resolveLateFirstInspection: (() => void) | null = null;
  let markFirstInspectionStarted: (() => void) | null = null;
  const firstInspectionStarted = new Promise<void>((resolve) => {
    markFirstInspectionStarted = resolve;
  });

  await page.route('**/api/transcription-jobs**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    requestEvents.push(`${request.method()} ${path}`);

    if (request.method() === 'POST') {
      postBodies.push(request.postData());
      await route.fulfill({
        status: 202,
        headers: request.postData() === JSON.stringify({ url: sourceUrl }) ? acceptedJobHeaders : {
          ...acceptedJobHeaders,
          Location: replacementTranscriptionStatusUrl,
        },
        body: JSON.stringify(request.postData() === JSON.stringify({ url: sourceUrl }) ? queuedJob : replacementQueuedJob),
      });
      return;
    }

    if (request.method() === 'PUT') {
      firstCancellationBody = request.postData();
      await route.fulfill({ status: 202 });
      return;
    }

    if (path === transcriptionStatusUrl) {
      markFirstInspectionStarted?.();
      await new Promise<void>((resolve) => {
        resolveLateFirstInspection = resolve;
      });
      await route.fulfill({
        status: 200,
        headers: finishedJobHeaders,
        body: JSON.stringify(succeededJob),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      headers: finishedJobHeaders,
      body: JSON.stringify(replacementSucceededJob),
    });
  });
  await page.goto('/');

  await page.getByLabel('Video link').fill(sourceUrl);
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await expect(page.getByRole('article', { name: 'Transcription status' })).toContainText(sourceUrl);

  await firstInspectionStarted;

  await page.getByLabel('Video link').fill(replacementSourceUrl);
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await expect(page.getByRole('article', { name: 'Transcription status' })).toContainText(replacementSourceUrl);
  await expect.poll(() => requestEvents).toEqual([
    `POST /api/transcription-jobs`,
    `GET ${transcriptionStatusUrl}`,
    `PUT ${transcriptionCancellationUrl}`,
    `POST /api/transcription-jobs`,
  ]);
  expect(postBodies).toEqual([JSON.stringify({ url: sourceUrl }), JSON.stringify({ url: replacementSourceUrl })]);
  expect(firstCancellationBody).toBeNull();

  resolveLateFirstInspection?.();
  await expect(page.getByText('Replacement result.', { exact: true })).toBeVisible();
  await expect(page.getByText('Retention result.', { exact: true })).not.toBeVisible();
  await expect(page.getByRole('article', { name: 'Transcription status' })).not.toBeVisible();
});

test('should synchronize Current transcription and cancellation across same-origin tabs', async ({ context }) => {
  let cancellationRequestCount = 0;

  await context.route('**/api/transcription-jobs**', async (route) => {
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
      cancellationRequestCount += 1;
      await route.fulfill({ status: 202 });
      return;
    }

    await route.abort();
  });

  const submittingPage = await context.newPage();
  const peerPage = await context.newPage();
  await submittingPage.goto('/');
  await peerPage.goto('/');

  await submittingPage.getByLabel('Video link').fill(sourceUrl);
  await submittingPage.getByRole('button', { name: 'Transcribe' }).click();
  await expect(submittingPage.getByRole('article', { name: 'Transcription status' })).toContainText(sourceUrl);
  await expect(peerPage.getByRole('article', { name: 'Transcription status' })).toContainText(sourceUrl);

  await peerPage.getByRole('button', { name: 'Cancel' }).click();

  await expect(submittingPage.getByRole('article', { name: 'Transcription status' })).not.toBeVisible();
  await expect(peerPage.getByRole('article', { name: 'Transcription status' })).not.toBeVisible();
  await expect(submittingPage.getByLabel('Video link')).toHaveValue('');
  await expect(peerPage.getByLabel('Video link')).toHaveValue('');
  await expect(submittingPage.getByRole('button', { name: 'Transcribe' })).toBeEnabled();
  await expect(peerPage.getByRole('button', { name: 'Transcribe' })).toBeEnabled();
  expect(cancellationRequestCount).toBe(1);
  expect(await submittingPage.locator('body').innerText()).not.toContain(fakeCapabilityId);
  expect(await peerPage.locator('body').innerText()).not.toContain(fakeCapabilityId);
});

test('should clear unavailable restored work and explain how to start over', async ({ page }) => {
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

    await route.fulfill({ status: 404 });
  });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));

  await page.getByLabel('Video link').fill(sourceUrl);
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await expect(page.getByRole('article', { name: 'Transcription status' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('article', { name: 'Transcription status' })).toBeVisible();

  await page.clock.fastForward(2_000);

  await expect(page.getByRole('alert')).toHaveText('That transcription is no longer available. Paste the link again to start over.');
  await expect(page.getByRole('article', { name: 'Transcription status' })).not.toBeVisible();
  await expect(page.getByLabel('Video link')).toHaveValue('');
  await expect(page.getByLabel('Video link')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Transcribe' })).toBeEnabled();
  expect(await page.locator('body').innerText()).not.toContain(fakeCapabilityId);
});
