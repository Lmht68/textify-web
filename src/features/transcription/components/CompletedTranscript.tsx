import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  buildReadingParagraphs,
  buildTextOnlyParagraphs,
  findTranscriptMatches,
  formatClockTime,
  formatLanguageName,
  serializeTranscriptView,
} from '../utils/transcriptReading';
import type { TranscriptTextMatch } from '../utils/transcriptReading';
import type { TranscriptView, TranscriptionResult } from '../types';

type CompletedTranscriptProps = Readonly<{
  result: TranscriptionResult;
  transcriptView: TranscriptView;
  onTranscriptViewChange: (transcriptView: TranscriptView) => void;
}>;

type TranscriptNotification = Readonly<{
  id: number;
  message: string;
}>;

export const CompletedTranscript = ({
  result,
  transcriptView,
  onTranscriptViewChange,
}: CompletedTranscriptProps) => {
  const hasTimedSegments = result.transcript.segments.some((segment) => segment.text.trim().length > 0);
  const isTimestamped = transcriptView === 'timestamped' && hasTimedSegments;
  const paragraphs = useMemo(() => {
    const selectedParagraphs = isTimestamped
      ? buildReadingParagraphs(result.transcript.segments)
      : buildTextOnlyParagraphs(result.transcript.segments);

    return selectedParagraphs.length > 0
      ? selectedParagraphs
      : result.transcript.text.trim().length > 0
        ? [{ text: result.transcript.text.trim(), start: null }]
        : [];
  }, [isTimestamped, result.transcript.segments, result.transcript.text]);
  const sourceLabel = result.source.title.trim() || result.source.url;
  const [query, setQuery] = useState('');
  const [selectedMatchIndex, setSelectedMatchIndex] = useState(0);
  const [notification, setNotification] = useState<TranscriptNotification | null>(null);
  const activeMatchRef = useRef<HTMLElement | null>(null);
  const nextNotificationId = useRef(0);
  const searchResult = useMemo(
    () => findTranscriptMatches({ paragraphs, query }),
    [paragraphs, query],
  );
  const serializedTranscript = useMemo(
    () =>
      serializeTranscriptView({
        paragraphs,
        transcriptView: isTimestamped ? 'timestamped' : 'text-only',
      }),
    [isTimestamped, paragraphs],
  );
  const hasSearchableContent = paragraphs.length > 0;
  const hasQuery = query.length > 0;
  const activeMatchIndex =
    searchResult.matchCount > 0 ? Math.min(selectedMatchIndex, searchResult.matchCount - 1) : null;
  const notificationIdentifier = notification?.id;

  useEffect(() => {
    setSelectedMatchIndex(0);
  }, [isTimestamped, query]);

  useEffect(() => {
    if (activeMatchIndex !== null) {
      activeMatchRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [activeMatchIndex, isTimestamped, paragraphs, query]);

  useEffect(() => {
    if (notificationIdentifier === undefined) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setNotification((currentNotification) =>
        currentNotification?.id === notificationIdentifier ? null : currentNotification,
      );
    }, 3_000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [notificationIdentifier]);

  const renderHighlightedText = (
    text: string,
    matches: ReadonlyArray<TranscriptTextMatch>,
  ): ReactNode => {
    const parts: Array<ReactNode> = [];
    let previousEndOffset = 0;

    for (const match of matches) {
      parts.push(text.slice(previousEndOffset, match.startOffset));

      const isActiveMatch = match.matchIndex === activeMatchIndex;
      parts.push(
        <mark
          aria-current={isActiveMatch ? 'true' : undefined}
          key={match.matchIndex}
          ref={isActiveMatch ? activeMatchRef : undefined}
        >
          {text.slice(match.startOffset, match.endOffset)}
        </mark>,
      );
      previousEndOffset = match.endOffset;
    }

    parts.push(text.slice(previousEndOffset));
    return parts;
  };

  const handleTranscriptViewChange = (nextTranscriptView: TranscriptView) => {
    setSelectedMatchIndex(0);
    onTranscriptViewChange(nextTranscriptView);
  };

  const showNotification = (message: string) => {
    nextNotificationId.current += 1;
    setNotification({ id: nextNotificationId.current, message });
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(serializedTranscript);
      showNotification('Transcript copied.');
    } catch {
      showNotification("Couldn't copy transcript.");
    }
  };

  const handleExport = () => {
    const file = new Blob([serializedTranscript], { type: 'text/plain;charset=utf-8' });
    const objectUrl = URL.createObjectURL(file);
    const downloadLink = document.createElement('a');

    downloadLink.href = objectUrl;
    downloadLink.download = 'textify-transcript.txt';
    document.body.append(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    URL.revokeObjectURL(objectUrl);
    showNotification('Transcript download started.');
  };


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
        <div className="transcript-toolbar">
          <div className="transcript-toolbar-primary">
            <div className="transcript-view" role="radiogroup" aria-label="Transcript view">
              <label className="transcript-view-option">
                <input
                  type="radio"
                  name="transcript-view"
                  value="timestamped"
                  checked={isTimestamped}
                  disabled={!hasTimedSegments}
                  onChange={() => handleTranscriptViewChange('timestamped')}
                />
                <span>With timestamps</span>
              </label>
              <label className="transcript-view-option">
                <input
                  type="radio"
                  name="transcript-view"
                  value="text-only"
                  checked={!isTimestamped}
                  onChange={() => handleTranscriptViewChange('text-only')}
                />
                <span>Text only</span>
              </label>
            </div>
            <div className="transcript-actions">
              <button type="button" disabled={!hasSearchableContent} onClick={handleCopy}>
                Copy
              </button>
              <button type="button" disabled={!hasSearchableContent} onClick={handleExport}>
                Export
              </button>
            </div>
          </div>
          <div className="transcript-search-controls">
            <label className="visually-hidden" htmlFor="transcript-search">
              Search transcript
            </label>
            <div className="transcript-search-field">
              <svg
                aria-hidden="true"
                className="transcript-search-icon"
                fill="none"
                focusable="false"
                stroke="currentColor"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <circle cx="11" cy="11" r="6" />
                <path d="m16 16 4 4" />
              </svg>
              <input
                id="transcript-search"
                type="search"
                placeholder="Search transcript"
                value={query}
                disabled={!hasSearchableContent}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedMatchIndex(0);
                }}
              />
              {hasQuery ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setSelectedMatchIndex(0);
                  }}
                >
                  <svg
                    aria-hidden="true"
                    fill="none"
                    focusable="false"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path d="m7 7 10 10M17 7 7 17" />
                  </svg>
                  <span className="visually-hidden">Clear search</span>
                </button>
              ) : null}
            </div>
            <p className="transcript-search-count">
              {activeMatchIndex === null
                ? 'No matches'
                : `${activeMatchIndex + 1} of ${searchResult.matchCount}`}
            </p>
            <div className="transcript-search-navigation" aria-label="Search matches">
              <button
                type="button"
                disabled={activeMatchIndex === null || activeMatchIndex === 0}
                onClick={() => {
                  setSelectedMatchIndex((currentMatchIndex) => Math.max(0, currentMatchIndex - 1));
                }}
              >
                <svg
                  aria-hidden="true"
                  fill="none"
                  focusable="false"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path d="m15 18-6-6 6-6" />
                </svg>
                <span className="visually-hidden">Previous match</span>
              </button>
              <button
                type="button"
                disabled={
                  activeMatchIndex === null || activeMatchIndex === searchResult.matchCount - 1
                }
                onClick={() => {
                  setSelectedMatchIndex((currentMatchIndex) =>
                    Math.min(searchResult.matchCount - 1, currentMatchIndex + 1),
                  );
                }}
              >
                <svg
                  aria-hidden="true"
                  fill="none"
                  focusable="false"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
                <span className="visually-hidden">Next match</span>
              </button>
            </div>
          </div>
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
                <p className="reading-paragraph">
                  {renderHighlightedText(
                    paragraph.text,
                    searchResult.matchesByParagraph[index] ?? [],
                  )}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="reading-paragraphs reading-paragraphs-text-only">
            {paragraphs.map((paragraph, index) => (
              <p className="reading-paragraph" key={`${paragraph.start}-${index}`}>
                {renderHighlightedText(paragraph.text, searchResult.matchesByParagraph[index] ?? [])}
              </p>
            ))}
          </div>
        )}
      </section>
      {notification === null ? null : (
        <div
          aria-atomic="true"
          aria-live="polite"
          className="transcript-notification"
          key={notification.id}
          role="status"
        >
          {notification.message}
        </div>
      )}
    </article>
  );
};
