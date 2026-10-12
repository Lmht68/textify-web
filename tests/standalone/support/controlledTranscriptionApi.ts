import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type ApiResponse = Readonly<{
  status: number;
  headers?: Readonly<Record<string, string>>;
  body?: unknown;
}>;

export type TranscriptionApiScenario = Readonly<{
  submission: ApiResponse;
  inspections: ReadonlyArray<ApiResponse>;
  fallbackInspection?: ApiResponse;
  cancellation?: ApiResponse;
}>;

export type RecordedApiRequest = Readonly<{
  method: string;
  path: string;
  body: string;
}>;

export type ControlledTranscriptionApi = Readonly<{
  port: number;
  configure: (scenario: TranscriptionApiScenario) => void;
  requests: () => ReadonlyArray<RecordedApiRequest>;
  reset: () => void;
  close: () => Promise<void>;
}>;

const inspectionPath = /^\/api\/transcription-jobs\/[^/]+$/u;
const cancellationPath = /^\/api\/transcription-jobs\/[^/]+\/cancellation$/u;

const readRequestBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8');
};

const hasContentType = (headers: Readonly<Record<string, string>>): boolean =>
  Object.keys(headers).some((header) => header.toLowerCase() === 'content-type');

const sendResponse = (response: ServerResponse, apiResponse: ApiResponse): void => {
  response.statusCode = apiResponse.status;

  for (const [header, value] of Object.entries(apiResponse.headers ?? {})) {
    response.setHeader(header, value);
  }

  if (apiResponse.body === undefined) {
    response.end();
    return;
  }

  if (typeof apiResponse.body === 'string') {
    response.end(apiResponse.body);
    return;
  }

  if (!hasContentType(apiResponse.headers ?? {})) {
    response.setHeader('content-type', 'application/json');
  }

  response.end(JSON.stringify(apiResponse.body));
};

const closeServer = async (server: Server): Promise<void> => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  server.close((error) => {
    if (error === undefined) {
      resolve();
      return;
    }

    reject(error);
  });

  return promise;
};

export const createControlledTranscriptionApi = async (): Promise<ControlledTranscriptionApi> => {
  let scenario: TranscriptionApiScenario | null = null;
  let inspectionResponses: ApiResponse[] = [];
  let recordedRequests: RecordedApiRequest[] = [];

  const server = createServer(async (request, response) => {
    const path = request.url ?? '/';
    const body = await readRequestBody(request);
    const method = request.method ?? 'GET';

    recordedRequests.push({ method, path, body });

    if (scenario === null) {
      sendResponse(response, { status: 500 });
      return;
    }

    const pathname = new URL(path, 'http://controlled-api.test').pathname;

    if (method === 'POST' && pathname === '/api/transcription-jobs') {
      sendResponse(response, scenario.submission);
      return;
    }

    if (method === 'GET' && inspectionPath.test(pathname)) {
      const inspection = inspectionResponses.shift() ?? scenario.fallbackInspection;
      sendResponse(response, inspection ?? { status: 500 });
      return;
    }

    if (method === 'PUT' && cancellationPath.test(pathname)) {
      sendResponse(response, scenario.cancellation ?? { status: 202 });
      return;
    }

    sendResponse(response, { status: 500 });
  });

  const started = Promise.withResolvers<void>();
  const rejectOnError = (error: Error): void => {
    server.off('error', rejectOnError);
    started.reject(error);
  };

  server.once('error', rejectOnError);
  server.listen(0, '0.0.0.0', () => {
    server.off('error', rejectOnError);
    started.resolve();
  });
  await started.promise;

  const address = server.address();

  if (address === null || typeof address === 'string') {
    await closeServer(server);
    throw new Error('Controlled transcription API did not bind a TCP port.');
  }

  const port = (address as AddressInfo).port;

  return {
    port,
    configure: (nextScenario) => {
      scenario = nextScenario;
      inspectionResponses = [...nextScenario.inspections];
    },
    requests: () => [...recordedRequests],
    reset: () => {
      scenario = null;
      inspectionResponses = [];
      recordedRequests = [];
    },
    close: async () => closeServer(server),
  };
};
