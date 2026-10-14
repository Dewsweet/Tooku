import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicApi } from '../src/api/client';
import { player, usePlayer } from '../src/features/player/engine';
import type { Track } from '../src/domain/models';

vi.mock('../src/storage/local', () => ({ readProfile: vi.fn().mockResolvedValue(undefined), saveProfile: vi.fn().mockResolvedValue(true) }));
class FakeAudio extends EventTarget {
  static instance: FakeAudio;
  src = ''; currentSrc = ''; currentTime = 0; duration = 180; volume = 0.7; paused = true; seeking = false; ended = false; preload = '';
  constructor() { super(); FakeAudio.instance = this; }
  getAttribute(name: string) { return name === 'src' ? this.src : null; }
  removeAttribute() { this.src = ''; this.currentSrc = ''; }
  load() { this.currentSrc = this.src; }
  play = vi.fn(async () => { this.paused = false; this.dispatchEvent(new Event('playing')); });
  pause() { if (!this.paused) { this.paused = true; this.dispatchEvent(new Event('pause')); } }
  tick(time: number) { this.currentTime = time; this.dispatchEvent(new Event('timeupdate')); }
}
const songs: Track[] = [{ id: 'one', title: '第一首', artist: '歌手', duration: 180 }, { id: 'two', title: '第二首', artist: '歌手', duration: 180 }];
let api: MusicApi;
beforeEach(async () => { vi.stubGlobal('Audio', FakeAudio); vi.stubGlobal('BroadcastChannel', undefined); api = new MusicApi('https://example.test', 'test', 'not-real'); vi.spyOn(api, 'scrobble').mockResolvedValue({}); await player.attach(api); FakeAudio.instance.play.mockClear(); });
afterEach(() => { player.logout(); api.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('player lifecycle integration', () => {
  it('adding and moving a song does not restart current audio', async () => { player.replace(songs); await Promise.resolve(); const audio = FakeAudio.instance; const current = usePlayer.getState().currentId; audio.tick(13); const calls = audio.play.mock.calls.length; player.append([songs[0]], true); player.move(0, 2); expect(usePlayer.getState().currentId).toBe(current); expect(usePlayer.getState().position).toBe(13); expect(audio.play).toHaveBeenCalledTimes(calls); });
  it('rapid skipping cannot let an old rejected play change the new state', async () => { let reject!: (e: unknown) => void; FakeAudio.instance.play.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })); player.replace(songs); player.next(); reject(new DOMException('blocked', 'NotAllowedError')); await Promise.resolve(); await Promise.resolve(); expect(usePlayer.getState().entries.find((e) => e.entryId === usePlayer.getState().currentId)?.track.id).toBe('two'); expect(usePlayer.getState().status).toBe('playing'); expect(usePlayer.getState().error).toBe(''); });
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
