import type { TimedSegment } from '../types';

export type ReadingParagraph = Readonly<{
  text: string;
  start: number;
}>;

type TemporalRun = Readonly<{
  segments: ReadonlyArray<TimedSegment>;
}>;

type SegmentTextRange = Readonly<{
  startOffset: number;
  endOffset: number;
  sourceStart: number;
}>;

type CompletedSentence = Readonly<{
  text: string;
  start: number;
}>;

type RunText = Readonly<{
  text: string;
  ranges: ReadonlyArray<SegmentTextRange>;
}>;

type SentenceDetection = Readonly<{
  sentences: ReadonlyArray<CompletedSentence>;
  trailingText: string;
}>;

const sentenceEndingPattern = /[.!?。！？]+["'’”)\]}]*(?=\s|$)/gu;
const displayNames =
  typeof Intl.DisplayNames === 'undefined' ? null : new Intl.DisplayNames(['en'], { type: 'language' });

const splitTemporalRuns = (segments: ReadonlyArray<TimedSegment>): ReadonlyArray<TemporalRun> => {
  const runs: Array<TemporalRun> = [];
  let run: Array<TimedSegment> = [];
  let previousSegment: TimedSegment | null = null;

  for (const segment of segments) {
    if (previousSegment !== null && segment.start - previousSegment.end > 3) {
      runs.push({ segments: run });
      run = [];
    }

    run.push(segment);
    previousSegment = segment;
  }

  if (run.length > 0) {
    runs.push({ segments: run });
  }

  return runs;
};

const textForRun = (segments: ReadonlyArray<TimedSegment>): RunText => {
  const textParts: Array<string> = [];
  const ranges: Array<SegmentTextRange> = [];
  let length = 0;

  for (const segment of segments) {
    const text = segment.text.trim();

    if (text.length === 0) {
      continue;
    }

    if (textParts.length > 0) {
      length += 1;
    }

    const startOffset = length;
    length += text.length;
    textParts.push(text);
    ranges.push({ startOffset, endOffset: length, sourceStart: segment.start });
  }

  return { text: textParts.join(' '), ranges };
};

const sourceStartForOffset = (ranges: ReadonlyArray<SegmentTextRange>, offset: number): number | null => {
  for (const range of ranges) {
    if (range.endOffset > offset) {
      return range.sourceStart;
    }
  }

  return null;
};

const detectSentences = ({ text, ranges }: RunText): SentenceDetection => {
  const sentences: Array<CompletedSentence> = [];
  let sentenceStartOffset = 0;

  for (const match of text.matchAll(sentenceEndingPattern)) {
    const sentenceEndOffset = match.index + match[0].length;
    const sentenceRange = text.slice(sentenceStartOffset, sentenceEndOffset);
    const sentenceText = sentenceRange.trim();
    const firstTextOffset = sentenceStartOffset + sentenceRange.search(/\S/u);
    const start = sourceStartForOffset(ranges, firstTextOffset);

    if (sentenceText.length > 0 && start !== null) {
      sentences.push({ text: sentenceText, start });
    }

    sentenceStartOffset = sentenceEndOffset;
  }

  return { sentences, trailingText: text.slice(sentenceStartOffset).trim() };
};

const paragraphsFromCompletedSentences = (runText: RunText): ReadonlyArray<ReadingParagraph> => {
  const { sentences, trailingText: remainder } = detectSentences(runText);

  if (sentences.length === 0) {
    return [];
  }

  const paragraphs: Array<ReadingParagraph> = [];
  let sentenceIndex = 0;

  while (sentenceIndex < sentences.length) {
    const remainingSentences = sentences.length - sentenceIndex;
    const sentenceCount = remainingSentences === 3 ? 3 : Math.min(2, remainingSentences);
    const paragraphSentences = sentences.slice(sentenceIndex, sentenceIndex + sentenceCount);

    paragraphs.push({
      text: paragraphSentences.map((sentence) => sentence.text).join(' '),
      start: paragraphSentences[0].start,
    });
    sentenceIndex += sentenceCount;
  }


  if (remainder.length > 0) {
    const finalParagraph = paragraphs.at(-1);

    if (finalParagraph !== undefined) {
      paragraphs[paragraphs.length - 1] = { ...finalParagraph, text: `${finalParagraph.text} ${remainder}` };
    }
  }

  return paragraphs;
};

const fallbackParagraphs = (segments: ReadonlyArray<TimedSegment>): ReadonlyArray<ReadingParagraph> => {
  const paragraphs: Array<ReadingParagraph> = [];

  for (let index = 0; index < segments.length; index += 3) {
    const contributingSegments = segments
      .slice(index, index + 3)
      .map((segment) => ({ text: segment.text.trim(), start: segment.start }))
      .filter((segment) => segment.text.length > 0);

    if (contributingSegments.length === 0) {
      continue;
    }

    paragraphs.push({
      text: contributingSegments.map((segment) => segment.text).join(' '),
      start: contributingSegments[0].start,
    });
  }

  return paragraphs;
};

export const buildReadingParagraphs = (segments: ReadonlyArray<TimedSegment>): ReadonlyArray<ReadingParagraph> => {
  const paragraphs: Array<ReadingParagraph> = [];

  for (const run of splitTemporalRuns(segments)) {
    const runText = textForRun(run.segments);
    const completedSentenceParagraphs = paragraphsFromCompletedSentences(runText);

    if (completedSentenceParagraphs.length > 0) {
      paragraphs.push(...completedSentenceParagraphs);
      continue;
    }

    paragraphs.push(...fallbackParagraphs(run.segments));
  }

  return paragraphs;
};

export const formatClockTime = (seconds: number): string => {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(wholeSeconds / 3_600);
  const minutes = Math.floor((wholeSeconds % 3_600) / 60);
  const secondsWithinMinute = wholeSeconds % 60;
  const minuteText = minutes.toString().padStart(2, '0');
  const secondText = secondsWithinMinute.toString().padStart(2, '0');

  return hours > 0 ? `${hours}:${minuteText}:${secondText}` : `${minuteText}:${secondText}`;
};

export const formatLanguageName = (languageTag: string): string => {
  let canonicalTag: string;

  try {
    canonicalTag = Intl.getCanonicalLocales(languageTag)[0] ?? languageTag;
  } catch {
    return languageTag;
  }

  if (canonicalTag === 'und') {
    return 'Unknown';
  }

  try {
    return displayNames?.of(canonicalTag) ?? canonicalTag;
  } catch {
    return canonicalTag;
  }
};
