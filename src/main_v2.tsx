import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App_v2.tsx';
// Cache bust: 2
import './index_v2.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
