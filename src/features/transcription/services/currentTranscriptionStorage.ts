import { z } from 'zod';
import { activeLinksSchema, transcriptionResultSchema } from './transcriptionSchemas';
import type { CapabilityLinks, TranscriptionResult, TranscriptView } from '../types';

export const currentTranscriptionStorageKey = 'textify.current-transcription';

const operationIdSchema = z.uuid();
const submittedUrlSchema = z.url().refine((value) => new URL(value).protocol === 'https:');

const submittingSnapshotSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal('submitting'),
    operationId: operationIdSchema,
    submittedUrl: submittedUrlSchema,
  })
  .strict();

const clearedSnapshotSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal('cleared'),
    operationId: operationIdSchema,
  })
  .strict();

const activeSnapshotSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal('active'),
    operationId: operationIdSchema,
    status: z.enum(['queued', 'processing']),
    submittedUrl: submittedUrlSchema,
    links: activeLinksSchema,
  })
  .strict();

const completedSnapshotSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal('completed'),
    operationId: operationIdSchema,
    submittedUrl: submittedUrlSchema,
    result: transcriptionResultSchema,
    transcriptView: z.enum(['text-only', 'timestamped']).default('text-only'),
  })
  .strict();

const storedCurrentTranscriptionSchema = z.discriminatedUnion('kind', [
  submittingSnapshotSchema,
  clearedSnapshotSchema,
  activeSnapshotSchema,
  completedSnapshotSchema,
]);

export type StoredCurrentTranscription =
  | Readonly<{ version: 1; kind: 'submitting'; operationId: string; submittedUrl: string }>
  | Readonly<{ version: 1; kind: 'cleared'; operationId: string }>
  | Readonly<{
      version: 1;
      kind: 'active';
      operationId: string;
      status: 'queued' | 'processing';
      submittedUrl: string;
      links: CapabilityLinks;
    }>
  | Readonly<{
      version: 1;
      kind: 'completed';
      operationId: string;
      submittedUrl: string;
      result: TranscriptionResult;
      transcriptView: TranscriptView;
    }>;

type StorageWriteResult = 'written' | 'unavailable';

type StorageUpdateResult = 'written' | 'superseded' | 'unavailable';

type StorageUpdateParameters = Readonly<{
  expectedOperationId: string;
  snapshot: StoredCurrentTranscription;
}>;

export const parseStoredCurrentTranscription = (value: string | null): StoredCurrentTranscription | null => {
  if (value === null) {
    return null;
  }

  try {
    const parsed = storedCurrentTranscriptionSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export const readStoredCurrentTranscription = (): StoredCurrentTranscription | null => {
  let value: string | null;

  try {
    value = window.localStorage.getItem(currentTranscriptionStorageKey);
  } catch {
    return null;
  }

  const snapshot = parseStoredCurrentTranscription(value);

  if (value !== null && snapshot === null) {
    try {
      window.localStorage.removeItem(currentTranscriptionStorageKey);
    } catch {
      // Storage remains unavailable or malformed data could not be removed.
    }
  }

  return snapshot;
};

export const writeStoredCurrentTranscription = (snapshot: StoredCurrentTranscription): StorageWriteResult => {
  try {
    window.localStorage.setItem(currentTranscriptionStorageKey, JSON.stringify(snapshot));
    return 'written';
  } catch {
    return 'unavailable';
  }
};

export const updateStoredCurrentTranscription = ({
  expectedOperationId,
  snapshot,
}: StorageUpdateParameters): StorageUpdateResult => {
  let currentValue: string | null;

  try {
    currentValue = window.localStorage.getItem(currentTranscriptionStorageKey);
  } catch {
    return 'unavailable';
  }

  const currentSnapshot = parseStoredCurrentTranscription(currentValue);

  if (currentSnapshot?.operationId !== expectedOperationId) {
    return 'superseded';
  }

  try {
    window.localStorage.setItem(currentTranscriptionStorageKey, JSON.stringify(snapshot));
    return 'written';
  } catch {
    return 'unavailable';
  }
};
