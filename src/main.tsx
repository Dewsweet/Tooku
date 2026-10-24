import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { Interactions } from './components/Interactions';
import { WorkspaceBoundary } from './components/WorkspaceBoundary';
import { queryClient } from './state/session';
import { fontFamilyCss, normalizeBaseFontSize, useDisplayPreferences } from './state/display';
import './fonts.css';
import './styles.css';
import './features/player/player.css';
import './workspace.css';
import './browse.css';
import './interactions.css';
import './scrollbars.css';
import { restoreWorkspace } from './features/session/restoreSession';
import { PwaUpdatePrompt } from './components/PwaUpdatePrompt';
import { registerPwa } from './pwa';

// Apply the saved face before rendering text so a serif/system choice does not fetch the default font first.
const display = useDisplayPreferences.getState();
document.documentElement.style.setProperty('--ui-font-family', fontFamilyCss(display.fontFamily));
document.documentElement.style.setProperty('--ui-font-scale', String(normalizeBaseFontSize(display.baseFontSize) / 14));
const root = createRoot(document.getElementById('root')!);
root.render(<div className="loading" role="status">正在恢复登录…</div>);
void restoreWorkspace().finally(() => root.render(<StrictMode><QueryClientProvider client={queryClient}><BrowserRouter><WorkspaceBoundary><Interactions><App /></Interactions></WorkspaceBoundary><PwaUpdatePrompt /></BrowserRouter></QueryClientProvider></StrictMode>));
void registerPwa().catch(() => { /* Installation support must not block the web player. */ });
