import React from 'react';
import { Link } from 'react-router';

/**
 * Catch-all for any path the router doesn't define.
 *
 * Without this, React Router matched nothing and rendered an EMPTY document — a blank white screen
 * with no navigation and no way back. That is what a student got from a mistyped URL, a stale shared
 * link, or /notices (only /notices/:id exists). A dead end is worse than an error.
 */
const NotFound = () => (
    <div style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75rem',
        padding: '2rem',
        textAlign: 'center',
        background: 'var(--brand-purple-pale)',
        color: 'var(--brand-black)',
    }}>
        <p style={{ margin: 0, fontSize: '3rem', fontWeight: 700, color: 'var(--brand-purple)' }}>404</p>
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>This page doesn&apos;t exist</h1>
        <p style={{ margin: 0, maxWidth: '30ch', opacity: 0.75 }}>
            The link may be out of date, or the event or notice it pointed to was removed.
        </p>
        <Link
            to="/home"
            style={{
                marginTop: '0.5rem',
                padding: '0.7rem 1.5rem',
                borderRadius: '999px',
                background: 'var(--brand-purple)',
                color: 'var(--brand-white)',
                fontWeight: 600,
                textDecoration: 'none',
            }}
        >
            Back to feed
        </Link>
    </div>
);

export default NotFound;
