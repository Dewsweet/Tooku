import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, MusicApi } from '../src/api/client';
import { player, usePlayer, PLAYBACK_BUFFER_TIMEOUT } from '../src/features/player/engine';
import { usePreferences } from '../src/state/preferences';
import type { PlaybackSource, Track } from '../src/domain/models';
import { readProfile, saveProfile } from '../src/storage/local';

vi.mock('../src/storage/local', () => ({ readProfile: vi.fn().mockResolvedValue(undefined), saveProfile: vi.fn().mockResolvedValue(true) }));
class FakeAudio extends EventTarget {
  static instance: FakeAudio;
  src = ''; currentSrc = ''; currentTime = 0; duration = 180; paused = true; seeking = false; ended = false; preload = '';
  error: { code: number } | null = null;
  ranges: [number, number][] = [];
  volumeWritable = true;
  #volume = .7;
  get volume() { return this.#volume; }
  set volume(value: number) { if (this.volumeWritable) { this.#volume = value; this.dispatchEvent(new Event('volumechange')); } }
  get seekable() { const ranges = this.ranges; return { length: ranges.length, start: (i: number) => ranges[i][0], end: (i: number) => ranges[i][1] }; }
  constructor() { super(); FakeAudio.instance = this; }
  getAttribute(name: string) { return name === 'src' ? this.src : null; }
  removeAttribute() { this.src = ''; this.currentSrc = ''; }
  load() { this.currentSrc = this.src; this.error = null; this.currentTime = 0; this.ended = false; }
  play = vi.fn(async () => { if (this.paused) { this.paused = false; this.dispatchEvent(new Event('playing')); } });
  pause() { if (!this.paused) { this.paused = true; this.dispatchEvent(new Event('pause')); } }
  tick(time: number) { this.currentTime = time; this.dispatchEvent(new Event('timeupdate')); }
}
const songs: Track[] = [{ id: 'one', title: '第一首', artist: '歌手', duration: 180 }, { id: 'two', title: '第二首', artist: '歌手', duration: 180 }];
let api: MusicApi;
beforeEach(async () => { usePreferences.setState({ fadeDurationMs: 0 }); vi.stubGlobal('Audio', FakeAudio); vi.stubGlobal('BroadcastChannel', undefined); api = new MusicApi('https://example.test', 'test', 'not-real'); vi.spyOn(api, 'scrobble').mockResolvedValue({}); await player.attach(api); FakeAudio.instance.ranges = []; FakeAudio.instance.volumeWritable = true; FakeAudio.instance.play.mockClear(); });
afterEach(() => { FakeAudio.instance.volumeWritable = true; player.logout(); api.dispose(); usePreferences.setState({ fadeDurationMs: 0 }); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('player lifecycle integration', () => {
  it.each(['album', 'playlist', 'artist', 'collection'] as const)('keeps shuffle and queue occurrences when selecting within the same %s', (kind) => {
    const source: PlaybackSource = { kind, id: 'source-a' };
    const tracks = [songs[0], songs[1], songs[0]];
    player.replace(tracks, 0, { source, shuffle: true });
    const queue = usePlayer.getState().entries; const secondOccurrence = queue.find((entry) => entry.track.id === 'one' && entry.entryId !== usePlayer.getState().currentId)!;
    player.replace(tracks, 2, { source });
    expect(usePlayer.getState().shuffle).toBe(true);
    expect(usePlayer.getState().entries).toBe(queue);
    expect(usePlayer.getState().currentId).toBe(secondOccurrence.entryId);
    expect(secondOccurrence.sourceIndex).toBe(2);
    expect(usePlayer.getState().entries).toHaveLength(3);
    player.shuffle();
    expect(usePlayer.getState().entries.map((entry) => entry.track.id)).toEqual(['one', 'two', 'one']);
  });
  it('resets shuffle for a different source even when both sources have identical songs', () => {
    player.replace(songs, 0, { source: { kind: 'playlist', id: 'a' }, shuffle: true });
    player.replace(songs, 1, { source: { kind: 'playlist', id: 'b' } });
    expect(usePlayer.getState().shuffle).toBe(false);
    expect(usePlayer.getState().entries.every((entry) => entry.source?.id === 'b')).toBe(true);
    player.shuffle(); player.replace(songs, 0, { source: { kind: 'album', id: 'b' } });
    expect(usePlayer.getState().shuffle).toBe(false);
  });
  it('enables shuffle idempotently and respects manually disabling it in the same source', () => {
    const source: PlaybackSource = { kind: 'album', id: 'a' };
    player.replace(songs, 0, { source, shuffle: true }); player.replace(songs, 0, { source, shuffle: true });
    expect(usePlayer.getState().shuffle).toBe(true);
    player.shuffle(); player.replace(songs, 1, { source });
    expect(usePlayer.getState().shuffle).toBe(false);
  });
  it('retains shuffle after source edits and keeps appended entries attached to their own source', () => {
    const source: PlaybackSource = { kind: 'playlist', id: 'a' };
    player.replace(songs, 0, { source, shuffle: true });
    player.replace([...songs, songs[0]], 2, { source });
    expect(usePlayer.getState().shuffle).toBe(true);
    player.append([songs[1]], true, { kind: 'playlist', id: 'b' }, [7]);
    const added = usePlayer.getState().entries.find((entry) => entry.source?.id === 'b')!;
    expect(added.sourceIndex).toBe(7);
    player.append([songs[0]], false, { kind: 'playlist', id: 'unknown-position' });
    expect(usePlayer.getState().entries.at(-1)?.sourceIndex).toBeUndefined();
    player.select(added.entryId);
    expect(usePlayer.getState().entries.find((entry) => entry.entryId === usePlayer.getState().currentId)?.source?.id).toBe('b');
    player.next(); expect(usePlayer.getState().shuffle).toBe(true);
  });
  it('restores source, shuffle and original duplicate order when undoing replacement or resuming a saved queue', async () => {
    const source: PlaybackSource = { kind: 'playlist', id: 'a' };
    const tracks = [songs[0], songs[1], songs[0]];
    player.replace(tracks, 1, { source, shuffle: true });
    FakeAudio.instance.tick(17);
    const snapshot = player.replace(songs, 0, { source: { kind: 'album', id: 'b' } })!;
    player.restoreQueue(snapshot);
    expect(usePlayer.getState().shuffle).toBe(true);
    expect(usePlayer.getState().position).toBe(17);
    expect(usePlayer.getState().entries.every((entry) => entry.source?.id === 'a')).toBe(true);
    expect(usePlayer.getState().entries.map((entry) => entry.sourceIndex).sort()).toEqual([0, 1, 2]);
    const saved = vi.mocked(saveProfile).mock.calls.at(-1)![2];
    if (Array.isArray(saved)) throw new Error('Expected queue snapshot');
    vi.mocked(readProfile).mockResolvedValueOnce(saved).mockResolvedValueOnce(undefined);
    await player.attach(api);
    expect(usePlayer.getState().status).toBe('paused');
    expect(usePlayer.getState().shuffle).toBe(true);
    expect(usePlayer.getState().position).toBe(17);
    expect(usePlayer.getState().entries.every((entry) => entry.source?.id === 'a')).toBe(true);
    expect(usePlayer.getState().entries.map((entry) => entry.sourceIndex).sort()).toEqual([0, 1, 2]);
    player.replace(tracks, 2, { source }); expect(usePlayer.getState().shuffle).toBe(true);
    player.shuffle(); expect(usePlayer.getState().entries.map((entry) => entry.track.id)).toEqual(['one', 'two', 'one']);
  });
  it('adding and moving a song does not restart current audio', async () => { player.replace(songs); await Promise.resolve(); const audio = FakeAudio.instance; const current = usePlayer.getState().currentId; audio.tick(13); const calls = audio.play.mock.calls.length; player.append([songs[0]], true); player.move(0, 2); expect(usePlayer.getState().currentId).toBe(current); expect(usePlayer.getState().position).toBe(13); expect(audio.play).toHaveBeenCalledTimes(calls); });
  it('rapid skipping cannot let an old rejected play change the new state', async () => { let reject!: (e: unknown) => void; FakeAudio.instance.play.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })); player.replace(songs); player.next(); reject(new DOMException('blocked', 'NotAllowedError')); await Promise.resolve(); await Promise.resolve(); expect(usePlayer.getState().entries.find((e) => e.entryId === usePlayer.getState().currentId)?.track.id).toBe('two'); expect(usePlayer.getState().status).toBe('playing'); expect(usePlayer.getState().error).toBe(''); });
  it('waits for a managed playback grant and ignores a grant that arrives after skipping', async () => {
    let resolveFirst!: (value: { url: string; expiresAt: number }) => void;
    const first = new Promise<{ url: string; expiresAt: number }>((resolve) => { resolveFirst = resolve; });
    vi.spyOn(api, 'playbackUrl').mockReturnValueOnce(first).mockReturnValueOnce({ url: 'https://example.test/current', expiresAt: Date.now() + 3600000 });
    player.replace(songs); expect(usePlayer.getState().status).toBe('loading');
    player.next(); expect(FakeAudio.instance.src).toBe('https://example.test/current');
    resolveFirst({ url: 'https://example.test/stale', expiresAt: Date.now() + 3600000 }); await first; await Promise.resolve();
    expect(FakeAudio.instance.src).toBe('https://example.test/current');
  });
  it('does not start audio when playback is paused while a grant is pending', async () => {
    let resolveGrant!: (value: { url: string; expiresAt: number }) => void;
    const grant = new Promise<{ url: string; expiresAt: number }>((resolve) => { resolveGrant = resolve; });
    vi.spyOn(api, 'playbackUrl').mockReturnValue(grant);
    player.replace([songs[0]]); player.pause();
    resolveGrant({ url: 'https://example.test/paused', expiresAt: Date.now() + 3600000 }); await grant; await Promise.resolve();
    FakeAudio.instance.dispatchEvent(new Event('loadedmetadata'));
    expect(FakeAudio.instance.play).not.toHaveBeenCalled(); expect(usePlayer.getState().status).toBe('paused');
  });
  it('renews a playback grant near expiry only when playback resumes', () => {
    const grant = vi.spyOn(api, 'playbackUrl').mockReturnValue({ url: 'https://example.test/expiring', expiresAt: Date.now() + 1000 });
    player.replace([songs[0]]); const audio = FakeAudio.instance; audio.tick(12); player.pause(); player.play();
    expect(grant).toHaveBeenCalledTimes(2); expect(usePlayer.getState().position).toBe(12);
  });
  it('requests a fresh grant and restores position when retrying a failed stream', () => {
    const grant = vi.spyOn(api, 'playbackUrl')
      .mockReturnValueOnce({ url: 'https://example.test/revoked', expiresAt: Date.now() + 3600000 })
      .mockReturnValueOnce({ url: 'https://example.test/retry', expiresAt: Date.now() + 3600000 });
    player.replace([songs[0]]); const audio = FakeAudio.instance; audio.tick(42);
    audio.dispatchEvent(new Event('error'));
    expect(usePlayer.getState()).toMatchObject({ status: 'error', position: 42 });
    audio.currentTime = 0; player.play(); audio.dispatchEvent(new Event('loadedmetadata'));
    expect(grant).toHaveBeenCalledTimes(2); expect(audio.src).toBe('https://example.test/retry');
    expect(audio.currentTime).toBe(42); expect(usePlayer.getState()).toMatchObject({ status: 'playing', position: 42, error: '' });
  });
  it('removing current while paused keeps the successor paused', () => { player.replace(songs); player.pause(); player.remove(usePlayer.getState().currentId!); FakeAudio.instance.dispatchEvent(new Event('loadedmetadata')); expect(usePlayer.getState().entries[0].track.id).toBe('two'); expect(usePlayer.getState().status).toBe('paused'); expect(FakeAudio.instance.paused).toBe(true); });
  it('does not count a seek jump toward a scrobble threshold', () => { player.replace(songs); FakeAudio.instance.tick(1); player.seek(150); FakeAudio.instance.tick(151); expect(api.scrobble).not.toHaveBeenCalledWith('one', expect.any(Number), true); });
  it('submits only once when the listening threshold is reached', async () => { player.replace(songs); for (let second = 1; second <= 100; second++) FakeAudio.instance.tick(second); await Promise.resolve(); const submits = vi.mocked(api.scrobble).mock.calls.filter((call) => call[2]); expect(submits).toHaveLength(1); expect(usePlayer.getState().history).toHaveLength(1); });
  it('clears the audio source and private state on logout', () => { player.replace(songs); player.logout(); expect(FakeAudio.instance.src).toBe(''); expect(FakeAudio.instance.paused).toBe(true); expect(usePlayer.getState().entries).toEqual([]); expect(usePlayer.getState().history).toEqual([]); });
  it('reports supported playback timelines as songs without counting twice', () => {
    api.extensions.set('playbackReport', [1]); const request = vi.spyOn(api, 'request').mockResolvedValue({});
    player.replace(songs); FakeAudio.instance.dispatchEvent(new Event('waiting')); player.pause();
    expect(request).toHaveBeenCalledWith('reportPlayback', expect.objectContaining({ mediaType: 'song', state: 'starting', ignoreScrobble: true }), undefined, true);
    expect(request).toHaveBeenCalledWith('reportPlayback', expect.objectContaining({ mediaType: 'song', state: 'playing', ignoreScrobble: true }), undefined, true);
    expect(request).toHaveBeenCalledWith('reportPlayback', expect.objectContaining({ state: 'paused', ignoreScrobble: true }), undefined, true);
    expect(api.scrobble).not.toHaveBeenCalled();
  });
});

describe('bounded playback recovery', () => {
  function networkError() { FakeAudio.instance.error = { code: 2 }; FakeAudio.instance.dispatchEvent(new Event('error')); }
  it('renews grants twice, restores progress and then stops without skipping the queue', async () => {
    vi.useFakeTimers(); const grant = vi.spyOn(api, 'playbackUrl');
    player.replace(songs); const id = usePlayer.getState().currentId; FakeAudio.instance.tick(42);
    networkError(); expect(usePlayer.getState()).toMatchObject({ status: 'buffering', position: 42 });
    FakeAudio.instance.dispatchEvent(new Event('pause')); expect(usePlayer.getState().status).toBe('buffering');
    await vi.advanceTimersByTimeAsync(1000); FakeAudio.instance.dispatchEvent(new Event('loadedmetadata'));
    expect(FakeAudio.instance.currentTime).toBe(42);
    networkError(); await vi.advanceTimersByTimeAsync(3000); networkError();
    await vi.advanceTimersByTimeAsync(60000);
    expect(grant).toHaveBeenCalledTimes(3); expect(usePlayer.getState()).toMatchObject({ currentId: id, status: 'error' });
    expect(usePlayer.getState().error).toContain('自动重试已停止');
  });
  it.each(['pause', 'next', 'logout'] as const)('cancels an outstanding retry on %s', async (action) => {
    vi.useFakeTimers(); const grant = vi.spyOn(api, 'playbackUrl'); player.replace(songs); networkError();
    player[action](); const calls = grant.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000); expect(grant).toHaveBeenCalledTimes(calls);
  });
  it('preserves one listening occurrence across recovery before and after scrobbling', async () => {
    vi.useFakeTimers(); player.replace(songs);
    for (let i = 1; i <= 50; i++) FakeAudio.instance.tick(i);
    networkError(); await vi.advanceTimersByTimeAsync(1000); FakeAudio.instance.dispatchEvent(new Event('loadedmetadata'));
    for (let i = 51; i <= 95; i++) FakeAudio.instance.tick(i);
    await Promise.resolve(); expect(usePlayer.getState().history).toHaveLength(1);
    networkError(); await vi.advanceTimersByTimeAsync(3000); FakeAudio.instance.dispatchEvent(new Event('loadedmetadata'));
    for (let i = 96; i <= 179; i++) FakeAudio.instance.tick(i);
    expect(vi.mocked(api.scrobble).mock.calls.filter((call) => call[2])).toHaveLength(1);
    expect(usePlayer.getState().history).toHaveLength(1);
  });
  it('recovers a stalled stream and retries transient grants but stops on authentication failures', async () => {
    vi.useFakeTimers(); const grant = vi.spyOn(api, 'playbackUrl');
    player.replace(songs); FakeAudio.instance.dispatchEvent(new Event('waiting'));
    await vi.advanceTimersByTimeAsync(PLAYBACK_BUFFER_TIMEOUT + 1000); expect(grant).toHaveBeenCalledTimes(2);
    grant.mockRejectedValueOnce(new ApiError('暂时不可用', undefined, 503, true));
    player.select(usePlayer.getState().currentId!); await Promise.resolve(); expect(usePlayer.getState().status).toBe('buffering');
    grant.mockRejectedValueOnce(new ApiError('登录已失效', undefined, 401));
    await vi.advanceTimersByTimeAsync(1000); expect(usePlayer.getState().status).toBe('error');
    const count = grant.mock.calls.length; await vi.advanceTimersByTimeAsync(60000); expect(grant).toHaveBeenCalledTimes(count);
  });
  it.each([3, 4])('does not automatically retry media error %s', async (code) => {
    vi.useFakeTimers(); const grant = vi.spyOn(api, 'playbackUrl'); player.replace(songs);
    FakeAudio.instance.error = { code }; FakeAudio.instance.dispatchEvent(new Event('error'));
    await vi.advanceTimersByTimeAsync(60000); expect(grant).toHaveBeenCalledTimes(1); expect(usePlayer.getState().error).toContain('兼容 MP3');
  });
  it('renews a known expired managed grant when the browser reports an unavailable source', async () => {
    vi.useFakeTimers(); const grant = vi.spyOn(api, 'playbackUrl').mockImplementation(() => ({ url: 'https://example.test/managed', expiresAt: Date.now() + 4000 }));
    player.replace(songs); FakeAudio.instance.tick(42); await vi.advanceTimersByTimeAsync(4000);
    FakeAudio.instance.error = { code: 4 }; FakeAudio.instance.dispatchEvent(new Event('error'));
    await vi.advanceTimersByTimeAsync(1000); FakeAudio.instance.dispatchEvent(new Event('loadedmetadata'));
    expect(grant).toHaveBeenCalledTimes(2); expect(FakeAudio.instance.currentTime).toBe(42); expect(usePlayer.getState().status).toBe('playing');
  });
  it('clamps seeks and recovered positions to known seekable ranges', () => {
    player.replace(songs); const audio = FakeAudio.instance; audio.ranges = [[5, 20], [30, 50]];
    player.seek(26); expect(audio.currentTime).toBe(30);
    player.seek(90); expect(audio.currentTime).toBe(50);
    player.seek(0); expect(audio.currentTime).toBe(5);
  });
  it('treats browser initiated pauses as a stopped playback intent', () => {
    player.replace(songs); FakeAudio.instance.pause();
    expect(usePlayer.getState().status).toBe('paused'); player.toggle(); expect(usePlayer.getState().status).toBe('playing');
  });
  it('ignores a queued pause event from a replaced source after the new song starts', () => {
    player.replace(songs); player.next(); FakeAudio.instance.dispatchEvent(new Event('pause'));
    expect(usePlayer.getState().status).toBe('playing'); player.toggle(); expect(usePlayer.getState().status).toBe('paused');
  });
  it('starts a fresh listening occurrence when a saved queue is first played after login', async () => {
    player.replace(songs); for (let i = 1; i <= 95; i++) FakeAudio.instance.tick(i);
    await Promise.resolve(); const oldId = usePlayer.getState().history[0].occurrenceId; player.persist();
    const saved = vi.mocked(saveProfile).mock.calls.filter((call) => call[1] === 'queue').at(-1)![2];
    vi.mocked(readProfile).mockResolvedValueOnce(saved).mockResolvedValueOnce([]);
    await player.attach(api); player.play();
    for (let i = 1; i <= 95; i++) FakeAudio.instance.tick(i);
    expect(usePlayer.getState().history).toHaveLength(1); expect(usePlayer.getState().history[0].occurrenceId).not.toBe(oldId);
  });
  it('does not adopt a pending grant after the queue is emptied', async () => {
    let resolve!: (value: { url: string }) => void;
    const grant = new Promise<{ url: string }>((done) => { resolve = done; });
    vi.spyOn(api, 'playbackUrl').mockReturnValue(grant);
    player.replace([songs[0]]); player.remove(usePlayer.getState().currentId!);
    resolve({ url: 'https://example.test/late' }); await grant; await Promise.resolve();
    expect(FakeAudio.instance.src).toBe(''); expect(usePlayer.getState().status).toBe('idle');
  });
});

describe('single element audio fades', () => {
  it('fades pause/resume without changing the saved volume and allows interruption', async () => {
    vi.useFakeTimers(); usePreferences.setState({ fadeDurationMs: 500 });
    player.replace(songs); const audio = FakeAudio.instance;
    expect(audio.volume).toBe(0); await vi.advanceTimersByTimeAsync(500); expect(audio.volume).toBeCloseTo(.7);
    player.pause(); await vi.advanceTimersByTimeAsync(250);
    expect(audio.paused).toBe(false); expect(audio.volume).toBeGreaterThan(0); expect(audio.volume).toBeLessThan(.7);
    expect(usePlayer.getState().volume).toBe(.7);
    player.play(); await vi.advanceTimersByTimeAsync(500); expect(audio.paused).toBe(false); expect(audio.volume).toBeCloseTo(.7);
    player.pause(); await vi.advanceTimersByTimeAsync(500); expect(audio.paused).toBe(true);
    expect(usePlayer.getState().volume).toBe(.7);
    const snapshot = vi.mocked(saveProfile).mock.calls.at(-1)![2]; expect(snapshot).toHaveProperty('volume', .7);
  });
  it('cancels old switch fades during rapid selections and keeps one audio element', async () => {
    vi.useFakeTimers(); usePreferences.setState({ fadeDurationMs: 500 });
    const grant = vi.spyOn(api, 'playbackUrl'); player.replace([...songs, { ...songs[0], id: 'three' }]);
    const audio = FakeAudio.instance; await vi.advanceTimersByTimeAsync(500);
    player.next(); await vi.advanceTimersByTimeAsync(100); player.next(); await vi.advanceTimersByTimeAsync(1000);
    expect(grant.mock.calls.map((call) => call[0])).toEqual(['one', 'three']);
    expect(FakeAudio.instance).toBe(audio); expect(audio.volume).toBeCloseTo(.7); expect(audio.src).toContain('id=three');
    expect(usePlayer.getState().status).toBe('playing');
  });
  it('uses the latest user volume during fades and cancels all audio work on logout', async () => {
    vi.useFakeTimers(); usePreferences.setState({ fadeDurationMs: 500 }); player.replace(songs);
    await vi.advanceTimersByTimeAsync(250); player.volume(.4); await vi.advanceTimersByTimeAsync(250);
    expect(FakeAudio.instance.volume).toBeCloseTo(.4); expect(usePlayer.getState().volume).toBe(.4);
    player.next(); player.logout(); await vi.advanceTimersByTimeAsync(5000);
    expect(FakeAudio.instance.src).toBe(''); expect(FakeAudio.instance.paused).toBe(true);
  });
  it('falls back to immediate pause when media volume cannot be changed', async () => {
    vi.useFakeTimers(); player.replace(songs); FakeAudio.instance.volumeWritable = false;
    usePreferences.setState({ fadeDurationMs: 500 }); player.pause(); await vi.advanceTimersByTimeAsync(32);
    expect(FakeAudio.instance.paused).toBe(true); expect(usePlayer.getState().volumeSupported).toBe(false);
  });
  it('fades natural endings and starts the next song at silence without changing repeat behavior', async () => {
    vi.useFakeTimers(); usePreferences.setState({ fadeDurationMs: 500 }); player.replace(songs);
    const audio = FakeAudio.instance; await vi.advanceTimersByTimeAsync(500);
    audio.tick(179.6); await vi.advanceTimersByTimeAsync(400); expect(audio.volume).toBeCloseTo(0);
    audio.ended = true; audio.paused = true; audio.dispatchEvent(new Event('ended'));
    expect(usePlayer.getState().entries.find((entry) => entry.entryId === usePlayer.getState().currentId)?.track.id).toBe('two');
    expect(audio.volume).toBe(0); await vi.advanceTimersByTimeAsync(500); expect(audio.volume).toBeCloseTo(.7);
  });
});

describe('system media artwork', () => {
  let session: { metadata: MediaMetadata | null; playbackState: MediaSessionPlaybackState; setPositionState: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    session = { metadata: null, playbackState: 'none', setPositionState: vi.fn() };
    vi.stubGlobal('navigator', { mediaSession: session });
    vi.stubGlobal('MediaMetadata', class {
      title: string; artist: string; album: string; artwork: MediaImage[];
      constructor(init: MediaMetadataInit = {}) { this.title = init.title ?? ''; this.artist = init.artist ?? ''; this.album = init.album ?? ''; this.artwork = init.artwork ?? []; }
    });
  });
  it('publishes the current cover through the API without adding authenticated URLs to snapshots', () => {
    const track = { ...songs[0], album: '测试专辑', coverArt: 'cover-one' };
    const audio = FakeAudio.instance;
    player.replace([track]);
    expect(session.metadata).toMatchObject({ title: track.title, artist: track.artist, album: track.album, artwork: [{ src: api.coverUrl('cover-one', 512) }] });
    expect(session.playbackState).toBe('playing'); expect(FakeAudio.instance).toBe(audio);
    const snapshots = vi.mocked(saveProfile).mock.calls.filter((call) => call[1] === 'queue').map((call) => call[2]);
    expect(JSON.stringify(snapshots)).not.toContain('/rest/getCoverArt');
  });
  it('retains artwork metadata while the timeline and playback state change', () => {
    player.replace([{ ...songs[0], coverArt: 'cover-one' }]);
    const metadata = session.metadata;
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6000);
    FakeAudio.instance.tick(13); player.pause();
    expect(session.metadata).toBe(metadata); expect(session.playbackState).toBe('paused');
    expect(session.setPositionState).toHaveBeenCalledWith(expect.objectContaining({ position: 13 }));
  });
  it('replaces covers even with matching titles and clears artwork for tracks without a cover', () => {
    player.replace([{ ...songs[0], coverArt: 'cover-one' }, { ...songs[0], id: 'two', coverArt: 'cover-two' }, { ...songs[0], id: 'three' }]);
    player.next(); expect(session.metadata?.artwork).toEqual([{ src: api.coverUrl('cover-two', 512) }]);
    player.next(); expect(session.metadata?.artwork).toEqual([]);
    expect(usePlayer.getState().status).toBe('playing');
  });
  it('clears metadata when the last entry is removed, an empty queue is restored or the session ends', () => {
    const track = { ...songs[0], coverArt: 'cover-one' };
    player.replace([track]); player.remove(usePlayer.getState().currentId!);
    expect(session.metadata).toBeNull(); expect(session.playbackState).toBe('none');
    player.replace([track]); player.restoreQueue({ entries: [], currentId: null, position: 0 });
    expect(session.metadata).toBeNull(); expect(session.playbackState).toBe('none');
    player.replace([track]); player.logout();
    expect(session.metadata).toBeNull(); expect(session.playbackState).toBe('none');
  });
});
