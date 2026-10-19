import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { Interactions } from './components/Interactions';
import { queryClient } from './state/session';
import './styles.css';
import './features/player/player.css';
import './workspace.css';
import './browse.css';
import './interactions.css';

createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={queryClient}><BrowserRouter><Interactions><App /></Interactions></BrowserRouter></QueryClientProvider></StrictMode>);
