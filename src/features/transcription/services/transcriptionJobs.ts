import { z } from 'zod';
import { activeLinksSchema, transcriptionResultSchema } from './transcriptionSchemas';
import type {
  CancelTranscriptionJobResult,
  CapabilityLinks,
  InspectTranscriptionJobResult,
  SubmitTranscriptionJobResult,
} from '../types';

const jobPathPrefix = '/api/v1/transcription-jobs/';
const uuidV4Pattern = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const selfPathPattern = new RegExp(`^${jobPathPrefix}(${uuidV4Pattern})$`);
const cancellationPathPattern = new RegExp(`^${jobPathPrefix}(${uuidV4Pattern})/cancellation$`);
const publicErrorCodes = [
  'invalid_url',
  'unsupported_platform',
  'invalid_request',
  'unsupported_content',
  'video_too_long',
  'invalid_media_duration',
  'unsupported_media',
  'no_usable_transcript',
  'metadata_retrieval_failed',
  'audio_download_failed',
  'transcription_failed',
  'transcription_capacity_exceeded',
  'idempotency_conflict',
  'job_not_found',
  'job_already_finished',
  'job_store_unavailable',
  'queue_timeout',
  'worker_interrupted',
  'metadata_timeout',
  'audio_download_timeout',
  'transcription_timeout',
  'internal_error',
] as const;

const uuidV4Schema = z.string().regex(new RegExp(`^${uuidV4Pattern}$`));
const timestampSchema = z.string().datetime({ offset: true });
const terminalLinksSchema = z.object({
  self: z.string(),
});
const queuedResponseSchema = z.object({
  id: uuidV4Schema,
  status: z.literal('queued'),
  submitted_at: timestampSchema,
  links: activeLinksSchema,
});
const processingResponseSchema = z.object({
  id: uuidV4Schema,
  status: z.literal('processing'),
  submitted_at: timestampSchema,
  started_at: timestampSchema,
  cancellation_requested: z.boolean(),
  links: activeLinksSchema,
});
const succeededResponseSchema = z.object({
  id: uuidV4Schema,
  status: z.literal('finished'),
  outcome: z.literal('succeeded'),
  submitted_at: timestampSchema,
  started_at: timestampSchema,
  finished_at: timestampSchema,
  result: transcriptionResultSchema,
  links: terminalLinksSchema,
});
const failedResponseSchema = z.object({
  id: uuidV4Schema,
  status: z.literal('finished'),
  outcome: z.literal('failed'),
  submitted_at: timestampSchema,
  started_at: timestampSchema.nullable(),
  finished_at: timestampSchema,
  error: z.object({
    code: z.enum(publicErrorCodes),
    message: z.string().min(1),
  }),
  links: terminalLinksSchema,
});
const cancelledResponseSchema = z.object({
  id: uuidV4Schema,
  status: z.literal('finished'),
  outcome: z.literal('cancelled'),
  submitted_at: timestampSchema,
  started_at: timestampSchema.nullable(),
  finished_at: timestampSchema,
  links: terminalLinksSchema,
});
const inspectionResponseSchema = z.union([
  queuedResponseSchema,
  processingResponseSchema,
  succeededResponseSchema,
  failedResponseSchema,
  cancelledResponseSchema,
]);

type SubmitTranscriptionJobParameters = Readonly<{
  sourceUrl: string;
  idempotencyKey: string;
  signal: AbortSignal;
}>;

type CancelTranscriptionJobParameters = Readonly<{
  cancellationUrl: string;
}>;

type InspectTranscriptionJobParameters = Readonly<{
  statusUrl: string;
  signal: AbortSignal;
}>;

type ActiveLinksResponse = z.infer<typeof activeLinksSchema>;
const errorResponseSchema = z.object({
  error: z.object({
    code: z.enum(publicErrorCodes),
    message: z.string().min(1),
  }),
});

type PublicErrorResponse = z.infer<typeof errorResponseSchema>;

const parseRetryAfterSeconds = (value: string | null): number => {
  if (value === null || !/^\d+$/u.test(value.trim())) {
    return 0;
  }

  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? seconds : 0;
};

const classifySubmitError = ({
  response,
  body,
}: Readonly<{ response: Response; body: unknown | null }>): SubmitTranscriptionJobResult | null => {
  const parsed = errorResponseSchema.safeParse(body);

  if (!parsed.success) {
    return null;
  }

  const error: PublicErrorResponse['error'] = parsed.data.error;

  switch (error.code) {
    case 'idempotency_conflict':
      return { kind: 'idempotency-conflict' };
    case 'transcription_capacity_exceeded':
      return { kind: 'capacity-exceeded', retryAfterSeconds: parseRetryAfterSeconds(response.headers.get('Retry-After')) };
    case 'job_store_unavailable':
      return { kind: 'store-unavailable' };
    default:
      return response.status >= 500 ? { kind: 'network-unavailable' } : { kind: 'backend-rejected' };
  }
};



