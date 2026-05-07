import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { reportError } from './lib/errorReporter';

window.addEventListener('error', (e) => {
  const err = e.error as Error | undefined;
  reportError(err?.name ?? 'Error', e.message ?? 'Unknown error', err?.stack);
});

window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  const name = r?.name ?? 'UnhandledRejection';
  const message =
    typeof r === 'string' ? r : r?.message ?? (r === undefined ? 'undefined' : String(r));
  reportError(name, message, r?.stack);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
