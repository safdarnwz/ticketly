import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import './index.css';
// Initialise the auth ↔ api-client wiring (side-effect import).
import './stores/auth';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
