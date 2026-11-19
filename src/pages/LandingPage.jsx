import React from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router';
import { takeReturnTo } from '../utils/returnTo';
import { User, ShieldCheck, HelpCircle } from 'lucide-react';
import iitrLogo from '../assets/iitr_logo.png';
import tinkeringLogo from '../assets/tinkering_logo.png';
import './LandingPage.css';

/**
 * The Android build signs in differently from the website, and this is where the two part ways.
 *
 * Channel-i only knows IITR students, so a Play Store reviewer cannot use it — the app would be
 * un-reviewable, every screen locked behind a login they can never pass. The native build therefore
 * offers a credentialed guest door instead of the two Channel-i buttons.
 *
 * `__MOBILE_BUILD__` is substituted by vite with a literal boolean, so on the web this whole branch is
 * `false` and rollup never follows the import: the guest panel is not merely hidden on
 * campus-dashboard.iitr.ac.in, its code is not in the bundle a student's browser downloads.
 */
const GuestLoginPanel = __MOBILE_BUILD__
    ? React.lazy(() => import('../components/Auth/GuestLoginPanel'))
    : null;

const LandingPage = () => {
    const { login, user, loading } = useAuth();
    const navigate = useNavigate();

    // If already logged in, go to home
    React.useEffect(() => {
        if (!loading && user) {
            // Back to whatever they originally clicked (a shared /notices/17 link), else the default.
            navigate(takeReturnTo() || '/home');
        }
    }, [user, loading, navigate]);

    return (
        <div className="landing-page">
            <div className="landing-body">
                {/* App Logos Area */}
                <div className="landing-logo-area">
                    <img src={iitrLogo} alt="IITR Logo" className="landing-brand-logo iitr" />
                    {/* <img src={tinkeringLogo} alt="Tinkering Labs Logo" className="landing-brand-logo tinkering" /> */}
                </div>

                {/* Tagline */}
                <div className="landing-hero">
                    <h1 className="landing-headline">
                        IITR<br />Campus<br />Dashboard
                    </h1>
                    <p className="landing-subtext">
                        Access the pulse of Roorkee. Events, hackathons, fests, and workshops—all in one place.
                    </p>
                </div>

                {/* Login Buttons */}
                <div className="landing-actions">
                    {__MOBILE_BUILD__ ? (
                        // Channel-i is deliberately absent from the native build. Its flow leaves the
                        // app for channeli.in and returns by setting a cookie on our own domain — a
                        // round trip that simply does not land back inside a WebView served from
                        // https://localhost. Showing a button that cannot work would be worse than
                        // showing none, so the native build offers the one door that does work.
                        <React.Suspense fallback={null}>
                            <GuestLoginPanel />
                        </React.Suspense>
                    ) : (
                        <>
                            <button className="landing-btn-student" onClick={login}>
                                <div className="landing-btn-icon-wrap">
                                    <User size={22} />
                                </div>
                                <div className="landing-btn-text">
                                    <span className="landing-btn-title">Student Login</span>
                                    <span className="landing-btn-subtitle">Access via Channel-I SSO</span>
                                </div>
                                <span className="landing-btn-arrow">›</span>
                            </button>

                            <button className="landing-btn-admin" onClick={login}>
                                <div className="landing-btn-icon-wrap">
                                    <ShieldCheck size={22} />
                                </div>
                                <div className="landing-btn-text">
                                    <span className="landing-btn-title">Admin Login</span>
                                    <span className="landing-btn-subtitle">Club &amp; Platform Management</span>
                                </div>
                                <span className="landing-btn-arrow">›</span>
                            </button>
                        </>
                    )}

                    <button className="landing-help-btn">
                        <HelpCircle size={16} />
                        Need help signing in?
                    </button>
                </div>
            </div>

            {/* Footer */}
            <div className="landing-footer">
                <div className="landing-footer-logos">
                    <img src={tinkeringLogo} alt="Tinkering Labs" className="footer-tl-logo" />
                </div>
                <p className="landing-footer-text">
                    made with <span className="heart">❤</span> by tinkering labs
                </p>
            </div>
        </div>
    );
};

export default LandingPage;
