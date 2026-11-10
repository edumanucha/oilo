import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Oílo — tus libros, contados',
        short_name: 'Oílo',
        description: 'Convertí tus EPUB, PDF y DOCX en audiolibros. Gratis.',
        lang: 'es',
        theme_color: '#5b3cc4',
        background_color: '#faf8f5',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,mjs}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globIgnores: ['ort/**', 'piper/**'],
        runtimeCaching: [
          {
            // Motor de la voz natural: se guarda la primera vez que se usa.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/(ort|piper)\//.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'oilo-voice-engine', expiration: { maxEntries: 10 } },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'cdnjs.cloudflare.com',
            handler: 'CacheFirst',
            options: { cacheName: 'oilo-runtime', expiration: { maxEntries: 40 } },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
});
