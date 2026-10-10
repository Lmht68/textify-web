import { ActiveTranscription } from './components/ActiveTranscription';
import { CompletedTranscript } from './components/CompletedTranscript';
import { TranscriptionForm } from './components/TranscriptionForm';
import { useTranscriptionFlow } from './hooks/useTranscriptionFlow';

export const TranscriptionFlow = () => {
  const { inputValue, state, validationMessage, noticeMessage, setInputValue, submit, cancel, selectTranscriptView } =
    useTranscriptionFlow();
  const isSubmitting = state.status === 'submitting';
  const activeState = isSubmitting || state.status === 'queued' || state.status === 'processing' ? state : null;
  let lifecycleMessage = '';

  switch (state.status) {
    case 'submitting':
      lifecycleMessage = 'Starting your transcript';
      break;
    case 'queued':
      lifecycleMessage = 'Getting your transcript ready';
      break;
    case 'processing':
      lifecycleMessage = 'Turning your video into text';
      break;
    case 'succeeded':
      lifecycleMessage = 'Your transcript is ready.';
      break;
    case 'idle':
    case 'error':
      break;
  }

  return (
    <section id="transcription-form" className="transcription-flow" aria-label="Start a transcription">
      <TranscriptionForm
        inputValue={inputValue}
        isSubmitting={isSubmitting}
        validationMessage={validationMessage}
        onInputValueChange={setInputValue}
        onSubmit={submit}
      />
      {state.status === 'idle' && noticeMessage !== null ? (
        <article className="transcription-notice" role="alert">
          <p>{noticeMessage}</p>
        </article>
      ) : null}
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {lifecycleMessage}
      </div>
      {activeState === null ? null : (
        <ActiveTranscription
          submittedUrl={activeState.submittedUrl}
          statusMessage={lifecycleMessage}
          onCancel={state.status === 'queued' || state.status === 'processing' ? cancel : null}
        />
      )}
      {state.status === 'error' ? (
        <article className="transcription-error" role="alert">
          <p>{state.message}</p>
        </article>
      ) : null}
      {state.status === 'succeeded' ? (
        <CompletedTranscript
          result={state.result}
          transcriptView={state.transcriptView}
          onTranscriptViewChange={selectTranscriptView}
        />
      ) : null}
    </section>
  );
};
