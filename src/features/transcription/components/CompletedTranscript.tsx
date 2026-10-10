import { useMemo } from 'react';
import { buildReadingParagraphs, formatClockTime, formatLanguageName } from '../utils/transcriptReading';
import type { TranscriptView, TranscriptionResult } from '../types';

type CompletedTranscriptProps = Readonly<{
  result: TranscriptionResult;
  transcriptView: TranscriptView;
  onTranscriptViewChange: (transcriptView: TranscriptView) => void;
}>;

export const CompletedTranscript = ({
  result,
  transcriptView,
  onTranscriptViewChange,
}: CompletedTranscriptProps) => {
  const readingParagraphs = useMemo(() => buildReadingParagraphs(result.transcript.segments), [result.transcript.segments]);
  const hasTimedSegments = readingParagraphs.length > 0;
  const isTimestamped = transcriptView === 'timestamped' && hasTimedSegments;
  const paragraphs = hasTimedSegments
    ? readingParagraphs
    : result.transcript.text.trim().length > 0
      ? [{ text: result.transcript.text.trim(), start: null }]
      : [];
  const sourceLabel = result.source.title.trim() || result.source.url;

  return (
    <article className="completed-transcript" aria-labelledby="transcript-heading">
      <h2 id="transcript-heading" className="visually-hidden">
        Your transcript
      </h2>
      <section className="transcript-source-card" aria-label="Source details">
        <dl className="source-details">
          <div className="source-detail source-detail-link">
            <dt>Video</dt>
            <dd>
              <a href={result.source.url} target="_blank" rel="noopener noreferrer" className="source-link">
                {sourceLabel}
              </a>
            </dd>
          </div>
          <div className="source-detail">
            <dt>Duration</dt>
            <dd>{formatClockTime(result.source.duration_seconds)}</dd>
          </div>
          <div className="source-detail">
            <dt>Language</dt>
            <dd>{formatLanguageName(result.transcript.language)}</dd>
          </div>
        </dl>
      </section>
      <section className="transcript-reading-card" aria-labelledby="reading-heading">
        <h3 id="reading-heading" className="visually-hidden">
          Reading
        </h3>
        <div className="transcript-view" role="radiogroup" aria-label="Transcript view">
          <label className="transcript-view-option">
            <input
              type="radio"
              name="transcript-view"
              value="timestamped"
              checked={isTimestamped}
              disabled={!hasTimedSegments}
              onChange={() => onTranscriptViewChange('timestamped')}
            />
            <span>With timestamps</span>
          </label>
          <label className="transcript-view-option">
            <input
              type="radio"
              name="transcript-view"
              value="text-only"
              checked={!isTimestamped}
              onChange={() => onTranscriptViewChange('text-only')}
            />
            <span>Text only</span>
          </label>
        </div>
        {paragraphs.length === 0 ? (
          <p className="empty-transcript">No spoken text was found.</p>
        ) : isTimestamped ? (
          <div className="reading-paragraphs reading-paragraphs-timestamped">
            {paragraphs.map((paragraph, index) => (
              <div className="timestamped-row" key={`${paragraph.start}-${index}`}>
                <time className="timestamp" dateTime={`PT${Math.floor(paragraph.start ?? 0)}S`}>
                  {formatClockTime(paragraph.start ?? 0)}
                </time>
                <p className="reading-paragraph">{paragraph.text}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="reading-paragraphs reading-paragraphs-text-only">
            {paragraphs.map((paragraph, index) => (
              <p className="reading-paragraph" key={`${paragraph.start}-${index}`}>
                {paragraph.text}
              </p>
            ))}
          </div>
        )}
      </section>
    </article>
  );
};
