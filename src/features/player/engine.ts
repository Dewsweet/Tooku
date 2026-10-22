import { create } from 'zustand';
import type { MusicApi } from '../../api/client';
import type { HistoryEntry, PlaybackSource, PlayerSnapshot, QueueEntry, Track } from '../../domain/models';
import { entriesFor, moveEntry, nextEntry, samePlaybackSource, shouldScrobble, shuffled } from '../../domain/queue';
import { isPlaybackSource, isSourceIndex } from '../../domain/userData';
import { readProfile, saveProfile } from '../../storage/local';
import { useSession } from '../../state/session';
import { createId } from '../../domain/ids';

type Status = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'blocked' | 'error';
type QueueSnapshot = Pick<PlayerSnapshot, 'entries' | 'currentId' | 'position' | 'shuffle' | 'originalOrder'>;
interface PlayerState {
  entries: QueueEntry[]; currentId: string | null; status: Status; position: number; duration: number;
  repeat: 'off' | 'all' | 'one'; shuffle: boolean; volume: number; error: string;
  mode: 'original' | 'compatible'; history: HistoryEntry[]; volumeSupported: boolean;
  undo: QueueSnapshot | null;
}
const initial: PlayerState = { entries: [], currentId: null, status: 'idle', position: 0, duration: 0, repeat: 'off', shuffle: false, volume: 0.7, error: '', mode: 'original', history: [], volumeSupported: true, undo: null };
export const usePlayer = create<PlayerState>(() => ({ ...initial }));
const update = (patch: Partial<PlayerState>) => usePlayer.setState(patch);
export const currentEntry = () => { const s = usePlayer.getState(); return s.entries.find((e) => e.entryId === s.currentId); };

