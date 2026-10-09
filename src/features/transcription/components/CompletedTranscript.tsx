import type { TranscriptionResult } from '../types';

type CompletedTranscriptProps = Readonly<{
  result: TranscriptionResult;
}>;

export const CompletedTranscript = ({ result }: CompletedTranscriptProps) => {
  return (
    <article className="completed-transcript" aria-labelledby="transcript-heading">
      <h2 id="transcript-heading">Your transcript</h2>
      <p>{result.transcript.text}</p>
    </article>
  );
};
