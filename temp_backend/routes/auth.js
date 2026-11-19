const express = require('express');
const router = express.Router();
const axios = require('axios');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const {
    User,
    AdminPermissionAlloted,
    AdminPermission,
    ClubAdmin,
    Club,
    UserPreferredClub,
    UserNotPreferredClub,
    UserPreferredCategory,
    UserNotPreferredCategory,
    sequelize
} = require('../database/schemas');
const { userLoggedIn, userData } = require('../middlewares/userAuth');
const { PERM, permissionId } = require('../utils/permissions');
const { recordSecurityEvent, ACTIONS } = require('../utils/activityLog');
const { getGuestConfig, verifyGuestCredential } = require('../utils/guestCredential');
const { GUEST_USER_ID } = require('../middlewares/guestGuard');

const AUTHORIZE_URL = process.env.authoriseURL;
const CLIENT_ID = process.env.client_id;
const REDIRECT_URI = process.env.redirectURL;
const token_URL = process.env.token_URL;
const client_secret_id = process.env.client_secret_id;

const normalizePermissionName = (name) => String(name || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

// ── DEV-ONLY login (NEVER runs in production) ───────────────────────────────
// Guarded by NODE_ENV + DEV_LOGIN. Creates a local admin user, grants the
// academic-calendar permission, and logs you in WITHOUT Channel-i. Just open
// http://127.0.0.1:8081/oauth/dev-login in your browser.
// Registered ONLY outside production → in prod this route DOESN'T EXIST (404), not merely guarded by a
// runtime check that leans on NODE_ENV being correct. Still needs DEV_LOGIN=true even in dev.
if (process.env.NODE_ENV !== 'production' && process.env.RENDER !== 'true') {
router.get('/dev-login', async (req, res) => {
    if (process.env.DEV_LOGIN !== 'true') {
        return res.status(404).json({ error: 'Not found' });
    }
    try {
        const DEV_USER_ID = 999000001;
        await User.findOrCreate({
            where: { user_id: DEV_USER_ID },
            defaults: {
                user_id: DEV_USER_ID,
                full_name: 'Dev Admin',
                email: 'dev.admin@localhost.test',
                enrolment_number: 'DEV000001',
                branch: 'CSE',
                current_year: 4,
            },
        });

        // Grant super-admin (manage_admins) — required for the academic calendar,
        // and makes the dev user a full admin for local testing.
        const [perm] = await AdminPermission.findOrCreate({
            where: { name: 'manage_admins' },
            defaults: { name: 'manage_admins' },
        });
        await AdminPermissionAlloted.findOrCreate({
            where: { user_id: DEV_USER_ID, admin_permission_id: perm.id },
            defaults: { user_id: DEV_USER_ID, admin_permission_id: perm.id },
        });

        // `tv` is mandatory now (see middlewares/userAuth.verifySession) — without it this dev token
        // is rejected on every request. Read the real counter so bumping it revokes dev sessions too.
        const devTvRow = await User.findByPk(DEV_USER_ID, { attributes: ['token_version'], raw: true });
        const token = jwt.sign(
            { user_id: DEV_USER_ID, tv: Number(devTvRow?.token_version || 0) },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );
        res.cookie('auth_token', token, {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            maxAge: 30 * 24 * 60 * 60 * 1000,
            path: '/',
        });
        console.log('✅ dev-login: signed in as Dev Admin (user 999000001)');
        // /app/home, not /home. The SPA mounts at basename "/app" (src/App.jsx) behind vite's
        // base "/app/", so a bare /home is not a route: with FRONTEND_REDIRECT_URL unset you
        // authenticate successfully and land on a 404, which reads as a broken login.
        return res.redirect(process.env.FRONTEND_REDIRECT_URL || 'http://127.0.0.1:5173/app/home');
    } catch (error) {
        console.error('dev-login error:', error);   // detail stays server-side
        return res.status(500).json({ error: 'dev-login failed' });
    }
});
}   // end non-production gate for /dev-login

// ── Play Store tester login ─────────────────────────────────────────────────
// Google's reviewers cannot authenticate with Channel-i — it only knows IITR students — so without a
// second door the Android app is un-reviewable: every screen behind the login is invisible to them.
// This is that door, and it is the only credential-based login in the system.
//
// The security posture, in short: a 125-bit passphrase, stored only as a scrypt hash, compared in
// constant time, behind a dedicated rate limiter, issuing a session that CANNOT write anything the
// campus can see (middlewares/guestGuard.js). The route does not exist at all unless
// GUEST_LOGIN_ENABLED=true, so on any deployment that has not opted in this is a 404.
//
// Two properties worth stating plainly, because they are what "only the credentials we give them work"
// actually requires:
//   - There is no default, no fallback and no dev shortcut. A missing or malformed
//     GUEST_LOGIN_PASSWORD_HASH disables the route rather than accepting anything (getGuestConfig).
//   - Nothing in this repository, this database or any log line contains the passphrase. It exists
//     only where you put it.
//
// To revoke every tester session in flight without changing the passphrase:
//     UPDATE "user" SET token_version = token_version + 1 WHERE user_id = 999000002;
router.post('/guest-login', async (req, res) => {
    const config = getGuestConfig();
    if (!config) {
        // 404, not 403: an unconfigured deployment should not even admit the concept exists.
        return res.status(404).json({ error: 'Not found' });
    }

    try {
        const { username, password } = req.body || {};

        const ok = await verifyGuestCredential(username, password);
        if (!ok) {
            // Marks the attempt as a genuine failure so the auth limiter counts it (see app.js).
            res.locals.guestLoginFailed = true;
            recordSecurityEvent(req, {
                action: ACTIONS.LOGIN_FAILED,
                detail: { reason: 'guest_bad_credential' },
            });
            // One message for both wrong-user and wrong-password. Distinguishing them would confirm a
            // valid username, which is half the credential.
            return res.status(401).json({
                error: 'Invalid credentials',
                message: 'That username or passphrase is not correct.',
            });
        }

        // The account is created on first successful login rather than seeded, so a deployment that
        // never enables guest login never grows the row.
        await User.findOrCreate({
            where: { user_id: GUEST_USER_ID },
            defaults: {
                user_id: GUEST_USER_ID,
                full_name: 'Guest Tester',
                // .invalid is reserved by RFC 2606 and can never be delivered to or registered by
                // anyone, so this address cannot collide with a real student's webmail.
                email: 'guest@campus-dashboard.invalid',
                enrolment_number: 'GUEST00000',
                branch: 'Guest Access',
                current_year: 1,
                branch_department_name: 'Play Store Testing',
            },
        });

        // Same revocation machinery as a real session: `tv` is mandatory in verifySession, and bumping
        // the column kills every guest token at once.
        const tvRow = await User.findByPk(GUEST_USER_ID, { attributes: ['token_version'], raw: true });

        // Shorter than a student's 30 days on purpose. One shared credential means one leaked token is
        // everyone's token, so sessions expire on a timescale where re-typing the passphrase is a mild
        // annoyance rather than a rebuild.
        const ttlHours = Number(process.env.GUEST_SESSION_TTL_HOURS) > 0
            ? Number(process.env.GUEST_SESSION_TTL_HOURS)
            : 168;   // 7 days

        const token = jwt.sign(
            {
                user_id: GUEST_USER_ID,
                guest: true,           // read by guestGuard on every write
                enrolmentNumber: 'GUEST00000',
                branch: 'Guest Access',
                currentYear: 1,
                displayPicture: null,
                // Empty, and never filled in. A guest is a plain student with no club and no admin
                // rights, so every permission check downstream fails closed without a special case.
                permission_names: [],
                club_admin_club_ids: [],
                preferred_clubs: [],
                not_preferred_clubs: [],
                preferred_categories: [],
                not_preferred_categories: [],
                tv: Number(tvRow?.token_version || 0),
            },
            process.env.JWT_SECRET,
            { expiresIn: `${ttlHours}h` }
        );

        const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';

        // Set BOTH. The cookie is what a browser hitting this same-origin would use; the token in the
        // body is what the Android build uses, because Capacitor serves the app from https://localhost
        // and a SameSite=Lax cookie is — correctly — not attached to a cross-site request.
        res.cookie('auth_token', token, {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'lax',
            maxAge: ttlHours * 60 * 60 * 1000,
            path: '/',
        });

        return res.json({
            token,
            expiresInSeconds: ttlHours * 60 * 60,
            guest: true,
        });
    } catch (error) {
        console.error('[guest-login error]', error?.message || error);   // detail stays server-side
        return res.status(500).json({
            error: 'Internal server error',
            message: 'Could not sign you in. Please try again.',
        });
    }
});

// user login with Channel I OAuth
router.get('/login', async (req, res) => {
    const state = crypto.randomBytes(32).toString('hex');
    const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
    
    res.cookie('oauth_state', state, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000, // 10 mins
        path: '/'   // was '/oauth'; behind CloudFront the callback is /api/oauth/token/, so scope to / (10-min CSRF nonce)
    });

    const authURL = `${AUTHORIZE_URL}?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&state=${state}`;
    res.redirect(authURL);
});

