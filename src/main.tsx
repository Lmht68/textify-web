import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import { LandingPage } from './pages/Landing/LandingPage';
const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Textify root element is missing.');
}

createRoot(rootElement).render(
  <StrictMode>
    <LandingPage />
  </StrictMode>,
);
