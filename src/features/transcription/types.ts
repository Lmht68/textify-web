export type CapabilityLinks = Readonly<{
  self: string;
  cancel: string;
}>;

export type TimedSegment = Readonly<{
  start: number;
  end: number;
  text: string;
}>;

export type TranscriptView = 'text-only' | 'timestamped';

export type TranscriptionSource = Readonly<{
  platform: 'youtube' | 'instagram' | 'facebook' | 'tiktok' | 'x';
  video_id: string;
  url: string;
  title: string;
  description: string;
  channel: string;
  duration_seconds: number;
}>;

export type Transcript = Readonly<{
  method: 'youtube_captions' | 'faster_whisper';
  language: string;
  text: string;
  segments: ReadonlyArray<TimedSegment>;
}>;

export type TranscriptionResult = Readonly<{
  source: TranscriptionSource;
  transcript: Transcript;
}>;

export type SubmitTranscriptionJobResult =
  | Readonly<{ kind: 'accepted'; links: CapabilityLinks }>
  | Readonly<{ kind: 'aborted' }>
  | Readonly<{ kind: 'backend-rejected' }>
  | Readonly<{ kind: 'unavailable' }>
  | Readonly<{ kind: 'contract-error' }>;

export type CancelTranscriptionJobResult =
  | Readonly<{ kind: 'accepted' }>
  | Readonly<{ kind: 'contract-error' }>
  | Readonly<{ kind: 'unavailable' }>;

export type InspectTranscriptionJobResult =
  | Readonly<{ kind: 'queued'; links: CapabilityLinks }>
  | Readonly<{ kind: 'processing'; links: CapabilityLinks }>
  | Readonly<{ kind: 'succeeded'; result: TranscriptionResult }>
  | Readonly<{ kind: 'failed' }>
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'aborted' }>
  | Readonly<{ kind: 'unavailable' }>
  | Readonly<{ kind: 'contract-error' }>;
