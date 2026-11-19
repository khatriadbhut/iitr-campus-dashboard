import React, { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { guestLogin } from '../../services/guestAuth';
import './GuestLoginPanel.css';

/**
 * Sign-in for Play Store reviewers and closed testers.
 *
 * This component ships ONLY inside the Android build. LandingPage reaches it through a dynamic import
 * guarded by `__MOBILE_BUILD__`, which vite replaces with the literal `false` for the web — so the
 * chunk is never even emitted into dist/. Students on campus-dashboard.iitr.ac.in are not shown this
 * and cannot find it; the file is not in what their browser downloads.
 *
 * The credential itself is what actually protects the account (125 bits, scrypt-hashed server-side,
 * rate-limited). This form's job is only to be typeable on a phone: it accepts the passphrase with or
 * without its dashes and in any case, because the server folds both away before hashing.
 */
const GuestLoginPanel = () => {
    const { refreshSession } = useAuth();
    const [open, setOpen] = useState(false);
    const [username, setUsername] = useState('');
    const [passphrase, setPassphrase] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const submit = async (e) => {
        e.preventDefault();
        if (busy) return;

        setBusy(true);
        setError('');

        try {
            await guestLogin(username.trim(), passphrase);
            // No navigation here. Asking AuthContext to re-check makes `user` appear, LandingPage's
            // existing effect sees it and routes onward — the same path a Channel-i login takes, so
            // there is one flow to maintain rather than two that can drift.
            refreshSession();
        } catch (err) {
            const status = err?.response?.status;
            if (status === 429) {
                setError('Too many attempts. Please wait a few minutes and try again.');
            } else if (status === 404) {
                // The route 404s when guest login is not enabled on the server it is talking to.
                setError('Guest access is not enabled on this server.');
            } else if (status === 401) {
                setError(err?.response?.data?.message || 'That username or passphrase is not correct.');
            } else {
                setError('Could not reach the server. Check your connection and try again.');
            }
            setBusy(false);
        }
    };

    if (!open) {
        return (
            <button type="button" className="guest-open-btn" onClick={() => setOpen(true)}>
                <div className="guest-btn-icon-wrap">
                    <KeyRound size={22} />
                </div>
                <div className="guest-btn-text">
                    <span className="guest-btn-title">Continue as Guest</span>
                    <span className="guest-btn-subtitle">For reviewers &amp; invited testers</span>
                </div>
                <span className="guest-btn-arrow">›</span>
            </button>
        );
    }

    return (
        <form className="guest-form" onSubmit={submit}>
            <label className="guest-label" htmlFor="guest-username">Username</label>
            <input
                id="guest-username"
                className="guest-input"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                placeholder="playstore-tester"
                disabled={busy}
            />

            <label className="guest-label" htmlFor="guest-passphrase">Passphrase</label>
            <input
                id="guest-passphrase"
                className="guest-input guest-input-mono"
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete="current-password"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck="false"
                placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
                disabled={busy}
            />
            <p className="guest-hint">Dashes and capitalisation are optional.</p>

            {error && <p className="guest-error" role="alert">{error}</p>}

            <button type="submit" className="guest-submit" disabled={busy || !username.trim() || !passphrase.trim()}>
                {busy ? <><Loader2 size={16} className="guest-spinner" /> Signing in…</> : 'Sign in'}
            </button>

            <button
                type="button"
                className="guest-cancel"
                onClick={() => { setOpen(false); setError(''); setPassphrase(''); }}
                disabled={busy}
            >
                Cancel
            </button>
        </form>
    );
};

export default GuestLoginPanel;
