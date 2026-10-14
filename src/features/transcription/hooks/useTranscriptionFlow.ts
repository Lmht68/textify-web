import { useCallback, useEffect, useRef, useState } from 'react';
import {
  currentTranscriptionStorageKey,
  parseStoredCurrentTranscription,
  readStoredCurrentTranscription,
  updateStoredCurrentTranscription,
  writeStoredCurrentTranscription,
} from '../services/currentTranscriptionStorage';
import { cancelTranscriptionJob, inspectTranscriptionJob, submitTranscriptionJob } from '../services/transcriptionJobs';
import type { StoredCurrentTranscription } from '../services/currentTranscriptionStorage';
import type { CapabilityLinks, TranscriptionResult, TranscriptView } from '../types';

export type TranscriptionFlowState =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'submitting'; operationId: string; submittedUrl: string; idempotencyKey: string }>
  | Readonly<{ status: 'queued'; operationId: string; submittedUrl: string; links: CapabilityLinks; restored: boolean }>
  | Readonly<{ status: 'processing'; operationId: string; submittedUrl: string; links: CapabilityLinks; restored: boolean }>
  | Readonly<{
      status: 'temporary-interruption';
      operationId: string;
      submittedUrl: string;
      links: CapabilityLinks;
      restored: boolean;
    }>
  | Readonly<{
      status: 'succeeded';
      operationId: string;
      submittedUrl: string;
      result: TranscriptionResult;
      transcriptView: TranscriptView;
    }>
  | Readonly<{ status: 'terminal-failure'; submittedUrl: string }>
  | Readonly<{
      status: 'error';
      operationId: string;
      submittedUrl: string;
      message: string;
      idempotencyKey: string | null;
      retryAfterUntil: number | null;
    }>;

export type UseTranscriptionFlowResult = Readonly<{
  inputValue: string;
  state: TranscriptionFlowState;
  validationMessage: string | null;
  setInputValue: (value: string) => void;
  noticeMessage: string | null;
  submit: () => Promise<void>;
  cancel: () => void;
  retryStatus: () => void;
  editSubmittedUrl: () => void;
  selectTranscriptView: (transcriptView: TranscriptView) => void;
}>;

const initialOutageMessage = "Textify couldn't start this transcript. Try again in a moment.";
const unavailableRestoredMessage = 'That transcription is no longer available. Paste the link again to start over.';
const idempotencyConflictMessage = 'This submission could not be retried safely. Try again to start a new transcript.';
const cancelledErrorMessage = 'This transcription was cancelled. Submit the link again when you\'re ready.';
const pollingIntervalMilliseconds = 2_000;

const stateFromStoredCurrentTranscription = (snapshot: StoredCurrentTranscription | null): TranscriptionFlowState => {
  if (snapshot?.kind === 'submitting') {
    return {
      status: 'error',
      operationId: snapshot.operationId,
      submittedUrl: snapshot.submittedUrl,
      message: initialOutageMessage,
      idempotencyKey: snapshot.idempotencyKey,
      retryAfterUntil: null,
    };
  }

  if (snapshot?.kind === 'active') {
    return {
      status: snapshot.status,
      operationId: snapshot.operationId,
      submittedUrl: snapshot.submittedUrl,
      links: snapshot.links,
      restored: true,
    };
  }

  if (snapshot?.kind === 'completed') {
    return {
      status: 'succeeded',
      operationId: snapshot.operationId,
      submittedUrl: snapshot.submittedUrl,
      result: snapshot.result,
      transcriptView: snapshot.transcriptView,
    };
  }

  return { status: 'idle' };
};

const inputFromStoredCurrentTranscription = (snapshot: StoredCurrentTranscription | null): string => {
  return snapshot?.kind === 'submitting' || snapshot?.kind === 'active' || snapshot?.kind === 'completed'
    ? snapshot.submittedUrl
    : '';
};

const operationIdFromStoredCurrentTranscription = (snapshot: StoredCurrentTranscription | null): string | null => {
  return snapshot?.operationId ?? null;
};

