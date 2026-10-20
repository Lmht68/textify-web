import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { get } from 'node:http';
import { resolve } from 'node:path';

type CommandResult = Readonly<{
  exitCode: number;
  output: string;
}>;

type WebsiteStartOptions = Readonly<{
  apiUpstream: string;
}>;

type NginxWebsiteHarnessOptions = Readonly<{
  imageTag: string;
  projectDirectory: string;
}>;

export type NginxWebsiteHarness = Readonly<{
  build: () => Promise<void>;
  start: (options: WebsiteStartOptions) => Promise<Readonly<{ origin: string }>>;
  startExpectingFailure: () => Promise<string>;
  assertServiceDnsUpstreamWorks: () => Promise<void>;
  dispose: () => Promise<void>;
}>;

const pause = async (milliseconds: number): Promise<void> => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, milliseconds);
  return promise;
};

const runDocker = async (arguments_: ReadonlyArray<string>, cwd: string): Promise<CommandResult> => {
  const completed = Promise.withResolvers<CommandResult>();
  const process = spawn('docker', arguments_, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';

  process.stdout.setEncoding('utf8');
  process.stderr.setEncoding('utf8');
  process.stdout.on('data', (chunk: string) => {
    output += chunk;
  });
  process.stderr.on('data', (chunk: string) => {
    output += chunk;
  });
  process.once('error', completed.reject);
  process.once('close', (exitCode) => {
    completed.resolve({ exitCode: exitCode ?? 1, output });
  });

  return completed.promise;
};

const requireDocker = async (arguments_: ReadonlyArray<string>, cwd: string): Promise<string> => {
  const result = await runDocker(arguments_, cwd);

  if (result.exitCode !== 0) {
    throw new Error(`docker ${arguments_.join(' ')} failed:\n${result.output}`);
  }

  return result.output.trim();
};

const requestText = async (origin: string, path: string): Promise<Readonly<{ status: number; body: string }>> => {
  const completed = Promise.withResolvers<Readonly<{ status: number; body: string }>>();
  const request = get(`${origin}${path}`, (response) => {
    const chunks: Buffer[] = [];

    response.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    response.once('error', completed.reject);
    response.once('end', () => {
      completed.resolve({
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
      });
    });
  });

  request.once('error', completed.reject);
  return completed.promise;
};

const isMissingDockerResource = (output: string): boolean => /No such (container|network|image)/u.test(output);

export const createNginxWebsiteHarness = ({
  imageTag,
  projectDirectory,
}: NginxWebsiteHarnessOptions): NginxWebsiteHarness => {
  const projectRoot = resolve(projectDirectory);
  const resourceSuffix = `${process.pid}-${randomUUID().slice(0, 8)}`;
  const containers = new Set<string>();
  const networks = new Set<string>();
  let imageBuilt = false;

  const createContainerName = (purpose: string): string =>
    `textify-${purpose}-${resourceSuffix}-${containers.size + 1}`;

  const waitForHealth = async (origin: string): Promise<void> => {
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const response = await requestText(origin, '/healthz');

        if (response.status === 200 && response.body === 'ok') {
          return;
        }

        lastError = new Error(`Received ${response.status} from /healthz.`);
      } catch (error: unknown) {
        lastError = error;
      }

      await pause(100);
    }

    throw new Error(`Nginx website did not become healthy: ${String(lastError)}`);
  };

  const startContainer = async ({
    apiUpstream,
    networkName,
  }: WebsiteStartOptions & Readonly<{ networkName?: string }>): Promise<Readonly<{ origin: string }>> => {
    const containerName = createContainerName('website');
    const arguments_ = [
      'run',
      '--detach',
      '--rm',
      '--name',
      containerName,
      '--add-host',
      'host.docker.internal:host-gateway',
      '--env',
      `TEXTIFY_API_UPSTREAM=${apiUpstream}`,
      '--publish',
      '127.0.0.1::80',
    ];

    if (networkName !== undefined) {
      arguments_.push('--network', networkName);
    }

    arguments_.push(imageTag);
    containers.add(containerName);
    await requireDocker(arguments_, projectRoot);

    const port = await requireDocker(
      ['inspect', '--format', '{{(index (index .NetworkSettings.Ports "80/tcp") 0).HostPort}}', containerName],
      projectRoot,
    );
    const origin = `http://127.0.0.1:${port}`;

    await waitForHealth(origin);
    return { origin };
  };

  return {
    build: async () => {
      await requireDocker(['build', '--tag', imageTag, projectRoot], projectRoot);
      imageBuilt = true;
    },
    start: async ({ apiUpstream }) => startContainer({ apiUpstream }),
    startExpectingFailure: async () => {
      const containerName = createContainerName('missing-upstream');
      containers.add(containerName);
      const result = await runDocker(['run', '--name', containerName, imageTag], projectRoot);

      if (result.exitCode === 0) {
        throw new Error('Nginx image started without TEXTIFY_API_UPSTREAM.');
      }

      if (!result.output.includes('TEXTIFY_API_UPSTREAM must be set')) {
        throw new Error(`Nginx image failed for an unexpected reason:\n${result.output}`);
      }

      return result.output;
    },
    assertServiceDnsUpstreamWorks: async () => {
      const networkName = `textify-network-${resourceSuffix}`;
      const requestPath = '/api/probe?source=compose';
      const createApiServer = (generation: string): string => [
        "const { createServer } = require('node:http');",
        "createServer((request, response) => {",
        `if (request.url !== '${requestPath}') { response.statusCode = 404; response.end(); return; }`,
        `response.setHeader('content-type', 'text/plain'); response.end('${generation}:' + request.url);`,
        "}).listen(8182, '0.0.0.0');",
      ].join('');
      const startApiContainer = async (containerName: string, generation: string): Promise<void> => {
        containers.add(containerName);
        await requireDocker(
          [
            'run',
            '--detach',
            '--rm',
            '--name',
            containerName,
            '--network',
            networkName,
            '--network-alias',
            'api',
            'node:22.22.2-alpine',
            'node',
            '--eval',
            createApiServer(generation),
          ],
          projectRoot,
        );
      };
      const waitForGeneration = async (origin: string, generation: string): Promise<void> => {
        let lastResponse: Readonly<{ status: number; body: string }> | undefined;

        for (let attempt = 0; attempt < 50; attempt += 1) {
          lastResponse = await requestText(origin, requestPath);

          if (lastResponse.status === 200 && lastResponse.body === `${generation}:${requestPath}`) {
            return;
          }

          await pause(100);
        }

        throw new Error(
          `Service-DNS upstream did not reach API generation ${generation}: ${lastResponse?.status} ${lastResponse?.body}`,
        );
      };

      networks.add(networkName);
      await requireDocker(['network', 'create', networkName], projectRoot);

      const initialApiContainerName = createContainerName('api-initial');
      await startApiContainer(initialApiContainerName, 'initial');
      const initialApiAddress = await requireDocker(
        ['inspect', '--format', `{{with index .NetworkSettings.Networks "${networkName}"}}{{.IPAddress}}{{end}}`, initialApiContainerName],
        projectRoot,
      );
      const { origin } = await startContainer({
        apiUpstream: 'http://api:8182',
        networkName,
      });
      await waitForGeneration(origin, 'initial');

      await requireDocker(['rm', '--force', initialApiContainerName], projectRoot);
      const staleAddressContainerName = createContainerName('api-stale-address');
      containers.add(staleAddressContainerName);
      await requireDocker(
        [
          'run',
          '--detach',
          '--rm',
          '--name',
          staleAddressContainerName,
          '--network',
          networkName,
          '--ip',
          initialApiAddress,
          'node:22.22.2-alpine',
          'node',
          '--eval',
          'setInterval(() => undefined, 1_000);',
        ],
        projectRoot,
      );

      const replacementApiContainerName = createContainerName('api-replacement');
      await startApiContainer(replacementApiContainerName, 'replacement');
      await waitForGeneration(origin, 'replacement');
    },
    dispose: async () => {
      const cleanupFailures: Error[] = [];

      for (const containerName of [...containers].reverse()) {
        const result = await runDocker(['rm', '--force', containerName], projectRoot);

        if (result.exitCode !== 0 && !isMissingDockerResource(result.output)) {
          cleanupFailures.push(new Error(`Could not remove Docker container ${containerName}:\n${result.output}`));
        }
      }

      for (const networkName of [...networks].reverse()) {
        const result = await runDocker(['network', 'rm', networkName], projectRoot);

        if (result.exitCode !== 0 && !isMissingDockerResource(result.output)) {
          cleanupFailures.push(new Error(`Could not remove Docker network ${networkName}:\n${result.output}`));
        }
      }

      if (imageBuilt) {
        const result = await runDocker(['image', 'rm', '--force', imageTag], projectRoot);

        if (result.exitCode !== 0 && !isMissingDockerResource(result.output)) {
          cleanupFailures.push(new Error(`Could not remove Docker image ${imageTag}:\n${result.output}`));
        }
      }

      if (cleanupFailures.length > 0) {
        throw new AggregateError(cleanupFailures, 'Standalone website harness cleanup failed.');
      }
    },
  };
};
