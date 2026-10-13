import { ProcessingEllipsis } from './ProcessingEllipsis';

type RecoveryPanelProps =
  | Readonly<{
    kind: 'terminal';
    onRetry: () => void;
    onEdit: () => void;
  }>
  | Readonly<{
    kind: 'temporary';
    submittedUrl: string;
    onRetry: () => void;
    onCancel: () => void;
  }>;

const TerminalFailureIcon = () => {
  return (
    <svg className="recovery-panel-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" />
      <path d="M12 6.8v6.2M12 16.7h.01" fill="none" stroke="var(--surface)" strokeLinecap="round" strokeWidth="2.2" />
    </svg>
  );
};

const TemporaryInterruptionIcon = () => {
  return (
    <svg className="recovery-panel-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" aria-hidden="true">
      <path d="M5 17.5a10 10 0 0 1 14 0" />
      <path d="M8 14.5a6 6 0 0 1 8 0" />
      <path d="M11 11.5a2 2 0 0 1 2 0" />
      <path d="m4 4 16 16" />
    </svg>
  );
};

export const RecoveryPanel = (props: RecoveryPanelProps) => {
  if (props.kind === 'terminal') {
    return (
      <article className="recovery-panel recovery-panel-terminal" role="alert" aria-labelledby="terminal-recovery-title">
        <div className="recovery-panel-heading">
          <TerminalFailureIcon />
          <h2 id="terminal-recovery-title">We couldn&apos;t transcribe this link</h2>
        </div>
        <p>The media may be private, region-locked or in a format we can&apos;t read. Check the link and try again.</p>
        <div className="recovery-panel-actions">
          <button className="recovery-panel-primary-action" type="button" onClick={props.onRetry}>
            Try again
          </button>
          <button className="recovery-panel-secondary-action" type="button" onClick={props.onEdit}>
            Edit link
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className="recovery-panel recovery-panel-temporary" role="alert" aria-labelledby="temporary-recovery-title">
      <div className="recovery-panel-heading">
        <TemporaryInterruptionIcon />
        <h2 id="temporary-recovery-title">Temporary interruption</h2>
      </div>
      <p>
        We can&apos;t check for updates right now. Your transcription may still be running. We&apos;ll keep you updated
        <ProcessingEllipsis />
      </p>
      <p className="submitted-url">{props.submittedUrl}</p>
      <div className="recovery-panel-actions">
        <button className="recovery-panel-primary-action" type="button" onClick={props.onRetry}>
          Retry now
        </button>
        <button className="recovery-panel-secondary-action" type="button" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </article>
  );
};
