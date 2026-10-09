import { ActiveTranscription } from './components/ActiveTranscription';
import { CompletedTranscript } from './components/CompletedTranscript';
import { TranscriptionForm } from './components/TranscriptionForm';
import { useTranscriptionFlow } from './hooks/useTranscriptionFlow';

export const TranscriptionFlow = () => {
  const { inputValue, state, validationMessage, setInputValue, submit } = useTranscriptionFlow();
  const isWorking = state.status === 'submitting' || state.status === 'queued' || state.status === 'processing';
  const activeState = isWorking ? state : null;
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
        isWorking={isWorking}
        validationMessage={validationMessage}
        onInputValueChange={setInputValue}
        onSubmit={submit}
      />
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {lifecycleMessage}
      </div>
      {activeState === null ? null : (
        <ActiveTranscription submittedUrl={activeState.submittedUrl} statusMessage={lifecycleMessage} />
      )}
      {state.status === 'error' ? (
        <article className="transcription-error" role="alert">
          <p>{state.message}</p>
        </article>
      ) : null}
      {state.status === 'succeeded' ? <CompletedTranscript result={state.result} /> : null}
    </section>
  );
};
