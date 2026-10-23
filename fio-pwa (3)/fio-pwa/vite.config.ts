import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';

let sha = 'local';
try { sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* sem git */ }
process.env.VITE_BUILD_ID ??= `${new Date().toISOString().slice(0, 10)}-${sha}`;

export default defineConfig({
  plugins: [
    preact(),
    VitePWA({
      registerType: 'prompt',            // nunca recarrega sozinho: o app decide (e bloqueia com pendências)
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/', name: 'Fio — finanças com IA', short_name: 'Fio', lang: 'pt-BR',
        description: 'Controle financeiro pessoal por conversa: registre gastos e receitas, acompanhe saldo, orçamento e metas.',
        start_url: '/', scope: '/', display: 'standalone', orientation: 'portrait',
        background_color: '#10110F', theme_color: '#10110F', categories: ['finance', 'productivity'],
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Só recursos ESTÁTICOS entram no precache. Chamadas à API (Supabase, outra origem) não têm rota => sempre rede,
        // então respostas privadas, tokens e dados financeiros nunca vão para o cache do service worker.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/__/, /\/[^/?]+\.[^/]+$/],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
      },
    }),
  ],
  build: { target: 'es2022', sourcemap: false },
  server: { port: 5173 },
});
