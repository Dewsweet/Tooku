import { useContext, useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Minus, Plus, RefreshCw, Search } from 'lucide-react';
import { Modal } from '../../components/Modal';
import { Select } from '../../components/Select';
import { formatTime, IconButton, QueryState, useApi } from '../../components/Common';
import { normalizeLyrics } from '../../domain/lyrics/normalize';
import { providerNames, type LyricCandidate, type LyricEdit, type LyricLayout, type ProviderId } from '../../domain/lyrics/types';
import type { Track } from '../../domain/models';
import { describeTrack, LyricsApiContext, useLyrics } from './useLyrics';

type LyricsData = ReturnType<typeof useLyrics>;
type SettingsTab = 'display' | 'versions';
export function LyricsSettingsDialog({ track, data, onSave, onSelect, onRecommend, onReload, onClose }: {
  track: Track; data: LyricsData;
  onSave: (edit?: LyricEdit) => void; onSelect: (candidate: LyricCandidate) => void;
  onRecommend: (provider: ProviderId) => void; onReload: () => void; onClose: () => void;
}) {
  const canDisplay = Boolean(data.document && data.lyrics?.lines.length);
  const [tab, setTab] = useState<SettingsTab>(canDisplay ? 'display' : 'versions');
  const [draft, setDraft] = useState<LyricEdit>(data.edit ?? { layout: 'auto', hash: data.hash });
  const preview = useMemo(() => data.document ? normalizeLyrics(data.document, draft) : undefined, [data.document, draft]);
  const id = useId();
  const offset = (delta: number) => setDraft((value) => ({ ...value, delayMs: Math.max(-600000, Math.min(600000, (value.delayMs ?? 0) + delta)) }));
  return <Modal title="歌词设置" className="lyrics-settings-modal" onClose={onClose}>
    <div className="lyric-settings-tabs" role="tablist" aria-label="歌词设置分类" onKeyDown={(event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      if (!canDisplay || !data.settings.enabled) return;
      event.preventDefault();
      const next = data.document && (event.key === 'Home' || tab === 'versions' && event.key !== 'End') ? 'display' : 'versions';
      setTab(next); event.currentTarget.querySelector<HTMLButtonElement>(`[id="${id}-${next}-tab"]`)?.focus();
    }}>
      {(['display', 'versions'] as const).map((item) => <button key={item} id={`${id}-${item}-tab`} type="button" role="tab" aria-selected={tab === item} aria-controls={`${id}-${item}`} tabIndex={tab === item ? 0 : -1} disabled={item === 'display' ? !canDisplay : !data.settings.enabled} onClick={() => setTab(item)}>{item === 'display' ? '显示' : '版本'}</button>)}
    </div>
    {tab === 'display' && data.document && <form id={`${id}-display`} role="tabpanel" aria-labelledby={`${id}-display-tab`} className="lyric-display-settings" onSubmit={(event) => { event.preventDefault(); onSave({ ...draft, hash: data.hash }); }}>
      <div className="lyric-settings-row"><label htmlFor={`${id}-layout`}>双语格式</label><Select id={`${id}-layout`} aria-label="双语格式" value={draft.layout} onChange={(layout) => setDraft({ ...draft, layout: layout as LyricLayout })}>
        <option value="auto">识别双语</option><option value="original">保留原文</option><option value="inline">原文与译文同行</option><option value="alternating">原文与译文交替</option><option value="halves">原文在前，译文在后</option>
      </Select></div>
      {draft.layout === 'inline' && <div className="lyric-settings-row"><label htmlFor={`${id}-separator`}>分隔符</label><input id={`${id}-separator`} aria-label="歌词分隔符" maxLength={16} value={draft.separator ?? ''} placeholder="空格或 /" onChange={(event) => setDraft({ ...draft, separator: event.target.value || undefined })} /></div>}
      {draft.layout === 'halves' && <div className="lyric-settings-row"><label htmlFor={`${id}-split`}>原文行数</label><input id={`${id}-split`} type="number" min={1} max={10000} value={draft.splitAt ?? ''} placeholder="对半分段" onChange={(event) => setDraft({ ...draft, splitAt: event.target.value ? Math.max(1, Math.min(10000, Math.round(Number(event.target.value)))) : undefined })} /></div>}
      <label className="lyric-settings-row"><span>显示译文</span><input type="checkbox" className="lyric-toggle" checked={draft.showTranslation !== false} onChange={(event) => setDraft({ ...draft, showTranslation: event.target.checked })} /></label>
      <label className="lyric-settings-row"><span>显示罗马音</span><input type="checkbox" className="lyric-toggle" checked={Boolean(draft.showRomanization)} onChange={(event) => setDraft({ ...draft, showRomanization: event.target.checked })} /></label>
      <div className="lyric-settings-row"><label htmlFor={`${id}-offset`}>同步偏移</label><div className="lyric-offset-control">
        <IconButton label="歌词提前 0.1 秒" onClick={() => offset(-100)}><Minus size={16} /></IconButton>
        <input id={`${id}-offset`} aria-label="歌词偏移秒数" type="number" min={-600} max={600} step={.1} value={Number(((draft.delayMs ?? 0) / 1000).toFixed(1))} onChange={(event) => { const seconds = Number(event.target.value); if (Number.isFinite(seconds)) setDraft({ ...draft, delayMs: Math.round(Math.max(-600, Math.min(600, seconds)) * 1000) }); }} /><span>秒</span>
        <IconButton label="歌词延后 0.1 秒" onClick={() => offset(100)}><Plus size={16} /></IconButton>
      </div></div>
      <div className="lyric-preview" aria-label="歌词显示预览">{preview?.lines.filter((line) => line.text.trim()).slice(0, 3).map((line, i) => <p key={i}>{line.text}{draft.showRomanization && line.romanization?.map((text, j) => <span key={`r-${j}`}>{text}</span>)}{draft.showTranslation !== false && line.translation?.map((text, j) => <span key={j}>{text}</span>)}</p>)}</div>
      <footer className="lyric-dialog-footer"><button type="button" className="text-button" onClick={() => onSave()}>重置显示</button><button className="primary-button">保存</button></footer>
    </form>}
    {tab === 'versions' && <div id={`${id}-versions`} role="tabpanel" aria-labelledby={`${id}-versions-tab`}>
      <LyricVersions track={track} data={data} onSelect={onSelect} onRecommend={onRecommend} />
    </div>}
    <div className="lyric-reload-row"><button type="button" className="text-button" disabled={data.loading} onClick={onReload}><RefreshCw size={15} />刷新歌词</button></div>
  </Modal>;
}
function LyricVersions({ track, data, onSelect, onRecommend }: { track: Track; data: LyricsData; onSelect: (candidate: LyricCandidate) => void; onRecommend: (provider: ProviderId) => void }) {
  const api = useApi(); const network = useContext(LyricsApiContext);
  const [provider, setProvider] = useState<ProviderId>(data.source !== 'local' && data.settings.order.includes(data.source) ? data.source : data.settings.order[0]);
  const [keyword, setKeyword] = useState(`${track.title} ${track.artist}`);
  const [submitted, setSubmitted] = useState(keyword); const [attempt, setAttempt] = useState(0);
  const query = useQuery({ queryKey: [api.identity, 'lyric-candidates', describeTrack(track), provider, submitted, attempt], retry: false, enabled: data.settings.enabled, queryFn: ({ signal }) => network.search(describeTrack(track), [provider], signal, true, submitted) });
  return <>
    <form className="lyric-search" onSubmit={(event) => { event.preventDefault(); if (keyword.trim()) { setSubmitted(keyword.trim()); setAttempt((n) => n + 1); } }}>
      <Select aria-label="歌词平台" value={provider} onChange={(value) => { if (value === 'netease' || value === 'qq') setProvider(value); }}>{data.settings.order.map((item) => <option key={item} value={item}>{providerNames[item]}</option>)}</Select>
      <div className="lyric-search-field"><Search size={17} /><input aria-label="搜索歌词" value={keyword} maxLength={512} onChange={(event) => setKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }} /></div>
      <button className="subtle-button" disabled={!keyword.trim() || query.isFetching}>搜索</button>
    </form>
    <QueryState pending={query.isPending && data.settings.enabled} error={null} pendingText="正在搜索歌词…" />
    {!query.isPending && !query.data?.candidates.length && <p className="lyric-empty">没有找到歌词版本</p>}
    <div className="lyric-candidates">{query.data?.candidates.map((candidate) => {
      const selected = data.document?.source === candidate.provider && data.document.recordId === candidate.id;
      return <button key={`${candidate.provider}-${candidate.id}`} aria-pressed={selected} onClick={() => onSelect(candidate)}>
        <span className="lyric-version-copy"><strong>{candidate.title}</strong><span>{candidate.artists.join(' / ')}{candidate.album ? ` · ${candidate.album}` : ''}</span></span>
        <span className="lyric-version-duration">{candidate.durationMs ? formatTime(candidate.durationMs / 1000) : ''}</span>{selected && <Check size={18} />}
      </button>;
    })}</div>
    {data.choice?.bindings?.[provider] && <footer className="lyric-dialog-footer"><button type="button" className="text-button" onClick={() => onRecommend(provider)}>恢复推荐版本</button></footer>}
  </>;
}