class PlayerEngine {
  #audio: HTMLAudioElement | null = null;
  #api: MusicApi | null = null;
  #generation = 0;
  #source = '';
  #intent = false;
  #resume = 0;
  #previousTime = 0;
  #listened = 0;
  #occurrenceId = '';
  #startedAt = 0;
  #submission: 'none' | 'pending' | 'done' | 'unknown' = 'none';
  #announced = false;
  #lastSave = 0;
  #back: string[] = [];
  #originalOrder: string[] = [];
  #insertCursor: string | null = null;
  #mediaEnabled = false;
  #lastReport = 0;
  #channel: BroadcastChannel | null = null;
  #tabId = createId();
  connectedTo(api: MusicApi) { return this.#api === api; }
  currentTime() { return this.#source && this.#audio ? this.#audio.currentTime : usePlayer.getState().position; }

  #init() {
    if (this.#audio) return;
    const audio = new Audio(); this.#audio = audio; audio.preload = 'metadata';
    const active = () => Boolean(this.#source && audio.getAttribute('src') === this.#source && (!audio.currentSrc || audio.currentSrc === this.#source) && this.#api);
    audio.addEventListener('loadedmetadata', () => {
      if (!active()) return;
      update({ duration: Number.isFinite(audio.duration) ? audio.duration : currentEntry()?.track.duration ?? 0 });
      if (this.#resume > 0) { const resume = Math.min(this.#resume, usePlayer.getState().duration || this.#resume); try { audio.currentTime = resume; this.#previousTime = resume; } catch { useSession.getState().notify('此音频无法恢复到上次位置，请手动定位。'); } this.#resume = 0; }
      if (!this.#intent) update({ status: 'paused' });
    });
    audio.addEventListener('playing', () => {
      if (!active()) return;
      if (!this.#intent) { audio.pause(); return; }
      update({ status: 'playing', error: '' }); this.#media();
      this.#stateReport(true);
      if (!this.#announced) { this.#announced = true; this.#report(false); }
    });
    audio.addEventListener('pause', () => {
      if (!active() || audio.ended || usePlayer.getState().status === 'error') return;
      update({ status: 'paused' }); this.#media(); this.persist(); this.#stateReport(true);
    });
    for (const event of ['waiting', 'stalled']) audio.addEventListener(event, () => { if (active() && this.#intent) { update({ status: 'buffering' }); this.#stateReport(true, 'paused'); } });
    audio.addEventListener('seeking', () => { this.#previousTime = audio.currentTime; });
    audio.addEventListener('seeked', () => { this.#previousTime = audio.currentTime; if (active()) update({ position: audio.currentTime }); });
    audio.addEventListener('timeupdate', () => {
      if (!active()) return;
      const delta = audio.currentTime - this.#previousTime;
      if (!audio.paused && !audio.seeking && delta > 0 && delta < 2) this.#listened += delta;
      this.#previousTime = audio.currentTime;
      update({ position: audio.currentTime });
      if (shouldScrobble(this.#listened, usePlayer.getState().duration)) this.#submit();
      if (Date.now() - this.#lastSave > 5000) { this.#lastSave = Date.now(); this.persist(); this.#media(); }
      this.#stateReport(false);
    });
    audio.addEventListener('ended', () => { if (active()) { if (shouldScrobble(this.#listened, usePlayer.getState().duration, true)) this.#submit(); this.#stateReport(true, 'stopped'); this.next(true); } });
    audio.addEventListener('error', () => { if (active()) {
      this.#intent = false;
      update({ status: 'error', error: '音频未能播放。可切换兼容 MP3 模式后重试，或检查网络、权限与服务器转码配置。' }); this.#media();
    } });
    audio.addEventListener('volumechange', () => update({ volume: audio.volume }));
    const desired = usePlayer.getState().volume; audio.volume = desired;
    update({ volumeSupported: Math.abs(audio.volume - desired) < 0.01 });
    if (!this.#mediaEnabled && 'mediaSession' in navigator) {
      const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
        play: () => this.play(), pause: () => this.pause(), nexttrack: () => this.next(), previoustrack: () => this.previous(),
        seekto: (details) => this.seek(details.seekTime ?? 0),
        seekbackward: (details) => this.seek(usePlayer.getState().position - (details.seekOffset ?? 10)),
        seekforward: (details) => this.seek(usePlayer.getState().position + (details.seekOffset ?? 10)),
      };
      for (const [action, handler] of Object.entries(handlers)) { try { navigator.mediaSession.setActionHandler(action as MediaSessionAction, handler!); } catch { /* unsupported action */ } }
      this.#mediaEnabled = true;
    }
  }
  async attach(api: MusicApi) {
    this.logout(); this.#api = api; this.#init();
    if (typeof BroadcastChannel !== 'undefined') {
      this.#channel = new BroadcastChannel('tooku-playback');
      this.#channel.onmessage = (event: MessageEvent) => {
        if (event.data?.identity === api.identity && event.data?.tabId !== this.#tabId && event.data?.action === 'play') this.pause();
      };
    }
    const generation = this.#generation;
    const [saved, history] = await Promise.all([readProfile<PlayerSnapshot>(api.identity, 'queue'), readProfile<HistoryEntry[]>(api.identity, 'history')]);
    if (this.#api !== api || generation !== this.#generation) return;
    if (saved?.version === 1 && Array.isArray(saved.entries) && saved.entries.every((e) => typeof e.entryId === 'string' && typeof e.track?.id === 'string')) {
      const entries = saved.entries.slice(0, 5000).map((e) => ({ entryId: e.entryId, track: e.track, ...(isPlaybackSource(e.source) ? { source: e.source, ...(isSourceIndex(e.sourceIndex) ? { sourceIndex: e.sourceIndex } : {}) } : {}) })); const currentId = entries.some((e) => e.entryId === saved.currentId) ? saved.currentId : entries[0]?.entryId ?? null;
      this.#originalOrder = this.#restoreOrder(entries, saved.originalOrder);
      const position = Number.isFinite(saved.position) ? Math.max(0, saved.position) : 0;
      update({ entries, currentId, shuffle: saved.shuffle === true, position, duration: entries.find((e) => e.entryId === currentId)?.track.duration ?? 0, status: currentId ? 'paused' : 'idle', volume: Number.isFinite(saved.volume) ? Math.min(1, Math.max(0, saved.volume)) : 0.7, repeat: ['off', 'all', 'one'].includes(saved.repeat) ? saved.repeat : 'off' });
      this.#resume = position;
      if (this.#audio) this.#audio.volume = usePlayer.getState().volume;
    }
    if (Array.isArray(history)) update({ history: history.filter((h) => typeof h.track?.id === 'string' && Number.isFinite(h.listenedAt)).slice(0, 200) });
  }
  logout() {
    this.#stateReport(true, 'stopped');
    this.#generation++; this.#intent = false; this.#source = ''; this.#api = null;
    this.#audio?.pause(); this.#audio?.removeAttribute('src'); this.#audio?.load();
    this.#channel?.close(); this.#channel = null;
    this.#back = []; this.#originalOrder = []; this.#insertCursor = null;
    update({ ...initial, entries: [], history: [] });
    if ('mediaSession' in navigator) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; }
  }
  #restoreOrder(entries: QueueEntry[], order?: string[]) {
    const ids = new Set(entries.map((e) => e.entryId));
    return Array.isArray(order) && order.length === ids.size && new Set(order).size === ids.size && order.every((id) => ids.has(id)) ? [...order] : entries.map((e) => e.entryId);
  }
  #orderedEntries(entries: QueueEntry[]) {
    const order = new Map(this.#originalOrder.map((id, i) => [id, i]));
    return [...entries].sort((a, b) => (order.get(a.entryId) ?? Infinity) - (order.get(b.entryId) ?? Infinity));
  }
  #snapshot(): QueueSnapshot {
    const s = usePlayer.getState();
    return { entries: s.entries, currentId: s.currentId, position: s.position, ...(s.shuffle ? { shuffle: true, originalOrder: this.#orderedEntries(s.entries).map((e) => e.entryId) } : {}) };
  }
  replace(tracks: Track[], index = 0, options: { source?: PlaybackSource; shuffle?: boolean } = {}) {
    if (!tracks.length) return;
    const s = usePlayer.getState(); const snapshot = this.#snapshot();
    const ordered = s.shuffle ? this.#orderedEntries(s.entries) : s.entries;
    const sameTracks = tracks.length === ordered.length && tracks.every((track, i) => track.id === ordered[i].track.id);
    const sameSource = options.source ? samePlaybackSource(options.source, currentEntry()?.source) : !currentEntry()?.source && sameTracks;
    const shuffle = options.shuffle ?? (sameSource && s.shuffle);
    if (sameSource && sameTracks && options.shuffle === undefined) {
      // Reuse each occurrence, including duplicates, and retain the shuffled order.
      const entry = ordered[index] ?? ordered[0];
      this.select(entry.entryId);
      return snapshot;
    }
    const entries = entriesFor(tracks, options.source); const currentId = entries[index]?.entryId ?? entries[0].entryId;
    this.#originalOrder = shuffle ? entries.map((e) => e.entryId) : [];
    update({ entries: shuffle ? shuffled(entries, currentId) : entries, currentId, shuffle, undo: snapshot });
    this.#back = []; this.load(true);
    return snapshot;
  }
  restoreQueue(snapshot: QueueSnapshot) {
    this.#originalOrder = this.#restoreOrder(snapshot.entries, snapshot.originalOrder);
    update({ entries: snapshot.entries, currentId: snapshot.currentId, position: snapshot.position, shuffle: snapshot.shuffle === true, undo: null }); this.#resume = snapshot.position; this.#back = [];
    if (snapshot.currentId) this.load(false, snapshot.position); else { this.#intent = false; this.#source = ''; this.#audio?.pause(); this.#audio?.removeAttribute('src'); update({ status: 'idle' }); }
    this.persist();
  }
  append(tracks: Track[], next = false, source?: PlaybackSource, sourceIndices?: readonly number[]) {
    const s = usePlayer.getState(); const additions = entriesFor(tracks, source, sourceIndices ?? []);
    if (!additions.length) return;
    const after = next ? s.entries.findIndex((e) => e.entryId === (this.#insertCursor ?? s.currentId)) : -1;
    const entries = [...s.entries]; entries.splice(next ? Math.max(0, after + 1) : entries.length, 0, ...additions);
    if (next) this.#insertCursor = additions.at(-1)!.entryId;
    update({ entries, currentId: s.currentId ?? entries[0].entryId, status: s.currentId ? s.status : 'paused' }); this.persist();
  }
  select(entryId: string) {
    if (!usePlayer.getState().entries.some((e) => e.entryId === entryId)) return;
    if (usePlayer.getState().currentId) this.#back.push(usePlayer.getState().currentId!);
    update({ currentId: entryId }); this.load(true);
  }
  move(from: number, to: number) { update({ entries: moveEntry(usePlayer.getState().entries, from, to) }); this.persist(); }
  remove(entryId: string) {
    const s = usePlayer.getState(); const index = s.entries.findIndex((e) => e.entryId === entryId);
    const entries = s.entries.filter((e) => e.entryId !== entryId); update({ entries });
    if (entryId === s.currentId) {
      const next = entries[index] ?? (s.repeat === 'all' ? entries[0] : undefined);
      const intent = this.#intent; update({ currentId: next?.entryId ?? null });
      if (next) this.load(intent); else { this.#generation++; this.#intent = false; this.#source = ''; this.#audio?.pause(); this.#audio?.removeAttribute('src'); update({ status: 'idle', position: 0, duration: 0 }); }
    }
    this.persist();
  }
  async load(play: boolean, resume = 0) {
    const entry = currentEntry(); if (!entry || !this.#api) return;
    this.#init(); const audio = this.#audio!; const generation = ++this.#generation;
    this.#intent = false; this.#source = ''; audio.pause();
    this.#intent = play; this.#resume = resume; this.#previousTime = resume; this.#listened = 0;
    this.#occurrenceId = createId(); this.#startedAt = Date.now(); this.#submission = 'none'; this.#announced = false; this.#insertCursor = null;
    update({ status: 'loading', error: '', position: resume, duration: entry.track.duration ?? 0 });
    this.#source = this.#api.streamUrl(entry.track.id, usePlayer.getState().mode); audio.src = this.#source; audio.load(); this.#media(); this.#stateReport(true, 'starting');
    if (play) await this.#start(generation); this.persist();
  }
  async #start(generation: number) {
    this.#channel?.postMessage({ action: 'play', identity: this.#api?.identity, tabId: this.#tabId });
    try { await this.#audio!.play(); } catch (error) {
      if (generation !== this.#generation || !this.#intent) return;
      const blocked = error instanceof DOMException && error.name === 'NotAllowedError';
      update({ status: blocked ? 'blocked' : 'error', error: blocked ? '浏览器需要你点击播放以继续。' : '播放未成功，请检查连接或切换兼容模式。' });
    }
  }
  play() {
    if (!currentEntry()) return;
    if (!this.#source || usePlayer.getState().status === 'error') { this.load(true, usePlayer.getState().position); return; }
    this.#intent = true; this.#start(this.#generation);
  }
  pause() { this.#intent = false; this.#audio?.pause(); update({ status: currentEntry() ? 'paused' : 'idle' }); this.persist(); }
  toggle() { if (this.#intent) this.pause(); else this.play(); }
  next(natural = false) {
    const s = usePlayer.getState(); const id = nextEntry(s.entries, s.currentId, s.repeat, natural);
    if (!id) { this.pause(); return; }
    if (s.currentId && id !== s.currentId) this.#back.push(s.currentId);
    update({ currentId: id }); this.load(true);
  }
  previous() {
    if (usePlayer.getState().position > 3) { this.seek(0); return; }
    const s = usePlayer.getState(); let id = this.#back.pop();
    while (id && !s.entries.some((e) => e.entryId === id)) id = this.#back.pop();
    id ??= s.entries[Math.max(0, s.entries.findIndex((e) => e.entryId === s.currentId) - 1)]?.entryId;
    if (id) { update({ currentId: id }); this.load(true); }
  }
  seek(value: number) {
    const audio = this.#audio; const duration = usePlayer.getState().duration;
    if (!audio || !duration || !Number.isFinite(value)) return;
    const target = Math.max(0, Math.min(value, duration));
    try { audio.currentTime = target; this.#previousTime = target; update({ position: target }); this.persist(); } catch { useSession.getState().notify('此音频暂时无法定位到该位置。'); }
  }
  volume(value: number) { if (this.#audio) { this.#audio.volume = value; update({ volumeSupported: Math.abs(this.#audio.volume - value) < 0.01, volume: this.#audio.volume }); this.persist(); } }
  repeat() { const modes = ['off', 'all', 'one'] as const; update({ repeat: modes[(modes.indexOf(usePlayer.getState().repeat) + 1) % 3] }); this.persist(); }
  shuffle() {
    const s = usePlayer.getState();
    if (!s.shuffle) { this.#originalOrder = s.entries.map((e) => e.entryId); update({ entries: shuffled(s.entries, s.currentId), shuffle: true }); }
    else { update({ entries: this.#orderedEntries(s.entries), shuffle: false }); this.#originalOrder = []; }
    this.persist();
  }
  mode(mode: 'original' | 'compatible') { update({ mode }); if (currentEntry() && this.#source) this.load(this.#intent, usePlayer.getState().position); }
  persist() {
    if (!this.#api) return;
    const s = usePlayer.getState();
    saveProfile(this.#api.identity, 'queue', { version: 1, ...this.#snapshot(), repeat: s.repeat, volume: s.volume }).then((ok) => { if (!ok) useSession.getState().notify('浏览器存储不可用，本次队列无法保存在此设备。'); });
  }
  #report(submission: boolean) {
    const api = this.#api; const entry = currentEntry(); if (!api || !entry) return;
    if (!submission && api.supports('playbackReport')) return;
    api.scrobble(entry.track.id, this.#startedAt, submission).catch(() => { if (this.#api === api) useSession.getState().notify(submission ? '收听提交结果未知；已保留此设备记录，不会自动重复提交。' : '当前播放状态未能提交，音乐可继续播放。'); });
  }
  #stateReport(force: boolean, reportedState?: 'starting' | 'playing' | 'paused' | 'stopped') {
    const api = this.#api; const entry = currentEntry(); if (!api?.supports('playbackReport') || !entry || !this.#source) return;
    if (!force && Date.now() - this.#lastReport < 30000) return;
    this.#lastReport = Date.now();
    api.request('reportPlayback', { mediaId: entry.track.id, mediaType: 'song', positionMs: Math.round(usePlayer.getState().position * 1000), state: reportedState ?? (usePlayer.getState().status === 'playing' ? 'playing' : 'paused'), playbackRate: 1, ignoreScrobble: true }, undefined, true).catch(() => { /* optional status report must never retry count submission */ });
  }
  #submit() {
    if (this.#submission !== 'none' || !this.#api || !currentEntry()) return;
    this.#submission = 'pending';
    const api = this.#api; const generation = this.#generation; const occurrenceId = this.#occurrenceId;
    const record: HistoryEntry = { occurrenceId, track: currentEntry()!.track, listenedAt: this.#startedAt, submitted: false };
    const history = [record, ...usePlayer.getState().history].slice(0, 200); update({ history }); saveProfile(api.identity, 'history', history);
    api.scrobble(record.track.id, record.listenedAt, true).then(() => {
      if (this.#api !== api) return;
      if (generation === this.#generation) this.#submission = 'done';
      const next = usePlayer.getState().history.map((h) => h.occurrenceId === occurrenceId ? { ...h, submitted: true } : h); update({ history: next }); saveProfile(api.identity, 'history', next);
    }).catch(() => { if (this.#api === api) { if (generation === this.#generation) this.#submission = 'unknown'; useSession.getState().notify('收听提交结果未知，已保留此设备记录。'); } });
  }
  #media() {
    if (!('mediaSession' in navigator)) return;
    const entry = currentEntry(); const state = usePlayer.getState();
    if (entry && typeof MediaMetadata !== 'undefined') navigator.mediaSession.metadata = new MediaMetadata({ title: entry.track.title, artist: entry.track.artist, album: entry.track.album });
    navigator.mediaSession.playbackState = state.status === 'playing' ? 'playing' : entry ? 'paused' : 'none';
    if (state.duration > 0 && Number.isFinite(state.duration)) { try { navigator.mediaSession.setPositionState({ duration: state.duration, position: Math.min(state.position, state.duration), playbackRate: 1 }); } catch { /* capability dependent */ } }
  }
}
export const player = new PlayerEngine();
if (import.meta.hot) import.meta.hot.dispose(() => { player.persist(); player.logout(); });