const isSameOriginRelativePath = (value: string): boolean => {
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin && url.pathname === value && url.search === '' && url.hash === '';
  } catch {
    return false;
  }
};

const parseActiveLinks = ({ id, links }: Readonly<{ id: string; links: ActiveLinksResponse }>): CapabilityLinks | null => {
  const selfMatch = selfPathPattern.exec(links.self);
  const cancellationMatch = cancellationPathPattern.exec(links.cancel);

  if (
    !isSameOriginRelativePath(links.self) ||
    !isSameOriginRelativePath(links.cancel) ||
    selfMatch === null ||
    cancellationMatch === null ||
    selfMatch[1] !== id ||
    cancellationMatch[1] !== id
  ) {
    return null;
  }

  return { self: links.self, cancel: links.cancel };
};


const readJson = async (response: Response): Promise<unknown | null> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

export const submitTranscriptionJob = async ({
  sourceUrl,
  idempotencyKey,
  signal,
}: SubmitTranscriptionJobParameters): Promise<SubmitTranscriptionJobResult> => {
  let response: Response;

  try {
    response = await fetch('/api/v1/transcription-jobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ url: sourceUrl.trim() }),
      signal,
    });
  } catch (error: unknown) {
    if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      return { kind: 'aborted' };
    }

    return { kind: 'network-unavailable' };
  }

  if (response.status !== 202) {
    const classifiedError = classifySubmitError({ response, body: await readJson(response) });

    if (classifiedError !== null) {
      return classifiedError;
    }

    if (response.status === 400 || response.status === 422) {
      return { kind: 'backend-rejected' };
    }

    return response.status >= 500 ? { kind: 'network-unavailable' } : { kind: 'contract-error' };
  }

  const body = await readJson(response);
  const parsed = queuedResponseSchema.safeParse(body);
  const location = response.headers.get('Location');

  if (!parsed.success || location === null || location !== parsed.data.links.self) {
    return { kind: 'contract-error' };
  }

  const links = parseActiveLinks(parsed.data);
  return links === null ? { kind: 'contract-error' } : { kind: 'accepted', links };
};

export const cancelTranscriptionJob = async ({
  cancellationUrl,
}: CancelTranscriptionJobParameters): Promise<CancelTranscriptionJobResult> => {
  const cancellationPathMatches = isSameOriginRelativePath(cancellationUrl) && cancellationPathPattern.test(cancellationUrl);

  if (!cancellationPathMatches) {
    return { kind: 'contract-error' };
  }

  let response: Response;

  try {
    response = await fetch(cancellationUrl, {
      method: 'PUT',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    });
  } catch {
    return { kind: 'unavailable' };
  }

  return response.status === 200 || response.status === 202 ? { kind: 'accepted' } : { kind: 'unavailable' };
};

export const inspectTranscriptionJob = async ({ statusUrl, signal }: InspectTranscriptionJobParameters): Promise<InspectTranscriptionJobResult> => {
  const statusPathMatches = isSameOriginRelativePath(statusUrl) && selfPathPattern.test(statusUrl);

  if (!statusPathMatches) {
    return { kind: 'invalid-capability' };
  }

  let response: Response;

  try {
    response = await fetch(statusUrl, {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal,
    });
  } catch (error: unknown) {
    if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      return { kind: 'aborted' };
    }

    return { kind: 'unavailable' };
  }

  if (response.status === 404) {
    return { kind: 'not-found' };
  }

  if (response.status !== 200) {
    return { kind: 'unavailable' };
  }

  const body = await readJson(response);
  const parsed = inspectionResponseSchema.safeParse(body);

  if (!parsed.success) {
    return { kind: 'contract-error' };
  }

  switch (parsed.data.status) {
    case 'queued': {
      const links = parseActiveLinks(parsed.data);
      return links === null || links.self !== statusUrl ? { kind: 'contract-error' } : { kind: 'queued', links };
    }
    case 'processing': {
      const links = parseActiveLinks(parsed.data);
      return links === null || links.self !== statusUrl ? { kind: 'contract-error' } : { kind: 'processing', links };
    }
    case 'finished': {
      const terminalSelfMatch = selfPathPattern.exec(parsed.data.links.self);

      if (
        !isSameOriginRelativePath(parsed.data.links.self) ||
        terminalSelfMatch === null ||
        terminalSelfMatch[1] !== parsed.data.id ||
        parsed.data.links.self !== statusUrl
      ) {
        return { kind: 'contract-error' };
      }

      switch (parsed.data.outcome) {
        case 'succeeded':
          return { kind: 'succeeded', result: parsed.data.result };
        case 'failed':
          return { kind: 'failed' };
        case 'cancelled':
          return { kind: 'cancelled' };
      }
    }
  }

  return { kind: 'contract-error' };
};
