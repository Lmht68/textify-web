import type { Page, TestInfo } from '@playwright/test';

import {
  acceptedJobHeaders,
  activeJobHeaders,
  failedJob,
  finishedJobHeaders,
  processingJob,
  queuedJob,
  readingSucceededJob,
  sourceUrl,
  transcriptionCancellationUrl,
  transcriptionStatusUrl,
} from '../e2e/support/transcriptionJobFixtures';
import type { ApiResponse, TranscriptionApiScenario } from './support/controlledTranscriptionApi';
import { expect, test } from './support/standaloneWebsiteTest';

const response = (status: number, body?: unknown, headers?: Readonly<Record<string, string>>): ApiResponse => ({
  status,
  headers,
  body,
});

const configureAcceptedScenario = (
  inspections: ReadonlyArray<ApiResponse>,
  fallbackInspection?: ApiResponse,
): TranscriptionApiScenario => ({
  submission: response(202, queuedJob, acceptedJobHeaders),
  inspections,
  fallbackInspection,
});

const expectNoHorizontalOverflow = async (page: Page): Promise<void> => {
  const viewportMetrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(viewportMetrics.scrollWidth).toBeLessThanOrEqual(viewportMetrics.clientWidth);
};

const expectLandingGeometry = async (page: Page, testInfo: TestInfo): Promise<void> => {
  const videoLink = page.getByLabel('Video link');
  const transcribe = page.getByRole('button', { name: 'Transcribe' });
  const firstFeature = page.getByRole('heading', { name: 'Easy-to-read paragraphs' });
  const secondFeature = page.getByRole('heading', { name: 'Search inside the transcript' });
  const [videoLinkBox, transcribeBox, firstFeatureBox, secondFeatureBox] = await Promise.all([
    videoLink.boundingBox(),
    transcribe.boundingBox(),
    firstFeature.boundingBox(),
    secondFeature.boundingBox(),
  ]);

  if (
    videoLinkBox === null ||
    transcribeBox === null ||
    firstFeatureBox === null ||
    secondFeatureBox === null
  ) {
    throw new Error('Expected landing controls and feature headings to be visible.');
  }

  if (testInfo.project.name === 'mobile') {
    expect(transcribeBox.y).toBeGreaterThan(videoLinkBox.y + videoLinkBox.height);
    expect(secondFeatureBox.y).toBeGreaterThan(firstFeatureBox.y + firstFeatureBox.height);
    return;
  }

  expect(Math.abs(transcribeBox.y - videoLinkBox.y)).toBeLessThanOrEqual(1);
  expect(transcribeBox.x).toBeGreaterThan(videoLinkBox.x + videoLinkBox.width);
  expect(Math.abs(secondFeatureBox.y - firstFeatureBox.y)).toBeLessThanOrEqual(1);
};

const expectRecoveryActionGeometry = async (page: Page, testInfo: TestInfo): Promise<void> => {
  const retry = page.getByRole('button', { name: 'Try again' });
  const edit = page.getByRole('button', { name: 'Edit link' });
  const [retryBox, editBox] = await Promise.all([retry.boundingBox(), edit.boundingBox()]);

  if (retryBox === null || editBox === null) {
    throw new Error('Expected terminal recovery actions to be visible.');
  }

  if (testInfo.project.name === 'mobile') {
    expect(editBox.y).toBeGreaterThan(retryBox.y + retryBox.height);
    return;
  }

  expect(Math.abs(editBox.y - retryBox.y)).toBeLessThanOrEqual(1);
  expect(editBox.x).toBeGreaterThan(retryBox.x + retryBox.width);
};

const expectResultActionGeometry = async (page: Page, testInfo: TestInfo): Promise<void> => {
  const copy = page.getByRole('button', { name: 'Copy' });
  const exportTranscript = page.getByRole('button', { name: 'Export' });
  const [copyBox, exportBox] = await Promise.all([copy.boundingBox(), exportTranscript.boundingBox()]);

  if (copyBox === null || exportBox === null) {
    throw new Error('Expected Transcript actions to be visible.');
  }

  expect(Math.abs(exportBox.y - copyBox.y)).toBeLessThanOrEqual(1);
  expect(exportBox.x).toBeGreaterThan(copyBox.x + copyBox.width);

  if (testInfo.project.name === 'mobile') {
    expect(copyBox.width).toBeGreaterThan(0);
    expect(exportBox.width).toBeGreaterThan(0);
  }
};