const pendingSubmissionKeyFromStoredCurrentTranscription = (snapshot: StoredCurrentTranscription | null): string | null => {
  return snapshot?.kind === 'submitting' ? snapshot.idempotencyKey : null;
};

export const useTranscriptionFlow = (): UseTranscriptionFlowResult => {
  const [initialSnapshot] = useState<StoredCurrentTranscription | null>(readStoredCurrentTranscription);
  const [inputValue, setInputValueState] = useState(() => inputFromStoredCurrentTranscription(initialSnapshot));
  const [state, setState] = useState<TranscriptionFlowState>(() => stateFromStoredCurrentTranscription(initialSnapshot));
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const submissionControllerRef = useRef<AbortController | null>(null);
  const pendingSubmissionKeyRef = useRef<string | null>(pendingSubmissionKeyFromStoredCurrentTranscription(initialSnapshot));
  const operationIdRef = useRef(operationIdFromStoredCurrentTranscription(initialSnapshot));
  const persistedOperationIdRef = useRef(operationIdFromStoredCurrentTranscription(initialSnapshot));
  const [immediateRetryVersion, setImmediateRetryVersion] = useState(0);
  const stateRef = useRef(state);
  const consumedImmediateRetryVersionRef = useRef(0);
  stateRef.current = state;

  const applyStoredCurrentTranscription = useCallback((snapshot: StoredCurrentTranscription | null) => {
    operationIdRef.current = operationIdFromStoredCurrentTranscription(snapshot);
    persistedOperationIdRef.current = operationIdFromStoredCurrentTranscription(snapshot);
    pendingSubmissionKeyRef.current = pendingSubmissionKeyFromStoredCurrentTranscription(snapshot);
    setInputValueState(inputFromStoredCurrentTranscription(snapshot));
    setValidationMessage(null);
    setState(stateFromStoredCurrentTranscription(snapshot));
    setNoticeMessage(null);
  }, []);

  const persistCurrentSnapshot = useCallback(
    (operationId: string, snapshot: StoredCurrentTranscription): boolean => {
      if (persistedOperationIdRef.current !== operationId) {
        return false;
      }

      if (updateStoredCurrentTranscription({ expectedOperationId: operationId, snapshot }) !== 'superseded') {
        return false;
      }

      applyStoredCurrentTranscription(readStoredCurrentTranscription());
      return true;
    },
    [applyStoredCurrentTranscription],
  );

  useEffect(() => {
    return () => {
      submissionControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const synchronizeStoredCurrentTranscription = (event: StorageEvent) => {
      if (event.key !== currentTranscriptionStorageKey) {
        return;
      }

      submissionControllerRef.current?.abort();
      submissionControllerRef.current = null;
      applyStoredCurrentTranscription(parseStoredCurrentTranscription(event.newValue));
    };

    window.addEventListener('storage', synchronizeStoredCurrentTranscription);
    return () => {
      window.removeEventListener('storage', synchronizeStoredCurrentTranscription);
    };
  }, [applyStoredCurrentTranscription]);

  useEffect(() => {
    const interruptWhenOffline = () => {
      const currentState = stateRef.current;

      if (currentState.status !== 'queued' && currentState.status !== 'processing') {
        return;
      }

      const interruptedState: TranscriptionFlowState = {
        status: 'temporary-interruption',
        operationId: currentState.operationId,
        submittedUrl: currentState.submittedUrl,
        links: currentState.links,
        restored: currentState.restored,
      };
      stateRef.current = interruptedState;
      setState(interruptedState);
    };

    const retryWhenOnline = () => {
      if (stateRef.current.status === 'temporary-interruption') {
        setImmediateRetryVersion((version) => version + 1);
      }
    };

    window.addEventListener('offline', interruptWhenOffline);
    window.addEventListener('online', retryWhenOnline);
    return () => {
      window.removeEventListener('offline', interruptWhenOffline);
      window.removeEventListener('online', retryWhenOnline);
    };
  }, []);

  useEffect(() => {
    if (state.status !== 'queued' && state.status !== 'processing' && state.status !== 'temporary-interruption') {
      return;
    }

    if ((state.status === 'queued' || state.status === 'processing') && !navigator.onLine) {
      const interruptedState: TranscriptionFlowState = {
        status: 'temporary-interruption',
        operationId: state.operationId,
        submittedUrl: state.submittedUrl,
        links: state.links,
        restored: state.restored,
      };
      stateRef.current = interruptedState;
      setState(interruptedState);
      return;
    }

    const shouldRetryImmediately = immediateRetryVersion !== consumedImmediateRetryVersionRef.current;

    if (shouldRetryImmediately) {
      consumedImmediateRetryVersionRef.current = immediateRetryVersion;
    }

    let isCurrent = true;
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => {
        void (async () => {
          const inspection = await inspectTranscriptionJob({ statusUrl: state.links.self, signal: controller.signal });

          if (!isCurrent || inspection.kind === 'aborted' || operationIdRef.current !== state.operationId) {
            return;
          }

          switch (inspection.kind) {
            case 'queued':
            case 'processing': {
              const activeSnapshot: StoredCurrentTranscription = {
                version: 1,
                kind: 'active',
                operationId: state.operationId,
                status: inspection.kind,
                submittedUrl: state.submittedUrl,
                links: inspection.links,
              };

              if (persistCurrentSnapshot(state.operationId, activeSnapshot)) {
                return;
              }

              setState({
                status: inspection.kind,
                operationId: state.operationId,
                submittedUrl: state.submittedUrl,
                links: inspection.links,
                restored: false,
              });
              return;
            }
            case 'succeeded': {
              const completedSnapshot: StoredCurrentTranscription = {
                version: 1,
                kind: 'completed',
                operationId: state.operationId,
                submittedUrl: state.submittedUrl,
                result: inspection.result,
                transcriptView: 'text-only',
              };

              if (persistCurrentSnapshot(state.operationId, completedSnapshot)) {
                return;
              }

              setState({
                status: 'succeeded',
                operationId: state.operationId,
                submittedUrl: state.submittedUrl,
                result: inspection.result,
                transcriptView: 'text-only',
              });
              return;
            }
            case 'failed': {
              const clearedSnapshot: StoredCurrentTranscription = { version: 1, kind: 'cleared', operationId: state.operationId };

              if (persistCurrentSnapshot(state.operationId, clearedSnapshot)) {
                return;
              }

              setState({ status: 'terminal-failure', submittedUrl: state.submittedUrl });
              return;
            }
            case 'cancelled': {
              const clearedSnapshot: StoredCurrentTranscription = { version: 1, kind: 'cleared', operationId: state.operationId };

              if (persistCurrentSnapshot(state.operationId, clearedSnapshot)) {
                return;
              }

              setState({
                status: 'error',
                operationId: state.operationId,
                submittedUrl: state.submittedUrl,
                message: cancelledErrorMessage,
                idempotencyKey: null,
                retryAfterUntil: null,
              });
              return;
            }
            case 'not-found':
            case 'invalid-capability': {
              const clearedSnapshot: StoredCurrentTranscription = { version: 1, kind: 'cleared', operationId: state.operationId };

              if (persistCurrentSnapshot(state.operationId, clearedSnapshot)) {
                return;
              }

              setInputValueState('');
              setValidationMessage(null);
              setNoticeMessage(unavailableRestoredMessage);
              setState({ status: 'idle' });
              return;
            }
            case 'unavailable':
            case 'contract-error':
              setState({
                status: 'temporary-interruption',
                operationId: state.operationId,
                submittedUrl: state.submittedUrl,
                links: state.links,
                restored: state.restored,
              });
              return;
          }
        })();
      },
      shouldRetryImmediately ? 0 : pollingIntervalMilliseconds,
    );

    return () => {
      isCurrent = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [immediateRetryVersion, persistCurrentSnapshot, state]);

  const setInputValue = useCallback((value: string) => {
    pendingSubmissionKeyRef.current = null;
    const snapshot = readStoredCurrentTranscription();

    if (snapshot?.kind === 'submitting' && persistedOperationIdRef.current === snapshot.operationId) {
      const clearedSnapshot: StoredCurrentTranscription = {
        version: 1,
        kind: 'cleared',
        operationId: snapshot.operationId,
      };

      if (
        updateStoredCurrentTranscription({
          expectedOperationId: snapshot.operationId,
          snapshot: clearedSnapshot,
        }) === 'written'
      ) {
        persistedOperationIdRef.current = null;
      }
    }

    setInputValueState(value);
    setValidationMessage(null);
    setNoticeMessage(null);
  }, []);

  const selectTranscriptView = useCallback(
    (transcriptView: TranscriptView) => {
      if (
        state.status !== 'succeeded' ||
        state.transcriptView === transcriptView ||
        (transcriptView === 'timestamped' &&
          !state.result.transcript.segments.some((segment) => segment.text.trim().length > 0))
      ) {
        return;
      }

      const completedSnapshot: StoredCurrentTranscription = {
        version: 1,
        kind: 'completed',
        operationId: state.operationId,
        submittedUrl: state.submittedUrl,
        result: state.result,
        transcriptView,
      };

      if (persistedOperationIdRef.current === state.operationId) {
        const storageUpdate = updateStoredCurrentTranscription({
          expectedOperationId: state.operationId,
          snapshot: completedSnapshot,
        });

        if (storageUpdate === 'superseded') {
          applyStoredCurrentTranscription(readStoredCurrentTranscription());
          return;
        }
      }

      setState({ ...state, transcriptView });
    },
    [applyStoredCurrentTranscription, state],
  );

  const cancel = useCallback(() => {
    if (state.status !== 'queued' && state.status !== 'processing' && state.status !== 'temporary-interruption') {
      return;
    }

    pendingSubmissionKeyRef.current = null;
    const cancellationUrl = state.links.cancel;
    const operationId = crypto.randomUUID();
    operationIdRef.current = operationId;
    persistedOperationIdRef.current =
      writeStoredCurrentTranscription({ version: 1, kind: 'cleared', operationId }) === 'written' ? operationId : null;
    setInputValueState('');
    setValidationMessage(null);
    setState({ status: 'idle' });
    setNoticeMessage(null);
    void cancelTranscriptionJob({ cancellationUrl });
  }, [state]);

  const retryStatus = useCallback(() => {
    if (state.status === 'temporary-interruption') {
      setImmediateRetryVersion((version) => version + 1);
    }
  }, [state.status]);

  const editSubmittedUrl = useCallback(() => {
    if (state.status !== 'terminal-failure') {
      return;
    }

    setState({ status: 'idle' });
  }, [state]);

  const submit = useCallback(async () => {
    if (
      state.status === 'error' &&
      state.retryAfterUntil !== null &&
      state.retryAfterUntil > Date.now()
    ) {
      return;
    }

    const trimmedInput = inputValue.trim();

    if (trimmedInput.length === 0) {
      setValidationMessage('Paste a video link to continue.');
      return;
    }

    try {
      const parsedUrl = new URL(trimmedInput);

      if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname.length === 0) {
        setValidationMessage('Use a complete link that starts with https://.');
        return;
      }
    } catch {
      setValidationMessage('Use a complete link that starts with https://.');
      return;
    }

    const priorCancellationUrl =
      state.status === 'queued' || state.status === 'processing' || state.status === 'temporary-interruption'
        ? state.links.cancel
        : null;
    const idempotencyKey =
      state.status === 'error' && pendingSubmissionKeyRef.current !== null
        ? pendingSubmissionKeyRef.current
        : crypto.randomUUID();
    pendingSubmissionKeyRef.current = idempotencyKey;
    const operationId = crypto.randomUUID();
    submissionControllerRef.current?.abort();
    const controller = new AbortController();
    submissionControllerRef.current = controller;
    operationIdRef.current = operationId;
    persistedOperationIdRef.current =
      writeStoredCurrentTranscription({
        version: 1,
        kind: 'submitting',
        operationId,
        submittedUrl: trimmedInput,
        idempotencyKey,
      }) === 'written'
        ? operationId
        : null;
    setInputValueState(trimmedInput);
    setValidationMessage(null);
    setState({ status: 'submitting', operationId, submittedUrl: trimmedInput, idempotencyKey });
    setNoticeMessage(null);

    if (priorCancellationUrl !== null) {
      void cancelTranscriptionJob({ cancellationUrl: priorCancellationUrl });
    }

    const submission = await submitTranscriptionJob({
      sourceUrl: trimmedInput,
      idempotencyKey,
      signal: controller.signal,
    });

    if (
      submissionControllerRef.current !== controller ||
      operationIdRef.current !== operationId ||
      submission.kind === 'aborted'
    ) {
      return;
    }

    submissionControllerRef.current = null;

    switch (submission.kind) {
      case 'accepted': {
        pendingSubmissionKeyRef.current = null;
        const activeSnapshot: StoredCurrentTranscription = {
          version: 1,
          kind: 'active',
          operationId,
          status: 'queued',
          submittedUrl: trimmedInput,
          links: submission.links,
        };

        if (persistCurrentSnapshot(operationId, activeSnapshot)) {
          return;
        }

        setState({
          status: 'queued',
          operationId,
          submittedUrl: trimmedInput,
          links: submission.links,
          restored: false,
        });
        return;
      }
      case 'backend-rejected': {
        pendingSubmissionKeyRef.current = null;
        const clearedSnapshot: StoredCurrentTranscription = { version: 1, kind: 'cleared', operationId };

        if (persistCurrentSnapshot(operationId, clearedSnapshot)) {
          return;
        }

        setState({ status: 'terminal-failure', submittedUrl: trimmedInput });
        return;
      }
      case 'idempotency-conflict': {
        pendingSubmissionKeyRef.current = null;
        const clearedSnapshot: StoredCurrentTranscription = { version: 1, kind: 'cleared', operationId };

        if (persistCurrentSnapshot(operationId, clearedSnapshot)) {
          return;
        }

        setState({
          status: 'error',
          operationId,
          submittedUrl: trimmedInput,
          message: idempotencyConflictMessage,
          idempotencyKey: null,
          retryAfterUntil: null,
        });
        return;
      }
      case 'capacity-exceeded': {
        const retryAfterUntil =
          submission.retryAfterSeconds > 0 ? Date.now() + submission.retryAfterSeconds * 1_000 : null;

        if (retryAfterUntil !== null) {
          window.setTimeout(() => {
            setState((currentState) => {
              if (
                currentState.status !== 'error' ||
                currentState.operationId !== operationId ||
                currentState.retryAfterUntil !== retryAfterUntil
              ) {
                return currentState;
              }

              return { ...currentState, retryAfterUntil: null };
            });
          }, submission.retryAfterSeconds * 1_000);
        }

        setState({
          status: 'error',
          operationId,
          submittedUrl: trimmedInput,
          message: initialOutageMessage,
          idempotencyKey,
          retryAfterUntil,
        });
        return;
      }
      case 'store-unavailable':
      case 'network-unavailable':
      case 'contract-error':
        setState({
          status: 'error',
          operationId,
          submittedUrl: trimmedInput,
          message: initialOutageMessage,
          idempotencyKey,
          retryAfterUntil: null,
        });
        return;
    }
  }, [inputValue, persistCurrentSnapshot, state]);

  return {
    inputValue,
    state,
    validationMessage,
    noticeMessage,
    setInputValue,
    submit,
    cancel,
    retryStatus,
    editSubmittedUrl,
    selectTranscriptView,
  };
};
