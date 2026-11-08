import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const gateway = env.VITE_GATEWAY_URL || 'http://127.0.0.1:18610';
  const proxyTarget = { target: gateway, changeOrigin: true };

  return {
    base: './',
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/v1': proxyTarget,
        '/admin': proxyTarget,
        '/healthz': proxyTarget,
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
          },
        },
      },
    },
  };
});
