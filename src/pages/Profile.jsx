import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Check, ChevronDown, ChevronUp, Loader, LogOut, Mail, Search, Settings, X } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import useSWR from 'swr';
import tinkeringLogo from '../assets/tinkering_logo.png';
import clubsService from '../services/clubs';
import userService from '../services/user';
import NotificationSettings from '../components/Notifications/NotificationSettings';
import './Profile.css';

const emptyPreferences = {
    preferred_clubs: [],
    not_preferred_clubs: [],
    preferred_categories: [],
    not_preferred_categories: [],
};

const ProfilePage = () => {
    const [notifOpen, setNotifOpen] = useState(false);
    const navigate = useNavigate();
    const { user, logout, updateUserPreferences } = useAuth();
    const { data: clubsData, isLoading: clubsLoading, error: clubsError } = useSWR(
        'all_clubs',
        () => clubsService.getAllClubs()
    );

    // The all-categories fetch that used to sit here was removed: its DATA was never read (it existed
    // for a category picker that was never built), but its loading/error state gated this page's
    // spinner — so Profile was delaying its own render waiting on a request it then discarded.
    // To bring it back with the picker:
    //   const { data: categoriesData, isLoading: categoriesLoading, error: categoriesError } =
    //       useSWR('all_categories', () => miscService.getAllEventCategories());
    // (that also needs `import miscService from '../services/misc';` and useMemo back in the React
    //  import — both were removed here because nothing else in this file used them.)
    // ...and put categoriesLoading / categoriesError back into `loading` and `error` below.

    const clubs = clubsData || [];
    const loading = clubsLoading;
    const error = clubsError ? 'Could not load preferences. Please refresh and try again.' : '';
    
    const [preferences, setPreferences] = useState(emptyPreferences);
    const [saving, setSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [clubSearch, setClubSearch] = useState('');
    const [expandedClubId, setExpandedClubId] = useState(null);
    const [clubFilter, setClubFilter] = useState('all');   // 'all' | 'shown' | 'hidden'

    // (A stickyClubIdsRef used to live here, to stop a row vanishing under the user's finger when
    // they unticked a club while on the "Shown" tab. Superseded by pendingClubIds below: an unsaved
    // row is pinned to the top of the list for the whole editing session and is shown under EVERY
    // filter, so it can never disappear as a result of the toggle that changed it.)

    useEffect(() => {
        setPreferences({
            preferred_clubs: Array.isArray(user?.preferredClubs) ? user.preferredClubs.map(Number) : [],
            not_preferred_clubs: Array.isArray(user?.notPreferredClubs) ? user.notPreferredClubs.map(Number) : [],
            preferred_categories: Array.isArray(user?.preferredCategories) ? user.preferredCategories.map(Number) : [],
            not_preferred_categories: Array.isArray(user?.notPreferredCategories) ? user.notPreferredCategories.map(Number) : [],
        });
    }, [
        user?.preferredClubs,
        user?.notPreferredClubs,
        user?.preferredCategories,
        user?.notPreferredCategories,
    ]);

    useEffect(() => {
        if (!notifOpen) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') setNotifOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [notifOpen]);

    const handleLogout = async () => {
        await logout();
        navigate('/');
    };

    // ── Explicit save ───────────────────────────────────────────────────────────────────────────
    // Preferences used to autosave on a 700ms debounce. That removed the moment of commitment, and
    // with it any way to see what you had just changed: a club you unchecked was persisted instantly
    // and immediately re-sorted to the BOTTOM of a very long list, so undoing it meant scrolling past
    // every other club to find it. There was nowhere to look and nothing to press.
    //
    // Now a toggle is local until you press Save. Everything changed in this sitting is held at the
    // TOP of the list, and a bar reports the count, so the thing you just did is the thing in front
    // of you.
    const persistPreferences = useCallback(async (prefs) => {
        if (!user) return;
        setSaving(true);
        setErrorMessage('');
        try {
            const response = await userService.updatePreferences(prefs);
            if (response?.authContext) {
                updateUserPreferences(response.authContext);
            }
            setSaveMessage('Saved');
        } catch (saveError) {
            console.error('Failed to update preferences', saveError);
            setSaveMessage('');
            setErrorMessage('Could not save — your changes are not stored.');
        } finally {
            setSaving(false);
        }
    }, [user, updateUserPreferences]);

    // What the SERVER currently holds, to diff against.
    const savedHiddenClubs = useMemo(
        () => new Set((Array.isArray(user?.notPreferredClubs) ? user.notPreferredClubs : []).map(Number)),
        [user?.notPreferredClubs]
    );

    // Clubs whose visibility differs from what is saved — in EITHER direction, so unchecking a club
    // and re-checking it correctly leaves nothing pending rather than counting as two changes.
    const pendingClubIds = useMemo(() => {
        const current = new Set(preferences.not_preferred_clubs.map(Number));
        const out = new Set();
        current.forEach((id) => { if (!savedHiddenClubs.has(id)) out.add(id); });
        savedHiddenClubs.forEach((id) => { if (!current.has(id)) out.add(id); });
        return out;
    }, [preferences.not_preferred_clubs, savedHiddenClubs]);

    const hasUnsaved = pendingClubIds.size > 0;

    const handleSavePreferences = () => persistPreferences(preferences);

    const handleDiscardChanges = () => {
        setSaveMessage('');
        setErrorMessage('');
        setPreferences((prev) => ({ ...prev, not_preferred_clubs: Array.from(savedHiddenClubs) }));
    };

    // Leaving with unsaved changes silently discards them, which is the failure mode an explicit save
    // button invites. The browser prompt is the only thing that can interrupt a tab close.
    useEffect(() => {
        if (!hasUnsaved) return undefined;
        const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [hasUnsaved]);

    const toggleClubVisibility = (id) => {
        setSaveMessage('');
        setPreferences((prev) => {
            const blocked = new Set(prev.not_preferred_clubs);
            if (blocked.has(id)) {
                blocked.delete(id);
            } else {
                blocked.add(id);
            }
            return { ...prev, not_preferred_clubs: Array.from(blocked) };
        });
    };

    // (preferredClubSet / blockedClubSet were here: Sets built for fast lookups that nothing ever
    // looked up — the club rows read `preferences.not_preferred_clubs.includes(...)` directly.
    // Pre-existing, unrelated to the categories note below, removed while nearby.)

    // NOT BUILT (deliberately): a category picker to sit beside the club list below. Two Sets were
    // computed here and never rendered — removed as dead code, not as a feature decision. The save
    // path already carries preferred_categories / not_preferred_categories, so finishing this is a
    // second list rendered like the club one, plus one clause in the Home feed filter. See the
    // matching note in Home.jsx.

    return (
        <div className="alerts-page">
            <div className="page-header-bar">
                <h1>Profile</h1>
            </div>

            {user && (
                <div className="alerts-profile-card">
                    <div className="alerts-profile-main">
                        {user.display_picture ? (
                            <img
                                src={"https://channeli.in" + user.display_picture}
                                alt={user.full_name}
                                className="alerts-avatar"
                            />
                        ) : (
                            <div className="alerts-avatar-placeholder">
                                {(user.full_name || 'U').charAt(0).toUpperCase()}
                            </div>
                        )}
                        <div className="alerts-profile-info">
                            <span className="alerts-profile-name">{user.full_name}</span>
                            <span className="alerts-profile-sub">{user.enrolment_number || user.branch || ''}</span>
                        </div>
                    </div>
                    <div className="alerts-profile-actions">
                        {/* Notification settings live HERE, next to Logout, not in a section further
                            down. Below the club list they sat under ~70 rows of checkboxes, which is
                            where a setting goes to never be found. */}
                        <button
                            type="button"
                            className="profile-settings-btn"
                            onClick={() => setNotifOpen(true)}
                            aria-label="Notification settings"
                            title="Notification settings"
                        >
                            <Settings size={16} />
                        </button>
                        <button type="button" className="profile-logout-btn" onClick={handleLogout}>
                            <LogOut size={16} />
                            <span>Logout</span>
                        </button>
                    </div>
                </div>
            )}

            <div className="alerts-section">
                <div className="alerts-section-header">
                    <h2>Feed Preferences</h2>
                    {/* No save button: changes persist themselves. This is the status readout, plus
                        an explicit retry if a save failed — without one, autosave failure would be a
                        dead end for the user. aria-live so it's announced rather than silently swapped. */}
                    {/* The save bar below reports state and owns the actions. A second readout here
                        said "Saved" beside the bar's "All preferences saved" — the same fact twice. */}
                </div>

                {loading ? (
                    <div className="prefs-loading card">
                        <Loader size={26} className="spin" />
                        <p>Loading your preferences...</p>
                    </div>
                ) : (
                    <div className="prefs-editor card">
                        {error && <p className="prefs-error-text">{error}</p>}
                        {errorMessage && <p className="prefs-error-text">{errorMessage}</p>}

                        {/* Reports what is unsaved and gives it somewhere to be pressed. Sits ABOVE the
                            club list, not below it: a bar under dozens of rows is a bar nobody scrolls
                            to, which is how autosave got adopted in the first place. */}
                        <div className={`prefs-save-bar ${hasUnsaved ? 'dirty' : ''}`} aria-live="polite">
                            <span className="prefs-save-bar-text">
                                {hasUnsaved
                                    ? `${pendingClubIds.size} unsaved change${pendingClubIds.size === 1 ? '' : 's'}`
                                    : 'All preferences saved'}
                            </span>
                            <div className="prefs-save-bar-actions">
                                {hasUnsaved && (
                                    <button type="button" className="btn-discard-prefs" onClick={handleDiscardChanges} disabled={saving}>
                                        Discard
                                    </button>
                                )}
                                <button
                                    type="button"
                                    className="btn-save-prefs"
                                    onClick={handleSavePreferences}
                                    disabled={saving || (!hasUnsaved && !errorMessage)}
                                >
                                    {saving ? 'Saving…' : errorMessage ? 'Retry save' : 'Save preferences'}
                                </button>
                            </div>
                        </div>

                        <section className="prefs-block">
                            <h3>Clubs</h3>
                            {/* "events and notices", not "events": the preference only ever filtered
                                events, so un-following a club left its notices in the feed. Now that it
                                covers both, the copy has to say so — otherwise hiding a club appears to
                                half-work. */}
                            <p>All clubs are enabled by default. Uncheck a club to hide its events and notices from your feed, then press Save preferences.</p>

                            {/* Shown / Hidden. The club list runs to dozens of rows, so "which ones did
                                I turn off?" previously meant scrolling the entire thing — hidden clubs
                                sort to the bottom. This answers it in one tap. */}
                            <div className="pref-filter-tabs" role="tablist" aria-label="Filter clubs">
                                {[['all', 'All'], ['shown', 'Shown'], ['hidden', 'Hidden']].map(([v, label]) => {
                                    const n = v === 'all' ? clubs.length
                                        : v === 'hidden' ? clubs.filter((c) => preferences.not_preferred_clubs.includes(Number(c.id))).length
                                            : clubs.filter((c) => !preferences.not_preferred_clubs.includes(Number(c.id))).length;
                                    return (
                                        <button key={v} type="button" role="tab" aria-selected={clubFilter === v}
                                            className={`pref-filter-tab ${clubFilter === v ? 'active' : ''}`}
                                            onClick={() => setClubFilter(v)}>
                                            {label} <span className="pref-filter-count">{n}</span>
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="pref-search-wrap">
                                <Search size={15} className="pref-search-icon" />
                                <input
                                    type="text"
                                    className="pref-search-input"
                                    placeholder="Search clubs..."
                                    value={clubSearch}
                                    onChange={(e) => setClubSearch(e.target.value)}
                                />
                                {clubSearch && (
                                    <button className="pref-search-clear" onClick={() => setClubSearch('')}>✕</button>
                                )}
                            </div>
                            <div className="pref-ui-editor pref-ui-list">
                                {clubs
                                    .filter((club) => club.name.toLowerCase().includes(clubSearch.toLowerCase()))
                                    .filter((club) => {
                                        // An unsaved row is shown under every filter. Otherwise the act of
                                        // unticking a club on the "Shown" tab removes the row you just
                                        // touched, leaving nothing to undo.
                                        if (pendingClubIds.has(Number(club.id))) return true;
                                        if (clubFilter === 'all') return true;
                                        const hidden = preferences.not_preferred_clubs.includes(Number(club.id));
                                        return clubFilter === 'hidden' ? hidden : !hidden;
                                    })
                                    .sort((a, b) => {
                                        // Ordered by what is SAVED, never by the live checkbox: shown first,
                                        // hidden at the bottom. Sorting on the live state made a row leap the
                                        // length of the list the instant you ticked it — re-checking a hidden
                                        // club threw it to the top before you had saved anything. A toggle now
                                        // only ticks the box; the row moves when the save lands.
                                        //
                                        // Alphabetical WITHIN each group, because GET /clubs is a bare
                                        // findAll() with no ORDER BY: the rows arrive in table order, so a
                                        // club you re-checked resurfaced at some arbitrary point in the list
                                        // instead of the place you would go looking for it.
                                        const rank = (c) => (savedHiddenClubs.has(Number(c.id)) ? 1 : 0);
                                        return rank(a) - rank(b) || a.name.localeCompare(b.name);
                                    })
                                    .map((club) => {
                                        const isHidden = preferences.not_preferred_clubs.includes(Number(club.id));
                                        const isChecked = !isHidden;
                                        const isPending = pendingClubIds.has(Number(club.id));
                                        const isExpanded = expandedClubId === club.id;

                                        return (
                                            <div key={club.id} className={`pref-club-card-container ${isPending ? 'pending' : ''}`}>
                                                <div 
                                                    className={`pref-club-row ${isHidden ? 'is-hidden' : ''}`}
                                                    onClick={() => setExpandedClubId(isExpanded ? null : club.id)}
                                                >
                                                    <div className="pref-club-main">
                                                        <div className="pref-club-avatar">
                                                            {club.logo_url ? (
                                                                <img src={club.logo_url} alt="" />
                                                            ) : (
                                                                <div className="pref-club-avatar-fallback">
                                                                    <Building2 size={16} />
                                                                </div>
                                                            )}
                                                        </div>
                                                        <span className="pref-club-name">{club.name}</span>
                                                    </div>
                                                    
                                                    <div className="pref-club-actions">
                                                        <input
                                                            type="checkbox"
                                                            checked={isChecked}
                                                            onChange={(e) => {
                                                                e.stopPropagation();
                                                                toggleClubVisibility(Number(club.id));
                                                            }}
                                                            className="pref-checkbox"
                                                        />
                                                        <div className="pref-expand-icon">
                                                            {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                                                        </div>
                                                    </div>
                                                </div>

                                                {isExpanded && (
                                                    <div className="pref-club-details animate-fade-in">
                                                        {club.description ? (
                                                            <p className="pref-club-desc">{club.description}</p>
                                                        ) : (
                                                            <p className="pref-club-desc-empty">No description available.</p>
                                                        )}
                                                        {club.email && (
                                                            <a href={`mailto:${club.email}`} className="pref-club-email-link">
                                                                <Mail size={14} />
                                                                <span>{club.email}</span>
                                                            </a>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })
                                }
                                {clubs.filter((club) => club.name.toLowerCase().includes(clubSearch.toLowerCase())).length === 0 && (
                                    <p className="pref-search-empty">No clubs match your search.</p>
                                )}
                            </div>
                        </section>
                    </div>
                )}
            </div>

            {notifOpen && (
                <div
                    className="notif-sheet-backdrop"
                    onClick={() => setNotifOpen(false)}
                    role="presentation"
                >
                    {/* stopPropagation so a click inside the panel does not dismiss it */}
                    <div
                        className="notif-sheet"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Notification settings"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            className="notif-sheet-close"
                            onClick={() => setNotifOpen(false)}
                            aria-label="Close notification settings"
                        >
                            <X size={18} />
                        </button>
                        <NotificationSettings />
                    </div>
                </div>
            )}

            <div className="alerts-footer">
                <div className="alerts-footer-logos">
                    <img src={tinkeringLogo} alt="Tinkering Labs" className="footer-tl-logo" />
                </div>
                <p>Made with <span className="heart">❤</span> by Tinkering Lab</p>
            </div>
        </div>
    );
};

export default ProfilePage;
