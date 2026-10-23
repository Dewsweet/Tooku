import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createUserApi, upstreamUrl } from './server/api.ts';
import { createNavidromeProxy } from './server/navidromeProxy.ts';
import { createLyricsApi } from './server/lyrics/http.ts';
import { createRecommendationsApi } from './server/recommendations/http.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'NAVIDROME_');
  return {
    plugins: [react(), {
      name: 'tooku-local-health',
      configureServer(server) {
        const users = createUserApi({ upstream: env.NAVIDROME_UPSTREAM });
        const lyrics = createLyricsApi();
        const recommendations = createRecommendationsApi(undefined, users.recommendationCredentials);
        const proxy = createNavidromeProxy(upstreamUrl(env.NAVIDROME_UPSTREAM || 'http://127.0.0.1:44533'), users);
        server.middlewares.use((req, res, next) => { void recommendations.handle(req, res, next); });
        server.middlewares.use((req, res, next) => { void lyrics.handle(req, res, next); });
        server.middlewares.use((req, res, next) => { void users.handle(req, res, next); });
        server.middlewares.use((req, res, next) => { void proxy(req, res, next); });
        server.httpServer?.once('close', () => { users.close(); lyrics.close(); recommendations.close(); });
        server.middlewares.use('/__tooku/health', (_req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify({ app: 'tooku', version: '0.1.0', persistence: 1 }));
        });
      },
    }],
    server: {
      port: 18733,
      strictPort: true,
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      clearMocks: true,
    },
  };
});
