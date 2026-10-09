import { useEffect, useRef } from 'react';
import type { FormEvent } from 'react';

type SupportedPlatform = 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'x';

type TranscriptionFormProps = Readonly<{
  inputValue: string;
  isWorking: boolean;
  validationMessage: string | null;
  onInputValueChange: (value: string) => void;
  onSubmit: () => Promise<void>;
}>;

const supportedPlatforms = [
  { name: 'YouTube', icon: 'youtube' },
  { name: 'TikTok', icon: 'tiktok' },
  { name: 'Instagram', icon: 'instagram' },
  { name: 'Facebook', icon: 'facebook' },
  { name: 'X', icon: 'x' },
] as const satisfies ReadonlyArray<{ readonly name: string; readonly icon: SupportedPlatform }>;

const PlatformIcon = ({ platform }: { readonly platform: SupportedPlatform }) => {
  if (platform === 'youtube') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.5" y="6.5" width="17" height="11" rx="3" />
        <path fill="currentColor" stroke="none" d="m10 9.5 5 2.5-5 2.5z" />
      </svg>
    );
  }

  if (platform === 'tiktok') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14 4v10a3.5 3.5 0 1 1-3.5-3.5" />
        <path d="M14 4c.6 2.1 1.9 3.4 4 3.8" />
      </svg>
    );
  }

  if (platform === 'instagram') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="4.5" />
        <circle cx="12" cy="12" r="3.5" />
        <path d="M17.5 6.5h.01" />
      </svg>
    );
  }

  if (platform === 'facebook') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14.5 20v-7h2.5l.5-3h-3v-1.5c0-1 .3-1.7 1.8-1.7H18V4.1c-.7-.1-1.5-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4V10H9v3h2.8v7" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4l14 16M19 4 5 20" />
    </svg>
  );
};

export const TranscriptionForm = ({ inputValue, isWorking, validationMessage, onInputValueChange, onSubmit }: TranscriptionFormProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (validationMessage !== null) {
      inputRef.current?.focus();
    }
  }, [validationMessage]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSubmit();
  };

  return (
    <>
      <form className="transcription-form" onSubmit={handleSubmit} noValidate>
        <label className="visually-hidden" htmlFor="video-link">
          Video link
        </label>
        <input
          ref={inputRef}
          id="video-link"
          className="transcription-input"
          name="video-link"
          type="url"
          autoComplete="url"
          placeholder="Paste a video link"
          value={inputValue}
          onChange={(event) => onInputValueChange(event.target.value)}
          aria-invalid={validationMessage !== null}
          aria-describedby={validationMessage === null ? undefined : 'video-link-validation'}
          disabled={isWorking}
        />
        <button className="transcription-submit" type="submit" disabled={isWorking}>
          {isWorking ? 'Working...' : 'Transcribe'}
        </button>
      </form>
      {validationMessage === null ? null : (
        <p id="video-link-validation" className="validation-message" role="alert">
          {validationMessage}
        </p>
      )}
      <p className="hero-note">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 7v5l3 2" />
        </svg>
        Videos can be up to 30 minutes long.
      </p>
      <ul className="platform-list" aria-label="Supported platforms">
        {supportedPlatforms.map((platform) => (
          <li key={platform.name}>
            <span className="platform-mark" aria-hidden="true">
              <PlatformIcon platform={platform.icon} />
            </span>
            <span className="visually-hidden">{platform.name}</span>
          </li>
        ))}
      </ul>
    </>
  );
};
