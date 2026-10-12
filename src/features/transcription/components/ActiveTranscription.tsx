type ActiveTranscriptionProps = Readonly<{
  submittedUrl: string;
  statusMessage: string;
  onCancel: (() => void) | null;
}>;

export const ActiveTranscription = ({ submittedUrl, statusMessage, onCancel }: ActiveTranscriptionProps) => {
  return (
    <article className="transcription-active" aria-label="Transcription status">
      <p className="submitted-url">{submittedUrl}</p>
      <div className="active-transcription-copy">
        <p className="active-transcription-status">{statusMessage}</p>
        <p className="active-transcription-note">This might take a moment. You can leave this tab open while we work.</p>
      </div>
      {onCancel === null ? null : (
        <button className="transcription-cancel" type="button" onClick={onCancel}>
          Cancel
        </button>
      )}
    </article>
  );
};
