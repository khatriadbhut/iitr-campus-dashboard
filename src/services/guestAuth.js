import api, { setStoredToken } from './api';

/**
 * Play Store tester sign-in.
 *
 * This module exists so that nothing about guest access reaches the web bundle. It is imported by
 * exactly one thing — GuestLoginPanel — which LandingPage loads through a dynamic import guarded by
 * `__MOBILE_BUILD__`. On the web that guard is the literal `false`, so rollup never follows the import
 * and this file becomes no chunk at all.
 *
 * Keeping it out matters beyond tidiness. A dead `guestLogin` sitting in the bundle a student's
 * browser downloads would advertise that a credential-based login endpoint exists and name its path —
 * free reconnaissance for anyone reading the minified source, in exchange for nothing.
 *
 * (It was written as a method on the authService object first. Rollup cannot tree-shake a property of
 * an object literal, so it survived into dist/ — which is how this module came to exist.)
 */
export const guestLogin = async (username, password) => {
    const response = await api.post('/oauth/guest-login', { username, password });
    const token = response.data?.token;
    if (!token) throw new Error('Sign-in succeeded but no session was returned.');

    // From here on every request carries this as a bearer header (see the interceptor in api.js).
    setStoredToken(token);
    return token;
};
