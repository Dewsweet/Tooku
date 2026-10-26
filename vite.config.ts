import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createUserApi, upstreamUrl } from './server/api.ts';
import { createNavidromeProxy, createPlaybackProxy } from './server/navidromeProxy.ts';
import { createLyricsApi } from './server/lyrics/http.ts';
import { createRecommendationsApi } from './server/recommendations/http.ts';
import { tookuServiceProtocol } from './src/domain/serviceProtocol.ts';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'NAVIDROME_');
  const hasLocalTests = existsSync(new URL('./tests/', import.meta.url));
  return {
    plugins: [react(), {
      name: 'tooku-local-health',
      configureServer(server) {
        const users = createUserApi({ upstream: env.NAVIDROME_UPSTREAM });
        const lyrics = createLyricsApi();
        const recommendations = createRecommendationsApi(undefined, users.recommendationCredentials);
        const proxy = createNavidromeProxy(upstreamUrl(env.NAVIDROME_UPSTREAM || 'http://127.0.0.1:44533'), users);
        const playback = createPlaybackProxy(upstreamUrl(env.NAVIDROME_UPSTREAM || 'http://127.0.0.1:44533'), users);
        server.middlewares.use((req, res, next) => { void recommendations.handle(req, res, next); });
        server.middlewares.use((req, res, next) => { void lyrics.handle(req, res, next); });
        server.middlewares.use((req, res, next) => { void playback(req, res, next); });
        server.middlewares.use((req, res, next) => { void users.handle(req, res, next); });
        server.middlewares.use((req, res, next) => { void proxy(req, res, next); });
        server.httpServer?.once('close', () => { users.close(); lyrics.close(); recommendations.close(); });
        server.middlewares.use('/__tooku/health', (_req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify({ app: 'tooku', version: '0.1.0', persistence: 1, serviceProtocol: tookuServiceProtocol }));
        });
      },
    }, {
      name: 'tooku-service-worker',
      generateBundle(_options, bundle) {
        const template = readFileSync(new URL('./src/pwa/service-worker.js', import.meta.url), 'utf8');
        const revisionHash = createHash('sha256').update(template);
        for (const file of Object.keys(bundle).sort()) {
          const output = bundle[file];
          revisionHash.update(file).update(output.type === 'chunk' ? output.code : output.source);
        }
        revisionHash.update(readFileSync(new URL('./public/tooku.svg', import.meta.url)));
        revisionHash.update(readFileSync(new URL('./public/navidrome.svg', import.meta.url)));
        const revision = revisionHash.digest('hex').slice(0, 12);
        const precache = ['/tooku.svg', '/navidrome.svg', ...Object.keys(bundle).filter((file) => /\.(?:js|css)$/.test(file)).map((file) => `/${file}`)];
        const source = template.replaceAll('__TOOKU_CACHE_VERSION__', revision).replaceAll('__TOOKU_PRECACHE__', JSON.stringify(precache));
        this.emitFile({ type: 'asset', fileName: 'sw.js', source });
      },
    }],
    server: {
      port: 18733,
      strictPort: true,
    },
    test: {
      include: ['tests/**/*.test.{ts,tsx,js,mjs}'],
      environment: 'jsdom',
      setupFiles: hasLocalTests ? ['./tests/setup.ts'] : [],
      passWithNoTests: !hasLocalTests,
      clearMocks: true,
    },
  };
});
