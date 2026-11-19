import axios from 'axios';

// Backend URL. EVERY environment is same-origin at /api — CloudFront routes /api/* to the EC2 in
// production, nginx.conf proxies it in the docker-compose/self-hosted build, and vite.config.js
// proxies it in dev. So /api is an architectural invariant, not configuration.
//
// It is therefore PINNED for production builds and deliberately NOT overridable. It used to read
// VITE_API_URL first, which meant any stray value could silently redirect every API call — including
// the session cookie — at build time. That is exactly what happened: a local .env carrying
// VITE_API_URL=http://localhost:8081 got baked into a production bundle, because Vite loads .env in
// every mode. `import.meta.env.DEV` is statically replaced at build time, so the minifier deletes the
// dev branch entirely and no localhost string can survive into a production bundle.
//
// Dev defaults to /api too, going through the vite proxy (vite.config.js `server.proxy`), so the
// browser sees one origin in every environment. That matters beyond tidiness: cross-origin requests
// follow different cookie rules, so a session bug could previously reproduce in dev but not prod, or
// the reverse. VITE_API_URL remains as a deliberate dev-only escape hatch for pointing a local
// frontend at a deployed backend — set VITE_PROXY_TARGET instead if you just want a different
// backend behind the proxy.
//
// The ONE exception is the Android build. Capacitor serves the bundled app from https://localhost, so
// there is no proxy in front of it and /api resolves to the WebView's own local server — nothing.
// `__MOBILE_BUILD__` is substituted at build time (vite.config.js), so the web bundle contains the
// literal `false` and this branch is deleted from it entirely.
const API_URL = __MOBILE_BUILD__
    ? `${__MOBILE_API_ORIGIN__}/api`
    : (import.meta.env.DEV
        ? (import.meta.env.VITE_API_URL || '/api')
        : '/api');

const api = axios.create({
    baseURL: API_URL,
    withCredentials: true, // Important for handling HTTP-only cookies (JWT)
    headers: {
        'Content-Type': 'application/json',
    },
});

// ── Native-app session token ────────────────────────────────────────────────
// On the web the session is an httpOnly cookie the browser attaches for us, and that stays true — it
// is the safer mechanism, because JavaScript cannot read it.
//
// The native build cannot use one. Its origin is https://localhost while the API is
// campus-dashboard.iitr.ac.in, which makes every call cross-SITE, and a SameSite=Lax cookie is
// correctly not attached to those. The alternative would be relaxing the cookie to SameSite=None for
// every student on the web to accommodate one client — a real CSRF cost paid by everyone. Instead the
// app carries its token explicitly.
//
// localStorage is acceptable here in a way it would not be on the web: the WebView loads only our own
// bundled assets from a local origin, with no third-party scripts, no user-authored HTML and no ads,
// so the XSS that would make a readable token dangerous has no way in.
const TOKEN_STORAGE_KEY = 'cd_session_token';

export const setStoredToken = (token) => {
    try {
        if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
        else localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
        // Private mode / storage disabled. The session then lasts until the app is closed, which is
        // a degraded experience rather than a broken one — never a crash on startup.
    }
};

export const getStoredToken = () => {
    try {
        return localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch {
        return null;
    }
};

if (__MOBILE_BUILD__) {
    api.interceptors.request.use((config) => {
        const token = getStoredToken();
        if (token) config.headers.Authorization = `Bearer ${token}`;
        return config;
    });
}



// Paths that legitimately 401 while the app is still working out whether anyone is logged in.
const AUTH_PROBE_PATHS = ['/oauth/user', '/events/all'];
// Match on the PATH only. axios usually keeps query params out of config.url, but a caller writing
// "/events/all?page=1" inline would slip past a bare endsWith() and get bounced to login from a public
// page — a silent trap that depends on how each call site happens to be written.
const isAuthProbe = (url = '') => {
    const path = String(url).split('?')[0].split('#')[0];
    return AUTH_PROBE_PATHS.some((p) => path.endsWith(p));
};

api.interceptors.response.use(
    (response) => {
        // A 2xx carrying HTML is not a success — it is an edge/proxy serving the SPA shell in place of
        // the real answer. CloudFront used to rewrite every API 403/404 into "200 + index.html", which
        // sailed through every `catch` and made refused admin writes report "Published to the feed."
        // while nothing was written. That rewrite is fixed, but any future proxy misconfiguration would
        // reintroduce it silently, so reject it here rather than trusting the status code alone.
        const ct = String(response.headers?.['content-type'] || '');
        if (ct.includes('text/html')) {
            return Promise.reject(Object.assign(
                new Error('Expected JSON but received an HTML page — the request did not reach the API.'),
                { response, code: 'NON_JSON_RESPONSE' },
            ));
        }
        return response;
    },
    (error) => {
        const status = error.response?.status;
        const url = error.config?.url || '';

        // Redirect on a 401 ONLY for a write. There is no route-level auth guard, so public pages
        // (/event/:id, /calendar, a shared notice link) routinely fetch endpoints that 401 for a
        // signed-out visitor — bouncing those to login would break every shared link. Verified: a
        // blanket redirect sent /event/24 to the login screen because it happens to load
        // /event-categories/all.
        //
        // A write is different: the user deliberately clicked something. If their session has expired
        // or been revoked, silently failing is the worst outcome — that is exactly how the CloudFront
        // rewrite made refused publishes look successful.
        // The native app holds its session itself, so an expired or revoked token has to be thrown away
        // explicitly — there is no browser to drop a cookie for us. Without this the app would keep
        // presenting a dead token forever and the login screen would never take.
        if (__MOBILE_BUILD__ && status === 401) {
            setStoredToken(null);
        }

        const isWrite = !['get', 'head', 'options'].includes(String(error.config?.method || 'get').toLowerCase());
        if (status === 401 && isWrite && !isAuthProbe(url)) {
            const onLoginScreen = window.location.pathname === '/' || window.location.pathname === '/login';
            if (!onLoginScreen && !sessionStorage.getItem('sessionExpiredHandled')) {
                sessionStorage.setItem('sessionExpiredHandled', '1');   // one redirect, not a loop
                window.location.assign('/?sessionExpired=1');
            }
        }
        if (status !== 401) sessionStorage.removeItem('sessionExpiredHandled');
        return Promise.reject(error);
    }
);

export default api;
