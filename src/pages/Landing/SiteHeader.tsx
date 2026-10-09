export const SiteHeader = () => {
  return (
    <header className="site-header">
      <a className="brand" href="#top" aria-label="Textify home">
        <span className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M7 8h10M7 12h7M7 16h9" />
          </svg>
        </span>
        <span>Textify</span>
      </a>
      <a className="header-link" href="#how-it-works">
        How it works
      </a>
    </header>
  );
};
