import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'NAVIDROME_');
  return {
    plugins: [react(), {
      name: 'tooku-local-health',
      configureServer(server) {
        server.middlewares.use('/__tooku/health', (_req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify({ app: 'tooku', version: '0.1.0' }));
        });
      },
    }],
    server: {
      port: 18733,
      strictPort: true,
      proxy: {
        '/nd/rest': {
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
