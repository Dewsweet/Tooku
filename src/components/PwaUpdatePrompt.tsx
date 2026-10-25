import { installPwaUpdate, usePwa } from '../pwa';

export function PwaUpdatePrompt() {
  const available = usePwa((state) => state.updateAvailable);
  const dismiss = usePwa((state) => state.dismiss);
  if (!available) return null;
  return <div className="pwa-update" role="status" aria-live="polite"><span>Tooku 已有新版本</span><button className="primary-button" onClick={installPwaUpdate}>更新并刷新</button><button className="text-button" onClick={dismiss}>稍后</button></div>;
}
