import { MusicApi } from '../../api/client';
import { useSession } from '../../state/session';
import { connectUserSync, disconnectUserSync, useUserSync } from '../../storage/userSync';
import { player } from '../player/engine';
import { browserStorageWarning } from '../../storage/browserStorage';

// Called once before mounting the workspace, outside StrictMode's effect lifecycle.
export async function restoreWorkspace() {
  let api: MusicApi | undefined;
  try {
    const restored = await MusicApi.restoreSession();
    if (!restored) return;
    api = restored.api;
    await connectUserSync(api); await player.attach(api);
    useSession.getState().setSession(api, restored.version);
    const sync = useUserSync.getState();
    const syncWarning = ['review', 'offline'].includes(sync.status) ? `${sync.message} 入口：头像 → 账户与设置 → 用户数据。` : '';
    useSession.getState().notify([syncWarning, browserStorageWarning()].filter(Boolean).join(' '));
  } catch {
    api?.dispose(); disconnectUserSync(); player.logout();
    useSession.getState().notify(navigator.onLine === false ? '当前离线，Navidrome 暂不可用。连接网络后可重新登录，原有账号数据仍保留。' : '自动登录暂未完成，请重新登录。原有账号数据仍保留。');
  }
}