const startTranscription = async (page: Page, origin: string): Promise<void> => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto(origin);
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.getByLabel('Video link').fill(sourceUrl);
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await expect(page.getByRole('article', { name: 'Transcription status' })).toBeVisible();
  await page.waitForTimeout(10);
};

const advanceToNextPoll = async (page: Page): Promise<void> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const inspectionRequest = page
      .waitForRequest(
        (request) => request.method() === 'GET' && new URL(request.url()).pathname === transcriptionStatusUrl,
        { timeout: 1_000 },
      )
      .catch(() => null);

    await page.clock.fastForward(2_000);

    if ((await inspectionRequest) !== null) {
      return;
    }
  }

  throw new Error('Expected the next scheduled transcription status inspection to start.');
};

const observeApiRequests = (page: Page): string[] => {
  const urls: string[] = [];

  page.on('request', (request) => {
    const url = new URL(request.url());

    if (url.pathname.startsWith('/api/')) {
      urls.push(url.href);
    }
  });

  return urls;
};

const expectSameOriginApiRequests = (urls: ReadonlyArray<string>, origin: string): void => {
  expect(urls).not.toHaveLength(0);

  for (const url of urls) {
    expect(new URL(url).origin).toBe(origin);
  }
};

const expectNoPreflight = (pageRequests: ReadonlyArray<{ method: string }>): void => {
  expect(pageRequests.some((request) => request.method === 'OPTIONS')).toBe(false);
};

