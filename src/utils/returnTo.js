/**
 * Remember where someone was heading before they were sent to log in, and send them back there after.
 *
 * Logging in navigates away to Channel-i and back, so the app is torn down and rebuilt — any in-memory
 * state (including react-router's location.state) is gone by the time the user returns. sessionStorage
 * survives that round trip within the same tab, so it is the only thing that can carry the destination.
 *
 * Matters because shared links are how this app spreads: someone posts /notices/17 in a hostel group,
 * and without this every person who clicks it lands on a generic home page instead of the notice.
 */
const KEY = 'returnTo';

// Only ever store a same-site path. Anything starting with "//" or containing a scheme could redirect
// to another origin after login — an open redirect wearing a helpful hat.
const isSafeInternalPath = (p) => typeof p === 'string'
    && p.startsWith('/')
    && !p.startsWith('//')
    && !/^\/+\\/.test(p)
    && !p.includes('://');

export function rememberReturnTo(path) {
    try {
        if (isSafeInternalPath(path) && path !== '/') sessionStorage.setItem(KEY, path);
    } catch { /* private mode / storage disabled — degrade to the default landing */ }
}

/** Read and CLEAR the stored destination. One-shot, so a stale value can't hijack a later login. */
export function takeReturnTo() {
    try {
        const p = sessionStorage.getItem(KEY);
        sessionStorage.removeItem(KEY);
        return isSafeInternalPath(p) ? p : null;
    } catch { return null; }
}
