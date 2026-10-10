import { z } from 'zod';

const segmentSchema = z
  .object({
    start: z.number().finite().nonnegative(),
    end: z.number().finite().nonnegative(),
    text: z.string().min(1),
  })
  .strict();

export const activeLinksSchema = z
  .object({
    self: z.string(),
    cancel: z.string(),
  })
  .strict();

export const transcriptionResultSchema = z
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
