import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import { fileURLToPath, URL } from 'node:url';
import { randomUUID } from 'node:crypto';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const version = randomUUID();
  return {
    define: { __APP_VERSION__: JSON.stringify(version) },
    plugins: [
      {
        name: 'app-version',
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version }) });
        },
      },
      vue(),
      AutoImport({ resolvers: [ElementPlusResolver({ importStyle: false })] }),
      Components({ resolvers: [ElementPlusResolver({ importStyle: false })] }),
    ],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: env.VITE_PROXY_TARGET || 'http://localhost:8081',
          changeOrigin: true,
        },
      },
    },
  };
});