// route to get the access token and refresh token
// with help of access token, get the user data and store it in database if it doesn't exist. If it exists, update the user data in database. Then create a JWT with user info and store it in secure HTTP-only cookie
router.get('/token', async (req, res) => {
    try {
        const { code, state } = req.query;
        const storedState = req.cookies.oauth_state;
        
        const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
        res.clearCookie('oauth_state', {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'lax',
            path: '/'   // was '/oauth'; behind CloudFront the callback is /api/oauth/token/, so scope to / (10-min CSRF nonce)
        });

        if (!state || !storedState || state !== storedState) {
            // Rejected here, before any call to channeli.in — so serving this costs nothing and it
            // must not consume the auth rate limit. The cookie is cleared just above, which means a
            // plain RELOAD of this URL always lands here; counting it let anyone lock every user
            // sharing their IP out of login with five requests. See authLimiter in app.js.
            res.locals.oauthCheapReject = true;
            // Logged for the admin security view. Overwhelmingly this is innocent — a reload, a
            // back-button, an expired 10-minute nonce — so it is recorded, never alerted on. A BURST
            // from one IP is the signal worth looking at, which is why the IP is stored.
            recordSecurityEvent(req, {
                action: ACTIONS.LOGIN_FAILED,
                detail: { reason: 'oauth_state_mismatch', had_cookie: !!storedState, had_state: !!state },
            });
            return res.status(403).json({
                error: 'Invalid OAuth state',
                message: 'CSRF protection: state mismatch. Please try logging in again.'
            });
        }

        // send a POST request to token_URL to get the access token
        console.log('[OAuth] Step 1: exchanging code for token at:', token_URL);
        const response = await axios.post(token_URL, {
            client_id: CLIENT_ID,
            client_secret: client_secret_id,
            grant_type: 'authorization_code',
            redirect_uri: REDIRECT_URI,
            code: code
        }, {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            timeout: 15000
        });
        console.log('[OAuth] Step 1 done. Token received.');

        // Fetch user data directly
        const getUserDataURL = process.env.get_user_data_url;
        console.log('[OAuth] Step 2: fetching user data from:', getUserDataURL);
        const userDataResponse = await axios.get(getUserDataURL, {
            headers: {
                "Authorization": `Bearer ${response.data.access_token}`,
            },
            timeout: 15000
        });
        console.log('[OAuth] Step 2 done. User data received.');

        const userData = userDataResponse.data;

        const upsertTimeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('DB upsert timed out after 10s — check DATABASE_URL on Render')), 10000)
        );
        await Promise.race([
            User.upsert({
            user_id: BigInt(userData.userId),
            full_name: userData.person.fullName,
            email: userData.contactInformation.instituteWebmailAddress,
            phone_number: userData.contactInformation.primaryPhoneNumber || null,
            display_picture: userData.person.displayPicture,
            enrolment_number: userData.student.enrolmentNumber,
            branch: userData.student['branch name'],
            current_year: userData.student.currentYear,
            branch_department_name: userData.student['branch department name'],
            updated_at: new Date()
            }),
            upsertTimeout
        ]);

        console.log(`✅ User ${userData.userId} synced to database`);

        const permissionRows = await AdminPermissionAlloted.findAll({
            where: { user_id: userData.userId },
            attributes: ['admin_permission_id']
        });

        const permission_ids = permissionRows.map((row) => Number(row.admin_permission_id));

        const [permissions, clubAdminRows, preferredClubRows, notPreferredClubRows, preferredCategoryRows, notPreferredCategoryRows] = await Promise.all([
            permission_ids.length > 0
                ? AdminPermission.findAll({
                    where: { id: permission_ids },
                    attributes: ['id', 'name']
                })
                : Promise.resolve([]),
            ClubAdmin.findAll({
                where: { user_id: userData.userId },
                attributes: ['club_id']
            }),
            UserPreferredClub.findAll({
                where: { user_id: userData.userId },
                attributes: ['club_id']
            }),
            UserNotPreferredClub.findAll({
                where: { user_id: userData.userId },
                attributes: ['club_id']
            }),
            UserPreferredCategory.findAll({
                where: { user_id: userData.userId },
                attributes: ['event_category_id']
            }),
            UserNotPreferredCategory.findAll({
                where: { user_id: userData.userId },
                attributes: ['event_category_id']
            })
        ]);

        const permission_names = permissions.map((row) => row.name);
        const normalizedPermissionNames = permission_names.map(normalizePermissionName);
        const hasEventCrudPermission = normalizedPermissionNames.includes('event_crud') || permission_ids.includes(permissionId(PERM.EVENT_CRUD));

        let club_admin_club_ids = clubAdminRows.map((row) => Number(row.club_id));
        const preferred_clubs = preferredClubRows.map((row) => Number(row.club_id));
        const not_preferred_clubs = notPreferredClubRows.map((row) => Number(row.club_id));
        const preferred_categories = preferredCategoryRows.map((row) => Number(row.event_category_id));
        const not_preferred_categories = notPreferredCategoryRows.map((row) => Number(row.event_category_id));

        if (hasEventCrudPermission) {
            const allClubs = await Club.findAll({
                attributes: ['id'],
                order: [['id', 'ASC']]
            });
            club_admin_club_ids = allClubs.map((club) => Number(club.id));
        }

        // Create JWT with user info
        const jwtPayload = {
            user_id: userData.userId,
            enrolmentNumber: userData.student.enrolmentNumber,
            branch: userData.student['branch name'],
            currentYear: userData.student.currentYear,
            displayPicture: userData.person.displayPicture,
            permission_names,
            club_admin_club_ids,
            preferred_clubs,
            not_preferred_clubs,
            preferred_categories,
            not_preferred_categories,
        };

        // Lifetime is env-driven so it can be shortened without a code change or redeploy. Still 30d
        // by default: until the Channel-i IP whitelist lands nobody can re-authenticate, so cutting it
        // now would strand every existing session. Set SESSION_TTL_HOURS=24 the moment login works.
        const ttlHours = Number(process.env.SESSION_TTL_HOURS) > 0 ? Number(process.env.SESSION_TTL_HOURS) : 720;
        // Current revocation counter for this account — stamped in so the token can later be killed.
        const tvRow = await User.findByPk(userData.userId, { attributes: ['token_version'], raw: true });
        const token = jwt.sign({ ...jwtPayload, tv: Number(tvRow?.token_version || 0) }, process.env.JWT_SECRET, {
            expiresIn: `${ttlHours}h`
        });

        // Store JWT in secure cookie
        const thirtyDaysInMs = ttlHours * 60 * 60 * 1000;
        res.cookie('auth_token', token, {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'lax',
            maxAge: thirtyDaysInMs,
            path: '/'
        });

        console.log(`✅ JWT created and stored for user ${userData.userId}`);

        // return res.json({ userData: userDataResponse.data });
        return res.redirect(process.env.FRONTEND_REDIRECT_URL || 'http://127.0.0.1:5173/app/home');
    } catch (error) {
        console.error('[OAuth /token error]', error?.message || error);   // full detail stays server-side
        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not sign you in. Please try again.',
        });
    }
});

