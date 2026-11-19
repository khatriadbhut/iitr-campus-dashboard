import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isLocalTarget = (env.VITE_PROXY_TARGET || '').includes('localhost') || (env.VITE_PROXY_TARGET || '').includes('127.0.0.1');

  // ── The Android (Capacitor) build ──────────────────────────────────────────
  // `npm run build:mobile` -> vite build --mode mobile. This is a genuinely different artifact from
  // the web build, not a flag read at runtime, and that distinction is the point: the guest-login door
  // for Play Store reviewers must not merely be HIDDEN on campus-dashboard.iitr.ac.in, it must not be
  // in the bundle at all. `__MOBILE_BUILD__` below is substituted with the literal `false` for the web
  // build, so rollup deletes every branch behind it and no guest string survives into dist/.
  // (scripts/verify-web-bundle-clean.sh asserts exactly that, so it cannot regress silently.)
  const isMobile = mode === 'mobile';

  // Capacitor serves the bundled app from https://localhost, so /api is NOT the API any more — there
  // is no proxy in front of a WebView. The native build therefore talks to the deployed origin
  // directly, cross-site, which is why it authenticates with a bearer token instead of a cookie
  // (see src/services/api.js and temp_backend/middlewares/userAuth.js).
  const mobileApiOrigin = env.VITE_MOBILE_API_ORIGIN || 'https://campus-dashboard.iitr.ac.in';

  return {
    define: {
      // Defined in EVERY mode, not just mobile. An identifier that is only sometimes replaced is a
      // ReferenceError waiting to happen in the mode nobody tested.
      __MOBILE_BUILD__: JSON.stringify(isMobile),
      __MOBILE_API_ORIGIN__: JSON.stringify(mobileApiOrigin),
    },
    // The web app is mounted under /app/ on campus-dashboard.iitr.ac.in — the marketing landing page
    // owns the root. Capacitor has no such split: it serves the bundle from the root of its local
    // server, so an /app/ prefix there would 404 every asset. Every emitted asset URL, the PWA scope,
    // the service-worker registration and the router basename must agree on whichever prefix applies,
    // or the SPA 404s on a hard reload of any deep link.
    base: isMobile ? '/' : '/app/',
    build: isMobile ? { outDir: 'dist-mobile', emptyOutDir: true } : {},
    plugins: [
      react(),
      // No service worker in the native build. Capacitor already serves the shell from local assets,
      // so the SW buys nothing — and it would actively hurt: src/sw.js precaches under /app/ and
      // navigation-falls-back to /app/index.html, neither of which exists at the WebView's root. A
      // stale worker inside a shipped APK is also far harder to recover from than one on a website,
      // where a reload eventually wins.
      !isMobile && VitePWA({
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        // injectManifest, not the default generateSW: a `push` handler cannot be added to a worker
        // Workbox writes for us, and push notifications need one. src/sw.js is a hand-port of the
        // `workbox` block that used to live here — precache, navigation fallback, the /api/ denylist
        // and the NetworkFirst API rule are all reproduced there and must stay equivalent.
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.js',
        includeAssets: ['pwa-192.png', 'pwa-512.png', 'pwa-512-maskable.png'],
        manifest: {
          name: 'IITR Campus Event Dashboard',
          short_name: 'Event Dashboard',
          description: 'Discover, track, and manage campus events in one place.',
          theme_color: '#0a7c5c',
          background_color: '#f2f9f6',
          display: 'standalone',
          orientation: 'portrait',
          scope: '/app/',
          start_url: '/app/',
          icons: [
            {
              src: '/app/pwa-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: '/app/pwa-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: '/app/pwa-512-maskable.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable'
            }
          ]
        },
        injectManifest: {
          // Only the manifest-generation options apply now; routing lives in src/sw.js.
          globPatterns: ['**/*.{js,css,html,svg,png,ico,json}'],
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        },
        // NOTE: the old `workbox: { ... }` block lived here. Under injectManifest those options
        // no longer apply — precaching, the navigation fallback with its /api/ denylist, and the
        // NetworkFirst API rule are now hand-written in src/sw.js and must be kept equivalent.
        devOptions: {
          enabled: true
        }
      }),
    ].filter(Boolean),
    // React Router 8 is ESM-only, and Vite's dep optimizer can end up handing it a DIFFERENT React
    // instance than the app gets — hooks then resolve against an uninitialised dispatcher and every
    // render dies with "Cannot read properties of null (reading 'useRef')" inside <BrowserRouter>.
    // Only the dev server is affected (the production build has no optimizer), which makes it exactly
    // the kind of bug a green `npm run build` hides. dedupe forces one copy of React for everyone.
    resolve: {
      dedupe: ['react', 'react-dom', 'react-router'],
    },
    optimizeDeps: {
      include: ['react', 'react-dom', 'react-dom/client', 'react-router'],
    },
    // `vite preview` serves the real PRODUCTION build (dist/), including the self-contained
    // service worker. Needed to test push properly: the DEV service worker is an ES module that
    // imports Workbox from /node_modules/.vite/deps, and a cold wake-up on a push event has to
    // re-evaluate those imports — which fails, so the push handler never runs in dev. The built
    // worker is a single bundled file with no imports and does not have that problem.
    preview: {
      host: true,
      proxy: {
        '/api': {
          target: env.VITE_PROXY_TARGET || 'http://127.0.0.1:8081',
          changeOrigin: true,
          secure: false,
          cookieDomainRewrite: { '*': '' },
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    server: {
      host: true,
      proxy: {
        '/api': {
          target: env.VITE_PROXY_TARGET || 'http://127.0.0.1:8081',
          changeOrigin: true,
          headers: !isLocalTarget ? {
            Origin: 'https://campus-dashboard-event-planner.vercel.app/'
          } : {},
          secure: false,
          cookieDomainRewrite: { '*': '' },
          rewrite: (path) => path.replace(/^\/api/, '')
        }
      }
    },
  }
})
