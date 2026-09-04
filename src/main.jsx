import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { StoreProvider } from './lib/store.jsx';
import './styles/global.css';

// HashRouter: static hosts (Render) serve only `/`, so hash URLs keep every
// route (refresh, deep link, share) working without server-side rewrites.
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <StoreProvider>
          <App />
        </StoreProvider>
      </HashRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
