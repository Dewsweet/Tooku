import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createUserApi } from './server/api.ts';
import { isNavidromeProxyRequest } from './server/navidromeProxy.ts';
import { createLyricsApi } from './server/lyrics/http.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'NAVIDROME_');
  return {
    plugins: [react(), {
      name: 'tooku-local-health',
      configureServer(server) {
        const users = createUserApi({ upstream: env.NAVIDROME_UPSTREAM });
        const lyrics = createLyricsApi();
        server.middlewares.use((req, res, next) => { void lyrics.handle(req, res, next); });
        server.middlewares.use((req, res, next) => { void users.handle(req, res, next); });
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/nd/') && !isNavidromeProxyRequest(req.url, req.method)) { res.statusCode = 404; res.end(); return; }
          next();
        });
        server.httpServer?.once('close', () => { users.close(); lyrics.close(); });
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
      proxy: {
        '^/nd/(rest/|auth/login$|api/artist/)': {
          target: env.NAVIDROME_UPSTREAM || 'http://127.0.0.1:44533',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/nd/, ''),
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      clearMocks: true,
    },
  };
});
