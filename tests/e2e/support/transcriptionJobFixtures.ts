export const fakeCapabilityId = '00000000-0000-4000-8000-000000000000';
export const sourceUrl = 'https://www.youtube.com/watch?v=AbCdEf12345';
export const transcriptionStatusUrl = `/api/transcription-jobs/${fakeCapabilityId}`;
export const transcriptionCancellationUrl = `${transcriptionStatusUrl}/cancellation`;

export const acceptedJobHeaders = {
  'content-type': 'application/json',
  Location: transcriptionStatusUrl,
  'Retry-After': '2',
} as const;

export const activeJobHeaders = {
  'content-type': 'application/json',
  'Retry-After': '2',
} as const;

export const finishedJobHeaders = {
  'content-type': 'application/json',
} as const;

export const queuedJob = {
  id: fakeCapabilityId,
  status: 'queued',
  submitted_at: '2026-01-01T00:00:00Z',
  links: {
    self: transcriptionStatusUrl,
    cancel: transcriptionCancellationUrl,
  },
} as const;

export const processingJob = {
  id: fakeCapabilityId,
  status: 'processing',
  submitted_at: '2026-01-01T00:00:00Z',
  started_at: '2026-01-01T00:00:01Z',
  cancellation_requested: false,
  links: {
    self: transcriptionStatusUrl,
    cancel: transcriptionCancellationUrl,
  },
} as const;

export const succeededJob = {
  id: fakeCapabilityId,
  status: 'finished',
  outcome: 'succeeded',
  submitted_at: '2026-01-01T00:00:00Z',
  started_at: '2026-01-01T00:00:01Z',
  finished_at: '2026-01-01T00:00:02Z',
  result: {
    source: {
      platform: 'youtube',
      video_id: 'AbCdEf12345',
      url: sourceUrl,
      title: 'Retention result',
      description: '',
      channel: 'Textify',
      duration_seconds: 1,
    },
    transcript: {
      method: 'youtube_captions',
      language: 'en',
      text: 'Retention result.',
      segments: [
        {
          start: 0,
          end: 1,
          text: 'Retention result.',
        },
      ],
    },
  },
  links: {
    self: transcriptionStatusUrl,
  },
} as const;
