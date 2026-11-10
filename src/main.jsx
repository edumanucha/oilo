import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './components/InstallButton.jsx';
import './styles.css';
import { initUpdater } from './lib/updater.js';

initUpdater();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
