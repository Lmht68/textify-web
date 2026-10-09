type FeatureCard = {
  readonly title: string;
  readonly description: string;
  readonly icon: 'paragraphs' | 'search' | 'export';
};

const featureCards = [
  {
    title: 'Easy-to-read paragraphs',
    description: 'Long transcripts are split into short, easy-to-read paragraphs, each with its timestamp.',
    icon: 'paragraphs',
  },
  {
    title: 'Search inside the transcript',
    description: 'Find any word, see every match highlighted and jump between them.',
    icon: 'search',
  },
  {
    title: 'Copy or export',
    description: 'Copy the text or save a .txt file, with or without timestamps.',
    icon: 'export',
  },
] as const satisfies ReadonlyArray<FeatureCard>;

const steps = [
  {
    title: 'Paste a link',
    description: 'Add the link to a public video from a supported platform.',
  },
  {
    title: 'We transcribe it',
    description: 'It runs in the background, so you can keep this tab open.',
  },
  {
    title: 'Read, search, export',
    description: 'Get a timestamped transcript in short paragraphs. Search it, copy it or export a .txt file.',
  },
] as const;

const FeatureIcon = ({ icon }: Pick<FeatureCard, 'icon'>) => {
  if (icon === 'paragraphs') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 7h14M5 11h10M5 15h14M5 19h8" />
      </svg>
    );
  }

  if (icon === 'search') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="5.5" />
        <path d="m15 15 4 4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v10M8 10l4 4 4-4M5 19h14" />
    </svg>
  );
};

export const LandingInformation = () => {
  return (
    <>
      <section className="reading-section" aria-labelledby="reading-heading">
        <div className="landing-information">
          <h2 id="reading-heading" className="section-title">
            Made for reading
          </h2>
          <div className="feature-grid">
            {featureCards.map((feature) => (
              <article className="feature-card" key={feature.title}>
                <span className="feature-icon">
                  <FeatureIcon icon={feature.icon} />
                </span>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section id="how-it-works" className="steps-section" aria-labelledby="how-it-works-heading">
        <div className="landing-information">
          <h2 id="how-it-works-heading">How it works</h2>
          <p className="steps-intro">Turn any public video into a searchable transcript in three steps.</p>
          <ol className="steps-grid">
            {steps.map((step, index) => (
              <li className="step-card" key={step.title}>
                <span className="step-number" aria-hidden="true">
                  {index + 1}
                </span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
};