// route to get the user data
router.get('/user', userData, async (req, res) => {
    try {
        // get user data from database with the id in JWT payload
        const user = await User.findByPk(req.user.user_id, {
            attributes: ['user_id', 'full_name', 'email', 'phone_number', 'display_picture', 'enrolment_number', 'branch', 'current_year', 'branch_department_name', 'is_super_admin']
        });

        if (!user) {
            return res.status(404).json({
                error: 'User not found',
                message: 'No user found with this ID'
            });
        }

        const userId = req.user.user_id;

        // Fetch latest permissions and club admin status from database
        const permissionRows = await AdminPermissionAlloted.findAll({
            where: { user_id: userId },
            attributes: ['admin_permission_id']
        });

        const permission_ids = permissionRows.map((row) => Number(row.admin_permission_id));

        const [permissions, clubAdminRows, preferredClubRows, notPreferredClubRows, preferredCategoryRows, notPreferredCategoryRows] = await Promise.all([
            permission_ids.length > 0
                ? AdminPermission.findAll({
                    where: { id: permission_ids },
                    attributes: ['id', 'name']
                })
                : Promise.resolve([]),
            ClubAdmin.findAll({
                where: { user_id: userId },
                attributes: ['club_id']
            }),
            UserPreferredClub.findAll({
                where: { user_id: userId },
                attributes: ['club_id']
            }),
            UserNotPreferredClub.findAll({
                where: { user_id: userId },
                attributes: ['club_id']
            }),
            UserPreferredCategory.findAll({
                where: { user_id: userId },
                attributes: ['event_category_id']
            }),
            UserNotPreferredCategory.findAll({
                where: { user_id: userId },
                attributes: ['event_category_id']
            })
        ]);

        const permission_names = permissions.map((row) => row.name);
        const normalizedPermissionNames = permission_names.map(normalizePermissionName);
        const hasEventCrudPermission = normalizedPermissionNames.includes('event_crud') || permission_ids.includes(permissionId(PERM.EVENT_CRUD));

        let club_admin_club_ids = clubAdminRows.map((row) => Number(row.club_id));
        const preferred_clubs = preferredClubRows.map((row) => Number(row.club_id));
        const not_preferred_clubs = notPreferredClubRows.map((row) => Number(row.club_id));
        const preferred_categories = preferredCategoryRows.map((row) => Number(row.event_category_id));
        const not_preferred_categories = notPreferredCategoryRows.map((row) => Number(row.event_category_id));

        if (hasEventCrudPermission) {
            const allClubs = await Club.findAll({
                attributes: ['id'],
                order: [['id', 'ASC']]
            });
            club_admin_club_ids = allClubs.map((club) => Number(club.id));
        }

        // Super admin comes from the user row, never from the permission list — that separation is the
        // point (see middlewares/permissions/superAdmin.js). The UI uses it only to decide what to SHOW;
        // every write is re-checked server-side against the database, so a tampered client gains nothing.
        const is_super_admin = user.is_super_admin === true;
        const is_admin = permission_names.length > 0 || is_super_admin;

        return res.json({
            userData: user,
            authContext: {
                is_admin,
                is_super_admin,
                permission_names,
                club_admin_club_ids,
                preferred_clubs,
                not_preferred_clubs,
                preferred_categories,
                not_preferred_categories
            }
        });

    } catch (error) {
        console.log(error);
        return res.status(500).json({
            error: 'Internal server error',
            message: 'Could not fetch user information'
        });
    }
});

// route to logout user by clearing JWT cookie
router.post('/logout', userLoggedIn, async (req, res) => {
    try {
        // Actually revoke the session rather than just asking one browser to forget it. Bumping
        // token_version invalidates every token this account holds, including copies we cannot see.
        try {
            await User.increment('token_version', { by: 1, where: { user_id: req.user.user_id } });
        } catch (e) {
            console.error('logout: token_version bump failed', e.message);   // still clear the cookie
        }
        const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
        res.clearCookie('auth_token', {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'lax',
            path: '/'
        });

        return res.json({
            message: 'Logged out successfully'
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            error: 'Internal server error',
            message: 'Could not logout user'
        });
    }
});

module.exports = router;