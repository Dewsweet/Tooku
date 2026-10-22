import { useContext, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Select } from '../../components/Select';
import { QueryState, useApi } from '../../components/Common';
import { LyricsApiContext } from '../lyrics/useLyrics';
import { defaultLyricsSettings, providerIds, providerNames, type ProviderObservation } from '../../domain/lyrics/types';
import { useLyricsProfiles } from '../../state/lyrics';
import { SettingsSection } from './SettingsSection';

function observation(value: ProviderObservation) {
  if (!value.checkedAt || Date.now() - value.checkedAt > 1800000) return '未检测';
  if (value.error) return ({ timeout: '请求超时', 'rate-limited': '限流', 'login-required': '需要登录', unavailable: '暂不可用', protocol: '返回异常', disabled: '已停用' })[value.error];
  return value.successAt && Date.now() - value.successAt <= 1800000 ? '可用' : '未验证';
}
function signal(label: string) {
  return label === '可用' ? 'available' : ['未检测', '未验证', '已停用'].includes(label) ? 'unknown' : 'error';
}
const date = (time?: number) => time ? new Date(time).toLocaleString('zh-CN') : '尚无记录';

export function NetworkLyricsSettings() {
  const api = useApi();
  const network = useContext(LyricsApiContext);
  const client = useQueryClient();
  const settings = useLyricsProfiles((s) => s.profiles[api.identity] ?? defaultLyricsSettings);
  const update = useLyricsProfiles((s) => s.update);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const checking = useRef<AbortController | null>(null);
  useEffect(() => () => checking.current?.abort(), []);
  const query = useQuery({
    queryKey: ['lyrics-service-status'],
    queryFn: ({ signal }) => network.status(signal),
    retry: false,
    staleTime: 30000,
    // Reading observations never probes the platforms; refresh aging labels while visible.
    refetchInterval: 60000,
  });
  async function check() {
    checking.current?.abort();
    const controller = new AbortController(); checking.current = controller;
    setBusy(true); setError('');
    try {
      const status = await network.check(settings.order, controller.signal);
      if (!controller.signal.aborted) client.setQueryData(['lyrics-service-status'], status);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '检测失败');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return <SettingsSection title="网络歌词">
    <label className="setting-row">
      <span className="setting-copy"><strong>启用网络歌词</strong><span className="setting-description">优先读取本地歌词，明确缺失时自动查询网络来源。</span></span>
      <input aria-label="启用网络歌词" className="settings-switch" role="switch" type="checkbox" checked={settings.enabled} onChange={(e) => update(api.identity, (s) => ({ ...s, enabled: e.target.checked }))} />
    </label>
    <div className="setting-row">
      <strong>来源优先顺序</strong>
      <Select aria-label="歌词来源优先顺序" value={settings.order.join(',')} onChange={(value) => update(api.identity, (s) => ({ ...s, order: value.split(',').filter((p): p is 'netease' | 'qq' => p === 'netease' || p === 'qq') }))}>
        <option value="netease,qq">网易云 → QQ 音乐</option>
        <option value="qq,netease">QQ 音乐 → 网易云</option>
        <option value="netease">仅网易云</option>
        <option value="qq">仅 QQ 音乐</option>
      </Select>
    </div>
    <div className="settings-subsection"><h3>服务与来源</h3>
    <QueryState pending={query.isPending} error={query.error} retry={() => query.refetch()} pendingText="正在连接歌词服务…" />
    {query.data && <div className="settings-status-row">
      <span className="settings-status" role="status">{query.data.enabled ? query.data.cache === 'memory' ? '服务运行中 · 内存缓存' : '服务运行中' : '服务已停用'}</span>
      <button className="subtle-button" disabled={busy || !settings.enabled || !query.data.enabled} onClick={check}>{busy ? '检测中…' : '检测'}</button>
    </div>}
    {providerIds.map((id) => {
      const state = query.data?.providers.find((p) => p.id === id);
      const label = (kind: 'search' | 'lyrics') => query.data?.enabled === false ? '已停用' : state ? observation(state[kind]) : '未检测';
      return <div className="setting-row lyrics-service-row" key={id}>
        <strong>{providerNames[id]}</strong>
        <div className="lyrics-service-status" role="status">{(['search', 'lyrics'] as const).map((kind) => {
          const status = label(kind);
          return <span className="lyrics-service-signal" key={kind} data-state={signal(status)} data-tooltip={status} aria-label={`${kind === 'search' ? '搜索' : '歌词'}：${status}`}><span className="status-light" aria-hidden="true" />{kind === 'search' ? '搜索' : '歌词'}<span className="lyrics-signal-label">{status}</span></span>;
        })}</div>
        {state && <details>
          <summary>检测详情</summary>
          {(['search', 'lyrics'] as const).map((kind) => <div key={kind}>
            <p>{kind === 'search' ? '搜索' : '歌词'} · {date(state[kind].checkedAt)}{state[kind].elapsedMs !== undefined ? ` · ${state[kind].elapsedMs} ms` : ''}</p>
            <p>状态 · {label(kind)}</p>
            <p>上次成功 · {date(state[kind].successAt)}</p>
          </div>)}
        </details>}
      </div>;
    })}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </SettingsSection>;
}
