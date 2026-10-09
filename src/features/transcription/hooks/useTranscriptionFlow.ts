import { useCallback, useEffect, useRef, useState } from 'react';
import { inspectTranscriptionJob, submitTranscriptionJob } from '../services/transcriptionJobs';
import type { CapabilityLinks, TranscriptionResult } from '../types';

export type TranscriptionFlowState =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'submitting'; submittedUrl: string }>
  | Readonly<{ status: 'queued'; submittedUrl: string; links: CapabilityLinks }>
  | Readonly<{ status: 'processing'; submittedUrl: string; links: CapabilityLinks }>
  | Readonly<{ status: 'succeeded'; submittedUrl: string; result: TranscriptionResult }>
  | Readonly<{ status: 'error'; submittedUrl: string; message: string }>;

export type UseTranscriptionFlowResult = Readonly<{
  inputValue: string;
  state: TranscriptionFlowState;
  validationMessage: string | null;
  setInputValue: (value: string) => void;
  submit: () => Promise<void>;
}>;

const submissionErrorMessage = "Textify couldn't start this transcript. Check the link and try again.";
const statusErrorMessage = "Textify couldn't check for updates. Submit the link again.";
const failedErrorMessage = "Textify couldn't turn this link into text. Check the link and try again.";
const cancelledErrorMessage = 'This transcription was cancelled. Submit the link again when you\'re ready.';
const pollingIntervalMilliseconds = 2_000;

export const useTranscriptionFlow = (): UseTranscriptionFlowResult => {
  const [inputValue, setInputValueState] = useState('');
  const [state, setState] = useState<TranscriptionFlowState>({ status: 'idle' });
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const submissionControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      submissionControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (state.status !== 'queued' && state.status !== 'processing') {
      return;
    }

    let isCurrent = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        const inspection = await inspectTranscriptionJob({ statusUrl: state.links.self, signal: controller.signal });

        if (!isCurrent || inspection.kind === 'aborted') {
          return;
        }

        switch (inspection.kind) {
          case 'queued':
            setState({ status: 'queued', submittedUrl: state.submittedUrl, links: inspection.links });
            return;
          case 'processing':
            setState({ status: 'processing', submittedUrl: state.submittedUrl, links: inspection.links });
            return;
          case 'succeeded':
            setState({ status: 'succeeded', submittedUrl: state.submittedUrl, result: inspection.result });
            return;
          case 'failed':
            setState({ status: 'error', submittedUrl: state.submittedUrl, message: failedErrorMessage });
            return;
          case 'cancelled':
            setState({ status: 'error', submittedUrl: state.submittedUrl, message: cancelledErrorMessage });
            return;
          case 'unavailable':
          case 'contract-error':
            setState({ status: 'error', submittedUrl: state.submittedUrl, message: statusErrorMessage });
            return;
        }
      })();
    }, pollingIntervalMilliseconds);

    return () => {
      isCurrent = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [state]);

  const setInputValue = useCallback((value: string) => {
    setInputValueState(value);
    setValidationMessage(null);
  }, []);

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

    submissionControllerRef.current?.abort();
    const controller = new AbortController();
    submissionControllerRef.current = controller;
    setInputValueState(trimmedInput);
    setValidationMessage(null);
    setState({ status: 'submitting', submittedUrl: trimmedInput });

    const submission = await submitTranscriptionJob({ sourceUrl: trimmedInput, signal: controller.signal });

    if (submissionControllerRef.current !== controller || submission.kind === 'aborted') {
      return;
    }

    submissionControllerRef.current = null;

    switch (submission.kind) {
      case 'accepted':
        setState({ status: 'queued', submittedUrl: trimmedInput, links: submission.links });
        return;
      case 'backend-rejected':
        setState({ status: 'error', submittedUrl: trimmedInput, message: submissionErrorMessage });
        return;
      case 'unavailable':
      case 'contract-error':
        setState({ status: 'error', submittedUrl: trimmedInput, message: statusErrorMessage });
        return;
    }
  }, [inputValue]);

  return { inputValue, state, validationMessage, setInputValue, submit };
};
