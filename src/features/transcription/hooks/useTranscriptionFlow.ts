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
  | Readonly<{ status: 'submitting'; operationId: string; submittedUrl: string }>
  | Readonly<{ status: 'queued'; operationId: string; submittedUrl: string; links: CapabilityLinks; restored: boolean }>
  | Readonly<{ status: 'processing'; operationId: string; submittedUrl: string; links: CapabilityLinks; restored: boolean }>
  | Readonly<{
      status: 'succeeded';
      operationId: string;
      submittedUrl: string;
      result: TranscriptionResult;
      transcriptView: TranscriptView;
    }>
  | Readonly<{ status: 'error'; submittedUrl: string; message: string }>;

export type UseTranscriptionFlowResult = Readonly<{
  inputValue: string;
  state: TranscriptionFlowState;
  validationMessage: string | null;
  setInputValue: (value: string) => void;
  noticeMessage: string | null;
  submit: () => Promise<void>;
  cancel: () => void;
  selectTranscriptView: (transcriptView: TranscriptView) => void;
}>;

const submissionErrorMessage = "Textify couldn't start this transcript. Check the link and try again.";
const unavailableRestoredMessage = 'That transcription is no longer available. Paste the link again to start over.';
const statusErrorMessage = "Textify couldn't check for updates. Submit the link again.";
const failedErrorMessage = "Textify couldn't turn this link into text. Check the link and try again.";
const cancelledErrorMessage = 'This transcription was cancelled. Submit the link again when you\'re ready.';
const pollingIntervalMilliseconds = 2_000;

const stateFromStoredCurrentTranscription = (snapshot: StoredCurrentTranscription | null): TranscriptionFlowState => {
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
  return snapshot?.kind === 'active' || snapshot?.kind === 'completed' ? snapshot.submittedUrl : '';
};

const operationIdFromStoredCurrentTranscription = (snapshot: StoredCurrentTranscription | null): string | null => {
  return snapshot?.operationId ?? null;
};

export const useTranscriptionFlow = (): UseTranscriptionFlowResult => {
  const [initialSnapshot] = useState<StoredCurrentTranscription | null>(readStoredCurrentTranscription);
  const [inputValue, setInputValueState] = useState(() => inputFromStoredCurrentTranscription(initialSnapshot));
  const [state, setState] = useState<TranscriptionFlowState>(() => stateFromStoredCurrentTranscription(initialSnapshot));
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const submissionControllerRef = useRef<AbortController | null>(null);
  const operationIdRef = useRef(operationIdFromStoredCurrentTranscription(initialSnapshot));
  const persistedOperationIdRef = useRef(operationIdFromStoredCurrentTranscription(initialSnapshot));

  const applyStoredCurrentTranscription = useCallback((snapshot: StoredCurrentTranscription | null) => {
    operationIdRef.current = operationIdFromStoredCurrentTranscription(snapshot);
    persistedOperationIdRef.current = operationIdFromStoredCurrentTranscription(snapshot);
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
    if (state.status !== 'queued' && state.status !== 'processing') {
      return;
    }

    let isCurrent = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
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
          case 'failed':
          case 'cancelled': {
            const errorMessage = inspection.kind === 'failed' ? failedErrorMessage : cancelledErrorMessage;
            const clearedSnapshot: StoredCurrentTranscription = { version: 1, kind: 'cleared', operationId: state.operationId };

            if (persistCurrentSnapshot(state.operationId, clearedSnapshot)) {
              return;
            }

            setState({ status: 'error', submittedUrl: state.submittedUrl, message: errorMessage });
            return;
          }
          case 'unavailable':
          case 'contract-error': {
            if (state.restored) {
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

            setState({ status: 'error', submittedUrl: state.submittedUrl, message: statusErrorMessage });
            return;
          }
        }
      })();
    }, pollingIntervalMilliseconds);

    return () => {
      isCurrent = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [persistCurrentSnapshot, state]);

  const setInputValue = useCallback((value: string) => {
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
    if (state.status !== 'queued' && state.status !== 'processing') {
      return;
    }

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

  const submit = useCallback(async () => {
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

    const priorCancellationUrl = state.status === 'queued' || state.status === 'processing' ? state.links.cancel : null;
    const operationId = crypto.randomUUID();
    submissionControllerRef.current?.abort();
    const controller = new AbortController();
    submissionControllerRef.current = controller;
    operationIdRef.current = operationId;
    persistedOperationIdRef.current =
      writeStoredCurrentTranscription({ version: 1, kind: 'submitting', operationId, submittedUrl: trimmedInput }) === 'written'
        ? operationId
        : null;
    setInputValueState(trimmedInput);
    setValidationMessage(null);
    setState({ status: 'submitting', operationId, submittedUrl: trimmedInput });
    setNoticeMessage(null);

    if (priorCancellationUrl !== null) {
      void cancelTranscriptionJob({ cancellationUrl: priorCancellationUrl });
    }

    const submission = await submitTranscriptionJob({ sourceUrl: trimmedInput, signal: controller.signal });

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
      case 'backend-rejected':
      case 'unavailable':
      case 'contract-error': {
        const errorMessage = submission.kind === 'backend-rejected' ? submissionErrorMessage : statusErrorMessage;
        const clearedSnapshot: StoredCurrentTranscription = { version: 1, kind: 'cleared', operationId };

        if (persistCurrentSnapshot(operationId, clearedSnapshot)) {
          return;
        }

        setState({ status: 'error', submittedUrl: trimmedInput, message: errorMessage });
        return;
      }
    }
  }, [inputValue, persistCurrentSnapshot, state]);

  return { inputValue, state, validationMessage, noticeMessage, setInputValue, submit, cancel, selectTranscriptView };
};
