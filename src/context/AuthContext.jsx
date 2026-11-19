import React, { createContext, useState, useEffect, useContext, useCallback, useMemo } from 'react';
import authService from '../services/auth';
import eventReminderService from '../services/eventReminders';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [backendSlow, setBackendSlow] = useState(false);
    const [notificationVersion, setNotificationVersion] = useState(0);
    // Bumped to re-run the session check without a page reload. Signing in as a guest happens inside
    // the app rather than via a redirect from Channel-i, so there is no fresh boot to pick up the new
    // session — this is what stands in for it.
    const [sessionVersion, setSessionVersion] = useState(0);

    const syncNotifications = useCallback(() => {
        setNotificationVersion((version) => version + 1);
    }, []);

    const notifications = useMemo(() => {
        const entries = eventReminderService.getReminderEntries();
        return entries.map((entry) => ({
            id: String(entry.id),
            title: entry.name,
            time: new Date(entry.tentative_start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            date: new Date(entry.tentative_start_time).toLocaleDateString('en-IN'),
            tentative_start_time: entry.tentative_start_time,
            offsetsMinutes: entry.offsetsMinutes,
        }));
    }, [notificationVersion]);

    useEffect(() => {
        const onStorage = (event) => {
            if (event.key === 'event-reminder-subscriptions-v1' || event.key === null) {
                syncNotifications();
            }
        };

        const onFocus = () => {
            syncNotifications();
        };

        const onRemindersUpdated = () => {
            syncNotifications();
        };

        window.addEventListener('storage', onStorage);
        window.addEventListener('focus', onFocus);
        window.addEventListener('event-reminders-updated', onRemindersUpdated);

        // Track if component is mounted to prevent state updates after unmount
        let isMounted = true;

        // Check if user is logged in
        const checkAuth = async () => {
            // Show a "backend is waking up" hint after 8 seconds
            const slowTimer = setTimeout(() => {
                if (isMounted) setBackendSlow(true);
            }, 8000);

            try {
                // 1. Identity Check - includes admin status and other privileges from JWT
                const userData = await authService.getCurrentUser();
                if (isMounted) {
                    setUser({
                        ...userData,
                        managedClubIds: Array.isArray(userData?.managedClubIds) ? userData.managedClubIds : [],
                        canManageClubs: userData?.canManageClubs === true,
                        canManageLocations: userData?.canManageLocations === true,
                        canManageEventCategories: userData?.canManageEventCategories === true,
                        canManageEvents: userData?.canManageEvents === true,
                        canManageAdmins: userData?.canManageAdmins === true,
                        canManageClubAdmins: userData?.canManageClubAdmins === true,
                        canManageAcademicCalendar: userData?.canManageAcademicCalendar === true,
                        preferredClubs: Array.isArray(userData?.preferredClubs) ? userData.preferredClubs : [],
                        notPreferredClubs: Array.isArray(userData?.notPreferredClubs) ? userData.notPreferredClubs : [],
                        preferredCategories: Array.isArray(userData?.preferredCategories) ? userData.preferredCategories : [],
                        notPreferredCategories: Array.isArray(userData?.notPreferredCategories) ? userData.notPreferredCategories : [],
                    });
                }

                eventReminderService.scheduleStoredReminders();
                syncNotifications();
            } catch (error) {
                // Identity fetch failed (401) is the expected path for logged-out users
                const status = error?.response?.status;
                const isUnauthorized = status === 401 || status === 403;

                if (isMounted) {
                    setUser(null);
                    if (isUnauthorized) {
                        setNotificationVersion(0);
                    } else {
                        syncNotifications();
                    }
                }

                if (isUnauthorized) {
                    eventReminderService.clearLocalCache();
                    setNotificationVersion(0);
                }
            } finally {
                clearTimeout(slowTimer);
                if (isMounted) {
                    setBackendSlow(false);
                    setLoading(false);
                }
            }
        };

        checkAuth();

        // Cleanup function to mark component as unmounted
        return () => {
            isMounted = false;
            window.removeEventListener('storage', onStorage);
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('event-reminders-updated', onRemindersUpdated);
        };
    }, [syncNotifications, sessionVersion]);

    const toggleNotification = async (event) => {
        const eventId = String(event?.id || '');
        if (!eventId) return;

        const reminder = eventReminderService
            .getReminderEntries()
            .find((entry) => String(entry.id) === eventId);

        if (!reminder) {
            syncNotifications();
            return;
        }

        await eventReminderService.toggleReminder(reminder);
        syncNotifications();
    };

    const login = () => {
        authService.login();
    };

    /**
     * Re-run the session check against the server.
     *
     * The Channel-i flow never needs this: it leaves the site and comes back to a freshly booted app,
     * so the check runs naturally on mount. A sign-in that happens WITHOUT a page load — the native
     * build's tester login — has no such boot, and this stands in for it.
     *
     * Deliberately named for what it does rather than for its one caller, so nothing in the shared
     * bundle carries guest vocabulary (see services/guestAuth.js).
     */
    const refreshSession = useCallback(() => {
        setSessionVersion((version) => version + 1);
    }, []);

    const logout = () => {
        authService.logout();
        eventReminderService.clearLocalCache();
        setUser(null);
        setNotificationVersion(0);
    };

    const updateUserPreferences = (nextPrefs) => {
        setUser((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                preferredClubs: Array.isArray(nextPrefs?.preferred_clubs) ? nextPrefs.preferred_clubs : prev.preferredClubs,
                notPreferredClubs: Array.isArray(nextPrefs?.not_preferred_clubs) ? nextPrefs.not_preferred_clubs : prev.notPreferredClubs,
                preferredCategories: Array.isArray(nextPrefs?.preferred_categories) ? nextPrefs.preferred_categories : prev.preferredCategories,
                notPreferredCategories: Array.isArray(nextPrefs?.not_preferred_categories) ? nextPrefs.not_preferred_categories : prev.notPreferredCategories,
            };
        });
    };

    return (
        <AuthContext.Provider value={{ user, loading, backendSlow, login, refreshSession, logout, notifications, toggleNotification, updateUserPreferences }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
