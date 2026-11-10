import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const BUILD = new Date().toISOString().slice(0, 16).replace('T', ' ');

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(BUILD) },
  base: './',
  plugins: [
    react(),
    VitePWA({
      // Nosotros decidimos cuándo actualizar (src/main.jsx): al abrir, o al pausar si estaba leyendo.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Oílo — tus libros, contados',
        short_name: 'Oílo',
        id: './', description: 'Escuchá tus libros EPUB, PDF y Word como audiolibros. Gratis y sin internet.',
        lang: 'es',
        theme_color: '#5d7a2e',
        background_color: '#f4ecdc',
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
        globIgnores: ['piper/**'],
        runtimeCaching: [
          {
            // Motor de la voz natural: se guarda la primera vez que se usa.
            // Motores de voz (piper y los .wasm de onnxruntime): se guardan la primera vez que se usan.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && (/\/piper\//.test(url.pathname) || /\.wasm$/.test(url.pathname)),
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
