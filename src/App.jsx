import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router';
import RequireAuth from './components/RequireAuth';
import { SWRConfig } from 'swr';
import { AuthProvider } from './context/AuthContext';
import BottomNav from './components/Layout/BottomNav';
import Home from './pages/Home';
import CalendarPage from './pages/Calendar';
import Admin from './pages/Admin';
import Todo from './pages/Todo';
import LandingPage from './pages/LandingPage';
import ProfilePage from './pages/Profile';
import NotificationsPage from './pages/Notifications';
import EventDetail from './pages/EventDetail';
import NoticeDetail from './pages/NoticeDetail';
import NotFound from './pages/NotFound';
import InstallPrompt from './components/Widgets/InstallPrompt';
import ToastViewport from './components/Common/ToastViewport';
import './App.css';

// Shell layout that wraps pages needing the bottom navigation
const AppShell = ({ children }) => {
    return (
        <div className="app-shell">
            <main className="app-main">
                {children}
            </main>
            <BottomNav />
        </div>
    );
};

function App() {
    return (
        // The website lives under /app/ (the marketing landing page owns the root); Capacitor serves
        // the bundle from the root of its own local server, where an /app prefix matches no route.
        // This must agree with `base` in vite.config.js or every deep link 404s.
        <Router basename={__MOBILE_BUILD__ ? '/' : '/app'}>
            <SWRConfig 
                value={{
                    refreshInterval: 30000, 
                    revalidateOnFocus: true,
                    revalidateOnReconnect: true
                }}
            >
                <AuthProvider>
                    <Routes>
                        {/* Public Landing Route (No Bottom Nav) */}
                        <Route path="/" element={<LandingPage />} />

                        {/* App Routes (with Bottom Nav) */}
                        <Route path="/home" element={<RequireAuth><AppShell><Home /></AppShell></RequireAuth>} />
                        <Route path="/calendar" element={<RequireAuth><AppShell><CalendarPage /></AppShell></RequireAuth>} />
                        <Route path="/todo" element={<RequireAuth><AppShell><Todo /></AppShell></RequireAuth>} />
                        <Route path="/profile" element={<RequireAuth><AppShell><ProfilePage /></AppShell></RequireAuth>} />
                        <Route path="/notifications" element={<RequireAuth><AppShell><NotificationsPage /></AppShell></RequireAuth>} />
                        <Route path="/admin" element={<RequireAuth><AppShell><Admin /></AppShell></RequireAuth>} />
                        <Route path="/event/:eventId" element={<RequireAuth><AppShell><EventDetail /></AppShell></RequireAuth>} />
                        <Route path="/notices/:id" element={<RequireAuth><AppShell><NoticeDetail /></AppShell></RequireAuth>} />

                        {/* Catch-all — an undefined path previously rendered a blank white page.
                            Deliberately outside RequireAuth: a logged-out visitor following a dead
                            link should see the 404, not be bounced to a login they didn't ask for. */}
                        <Route path="*" element={<NotFound />} />
                    </Routes>
                    <InstallPrompt />
                    <ToastViewport />
                </AuthProvider>
            </SWRConfig>
        </Router>
    );
}

export default App;
