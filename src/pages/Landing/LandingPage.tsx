import { TranscriptionFlow } from '../../features/transcription';
import { LandingInformation } from './LandingInformation';
import { SiteHeader } from './SiteHeader';

export const LandingPage = () => {
  return (
    <>
      <a className="skip-link" href="#transcription-form">
        Skip to transcription form
      </a>
      <SiteHeader />
      <main id="top">
        <section className="landing-hero" aria-labelledby="landing-heading">
          <div className="hero-content">
            <p className="hero-kicker">VIDEO TO TEXT</p>
            <h1 id="landing-heading" className="hero-title">
              Paste a link, get a transcript
            </h1>
            <p className="hero-description">Turn any public video into a searchable transcript with timestamps, split into easy-to-read paragraphs.</p>
            <TranscriptionFlow />
          </div>
        </section>
        <LandingInformation />
      </main>
    </>
  );
};
