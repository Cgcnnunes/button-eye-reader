import { defineConfig } from 'vite';
import manifest from './package.json' with { type: 'json' };

export default defineConfig({
  build: {
    target: 'es2022',
  },
  define: { __APP_VERSION__: JSON.stringify(manifest.version) },
  server: { host: '127.0.0.1' },
});
