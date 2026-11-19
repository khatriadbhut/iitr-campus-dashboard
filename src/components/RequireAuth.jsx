import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { rememberReturnTo } from '../utils/returnTo';

/**
 * Route guard: nothing but the login page renders without a session.
 *
 * Every data endpoint now requires authentication, so a signed-out visitor pasting /calendar used to
 * get a fully drawn but completely empty UI — a worse experience than being told to log in, and it
 * leaks the app's structure to anyone who guesses a URL. This turns "empty shell" into "log in".
 *
 * Waits for AuthContext to finish its session check before deciding: rendering the login page during
 * that first async tick would bounce ALREADY-LOGGED-IN users on every hard refresh.
 *
 * Where the visitor was trying to go is preserved in `from`, so login can return them there instead of
 * dumping everyone on the home page.
 */
export default function RequireAuth({ children }) {
    const { user, loading } = useAuth();
    const location = useLocation();

    if (loading) {
        return (
            <div style={{ display: 'grid', placeItems: 'center', minHeight: '60vh', color: '#6b6b6b' }}>
                <p>Loading…</p>
            </div>
        );
    }

    if (!user) {
        // sessionStorage, not router state: logging in leaves the site entirely (Channel-i) and comes
        // back to a freshly booted app, so in-memory state does not survive the trip.
        rememberReturnTo(location.pathname + location.search);
        return <Navigate to="/" replace />;
    }

    return children;
}
