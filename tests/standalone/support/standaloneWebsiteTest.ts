import { test as base } from '@playwright/test';

import { createControlledTranscriptionApi } from './controlledTranscriptionApi';
import type {
  ControlledTranscriptionApi,
  RecordedApiRequest,
} from './controlledTranscriptionApi';
import { createNginxWebsiteHarness } from './nginxWebsite';

export type StandaloneWebsite = Readonly<{
  origin: string;
  apiOrigin: string;
  api: ControlledTranscriptionApi;
  requests: () => ReadonlyArray<RecordedApiRequest>;
  assertMissingUpstreamFails: () => Promise<string>;
  assertServiceDnsUpstreamWorks: () => Promise<void>;
}>;

type StandaloneFixtures = Readonly<{
  standalone: StandaloneWebsite;
}>;

type StandaloneWorkerFixtures = Readonly<{
  standaloneWorker: StandaloneWebsite;
}>;

export const test = base.extend<StandaloneFixtures, StandaloneWorkerFixtures>({
  standaloneWorker: [
    // Playwright requires worker fixture dependencies to use object destructuring.
    // eslint-disable-next-line no-empty-pattern
    async ({}, provideFixture, workerInfo) => {
      const api = await createControlledTranscriptionApi();
      const projectDirectory = new URL('../../../', import.meta.url).pathname;
      const imageTag = `textify-standalone-${workerInfo.project.name}-${process.pid}-${workerInfo.parallelIndex}`
        .toLowerCase()
        .replaceAll(/[^a-z0-9.-]/gu, '-');
      const website = createNginxWebsiteHarness({ imageTag, projectDirectory });
      let primaryFailure: unknown = undefined;

      try {
        await website.build();
        const { origin } = await website.start({
          apiUpstream: `http://host.docker.internal:${api.port}`,
        });
        await provideFixture({
          origin,
          apiOrigin: `http://127.0.0.1:${api.port}`,
          api,
          requests: () => api.requests(),
          assertMissingUpstreamFails: () => website.startExpectingFailure(),
          assertServiceDnsUpstreamWorks: () => website.assertServiceDnsUpstreamWorks(),
        });
      } catch (error: unknown) {
        primaryFailure = error;
      }

      const teardownFailures: unknown[] = [];

      try {
        await website.dispose();
      } catch (error: unknown) {
        teardownFailures.push(error);
      }

      try {
        await api.close();
      } catch (error: unknown) {
        teardownFailures.push(error);
      }

      if (primaryFailure !== undefined && teardownFailures.length > 0) {
        throw new AggregateError(
          [primaryFailure, ...teardownFailures],
          'Standalone website fixture and cleanup failed.',
        );
      }

      if (primaryFailure !== undefined) {
        throw primaryFailure;
      }

      if (teardownFailures.length > 0) {
        throw new AggregateError(teardownFailures, 'Standalone website fixture cleanup failed.');
      }
    },
    { scope: 'worker', timeout: 120_000 },
  ],
  standalone: async ({ standaloneWorker }, provideFixture) => {
    standaloneWorker.api.reset();
    let usageFailure: unknown = undefined;

    try {
      await provideFixture(standaloneWorker);
    } catch (error: unknown) {
      usageFailure = error;
    }

    standaloneWorker.api.reset();

    if (usageFailure !== undefined) {
      throw usageFailure;
    }
  },
});

export { expect } from '@playwright/test';