test('should reject missing upstream and proxy service-DNS traffic when deployment topology changes', async ({
  standalone,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The configuration smoke covers one image run.');

  await expect(standalone.assertMissingUpstreamFails()).resolves.toContain('TEXTIFY_API_UPSTREAM must be set');
  await standalone.assertServiceDnsUpstreamWorks();
});

test('should show the landing page at supplied viewports when a visitor opens the packaged website', async ({
  page,
  standalone,
}, testInfo) => {
  await page.goto(standalone.origin);

  await expect(page.getByRole('heading', { name: 'Paste a link, get a transcript' })).toBeVisible();
  await expect(page.getByLabel('Video link')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Transcribe' })).toBeVisible();
  await expectLandingGeometry(page, testInfo);
  await expectNoHorizontalOverflow(page);
  await expect(page).toHaveScreenshot('landing.png', { fullPage: true });
});

test('should show truthful active work and cancel it when the API returns queued then processing', async ({
  page,
  standalone,
}) => {
  standalone.api.configure(
    configureAcceptedScenario(
      [response(200, processingJob, activeJobHeaders)],
      response(200, processingJob, activeJobHeaders),
    ),
  );
  const browserApiUrls = observeApiRequests(page);

  await startTranscription(page, standalone.origin);

  const activeTranscription = page.getByRole('article', { name: 'Transcription status' });
  await expect(activeTranscription).toContainText('Getting your transcript ready');
  await expect(activeTranscription).toContainText(sourceUrl);
  await expect(activeTranscription).not.toContainText('Source');
  await expect(activeTranscription).not.toContainText('Duration');
  await expect(activeTranscription).not.toContainText('Language');
  await expect(activeTranscription).not.toContainText('Formatting');

  await advanceToNextPoll(page);

  await expect(activeTranscription).toContainText('Turning your video into text');
  await expectNoHorizontalOverflow(page);
  await expect(page).toHaveScreenshot('active.png', { fullPage: true });

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(activeTranscription).not.toBeVisible();
  await expect(page.getByLabel('Video link')).toHaveValue('');
  await expect.poll(() => standalone.requests()).toHaveLength(3);
  const requests = standalone.requests();
  expect(requests[0]).toMatchObject({
    method: 'POST',
    path: '/api/v1/transcription-jobs',
    body: JSON.stringify({ url: sourceUrl }),
  });
  expect(requests[0].headers['idempotency-key']).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  expect(requests[1]).toMatchObject({ method: 'GET', path: transcriptionStatusUrl, body: '' });
  expect(requests[2]).toMatchObject({ method: 'PUT', path: transcriptionCancellationUrl, body: '' });
  expectSameOriginApiRequests(browserApiUrls, standalone.origin);
  expectNoPreflight(standalone.requests());
});

test('should render text-only and timestamped results when the API succeeds', async ({ page, standalone }, testInfo) => {
  standalone.api.configure(
    configureAcceptedScenario([response(200, readingSucceededJob, finishedJobHeaders)]),
  );
  const browserApiUrls = observeApiRequests(page);

  await startTranscription(page, standalone.origin);
  await advanceToNextPoll(page);

  const completedTranscript = page.getByRole('article', { name: 'Your transcript' });
  const reading = completedTranscript.getByRole('region', { name: 'Reading' });
  await expect(completedTranscript.getByText('Source', { exact: true })).toBeVisible();
  await expect(completedTranscript.getByRole('link', { name: 'How small teams ship faster' })).toBeVisible();
  await expect(completedTranscript.getByText('1:01:05', { exact: true })).toBeVisible();
  await expect(completedTranscript.getByText('English', { exact: true })).toBeVisible();
  await expect(reading.locator('time')).toHaveCount(0);
  await expect(completedTranscript.getByRole('button', { name: 'Copy' })).toBeVisible();
  await expect(completedTranscript.getByRole('button', { name: 'Export' })).toBeVisible();
  await expectResultActionGeometry(page, testInfo);
  await expectNoHorizontalOverflow(page);
  await expect(page).toHaveScreenshot('result-text.png', { fullPage: true });

  await completedTranscript.getByRole('radio', { name: 'With timestamps' }).check();

  await expect(reading.locator('time')).toHaveText(['00:00', '00:02', '00:08', '00:12', '1:01:01']);
  await expectResultActionGeometry(page, testInfo);
  await expectNoHorizontalOverflow(page);
  await expect(page).toHaveScreenshot('result-timestamped.png', { fullPage: true });
  await expect.poll(() => standalone.requests()).toHaveLength(2);
  const requests = standalone.requests();
  expect(requests[0]).toMatchObject({
    method: 'POST',
    path: '/api/v1/transcription-jobs',
    body: JSON.stringify({ url: sourceUrl }),
  });
  expect(requests[0].headers['idempotency-key']).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  expect(requests[1]).toMatchObject({ method: 'GET', path: transcriptionStatusUrl, body: '' });
  expectSameOriginApiRequests(browserApiUrls, standalone.origin);
  expectNoPreflight(standalone.requests());
});

test('should show plain-language terminal recovery when the API reports a failed transcription', async ({
  page,
  standalone,
}, testInfo) => {
  standalone.api.configure(configureAcceptedScenario([response(200, failedJob, finishedJobHeaders)]));

  await startTranscription(page, standalone.origin);
  await advanceToNextPoll(page);

  const recoveryPanel = page.getByRole('alert');
  await expect(recoveryPanel.getByRole('heading', { name: "We couldn't transcribe this link" })).toBeVisible();
  await expect(recoveryPanel).toContainText(
    "The media may be private, region-locked or in a format we can't read. Check the link and try again.",
  );
  const recoveryCopy = await recoveryPanel.innerText();

  expect(recoveryCopy).not.toContain(failedJob.error.message);
  for (const technicalTerm of ['job', 'queue', 'api', 'capability', 'provider', 'status code']) {
    expect(recoveryCopy.toLowerCase()).not.toContain(technicalTerm);
  }

  await expectRecoveryActionGeometry(page, testInfo);
  await expectNoHorizontalOverflow(page);
  await expect(page).toHaveScreenshot('failure.png', { fullPage: true });
});

test('should show a Temporary interruption when the API returns a retryable status response', async ({
  page,
  standalone,
}) => {
  standalone.api.configure(configureAcceptedScenario([response(503)]));

  await startTranscription(page, standalone.origin);
  await advanceToNextPoll(page);

  const recoveryPanel = page.getByRole('alert');
  await expect(recoveryPanel.getByRole('heading', { name: 'Temporary interruption' })).toBeVisible();
  await expect(recoveryPanel).toContainText(
    "We can't check for updates right now. Your transcription may still be running. We'll keep you updated.",
  );
  await expect(recoveryPanel).toContainText(sourceUrl);
  const recoveryCopy = await recoveryPanel.innerText();

  for (const technicalTerm of ['job', 'queue', 'api', 'capability', 'provider', 'status code']) {
    expect(recoveryCopy.toLowerCase()).not.toContain(technicalTerm);
  }

  await expectNoHorizontalOverflow(page);
  await expect(page).toHaveScreenshot('temporary-interruption.png', { fullPage: true });
});
