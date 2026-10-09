import { z } from 'zod';
import type { CapabilityLinks, InspectTranscriptionJobResult, SubmitTranscriptionJobResult } from '../types';

const jobPathPrefix = '/api/transcription-jobs/';
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
const activeLinksSchema = z
  .object({
    self: z.string(),
    cancel: z.string(),
  })
  .strict();
const terminalLinksSchema = z
  .object({
    self: z.string(),
  })
  .strict();
const queuedResponseSchema = z
  .object({
    id: uuidV4Schema,
    status: z.literal('queued'),
    submitted_at: timestampSchema,
    links: activeLinksSchema,
  })
  .strict();
const processingResponseSchema = z
  .object({
    id: uuidV4Schema,
    status: z.literal('processing'),
    submitted_at: timestampSchema,
    started_at: timestampSchema,
    cancellation_requested: z.boolean(),
    links: activeLinksSchema,
  })
  .strict();
const segmentSchema = z
  .object({
    start: z.number().finite().nonnegative(),
    end: z.number().finite().nonnegative(),
    text: z.string().min(1),
  })
  .strict();
const transcriptionResultSchema = z
  .object({
    source: z
      .object({
        platform: z.enum(['youtube', 'instagram', 'facebook', 'tiktok', 'x']),
        video_id: z.string(),
        url: z.url().refine((value) => new URL(value).protocol === 'https:'),
        title: z.string(),
        description: z.string(),
        channel: z.string(),
        duration_seconds: z.number().int().positive(),
      })
      .strict(),
    transcript: z
      .object({
        method: z.enum(['youtube_captions', 'faster_whisper']),
        language: z.string().min(1),
        text: z.string(),
        segments: z.array(segmentSchema),
      })
      .strict(),
  })
  .strict();
const succeededResponseSchema = z
  .object({
    id: uuidV4Schema,
    status: z.literal('finished'),
    outcome: z.literal('succeeded'),
    submitted_at: timestampSchema,
    started_at: timestampSchema,
    finished_at: timestampSchema,
    result: transcriptionResultSchema,
    links: terminalLinksSchema,
  })
  .strict();
const failedResponseSchema = z
  .object({
    id: uuidV4Schema,
    status: z.literal('finished'),
    outcome: z.literal('failed'),
    submitted_at: timestampSchema,
    started_at: timestampSchema.nullable(),
    finished_at: timestampSchema,
    error: z
      .object({
        code: z.enum(publicErrorCodes),
        message: z.string().min(1),
      })
      .strict(),
    links: terminalLinksSchema,
  })
  .strict();
const cancelledResponseSchema = z
  .object({
    id: uuidV4Schema,
    status: z.literal('finished'),
    outcome: z.literal('cancelled'),
    submitted_at: timestampSchema,
    started_at: timestampSchema.nullable(),
    finished_at: timestampSchema,
    links: terminalLinksSchema,
  })
  .strict();
const inspectionResponseSchema = z.union([
  queuedResponseSchema,
  processingResponseSchema,
  succeededResponseSchema,
  failedResponseSchema,
  cancelledResponseSchema,
]);

type SubmitTranscriptionJobParameters = Readonly<{
  sourceUrl: string;
  signal: AbortSignal;
}>;

type InspectTranscriptionJobParameters = Readonly<{
  statusUrl: string;
  signal: AbortSignal;
}>;

type ActiveLinksResponse = z.infer<typeof activeLinksSchema>;


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

export const submitTranscriptionJob = async ({ sourceUrl, signal }: SubmitTranscriptionJobParameters): Promise<SubmitTranscriptionJobResult> => {
  let response: Response;

  try {
    response = await fetch('/api/transcription-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: sourceUrl.trim() }),
      signal,
    });
  } catch (error: unknown) {
    if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      return { kind: 'aborted' };
    }

    return { kind: 'unavailable' };
  }

  if (response.status === 400 || response.status === 422) {
    return { kind: 'backend-rejected' };
  }

  if (response.status !== 202) {
    return { kind: 'unavailable' };
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

export const inspectTranscriptionJob = async ({ statusUrl, signal }: InspectTranscriptionJobParameters): Promise<InspectTranscriptionJobResult> => {
  const statusPathMatches = isSameOriginRelativePath(statusUrl) && selfPathPattern.test(statusUrl);

  if (!statusPathMatches) {
    return { kind: 'contract-error' };
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
