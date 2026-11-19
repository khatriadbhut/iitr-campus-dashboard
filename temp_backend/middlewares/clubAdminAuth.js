const jwt = require('jsonwebtoken');
const { verifySession } = require('./userAuth');
const { AdminPermissionAlloted, Club, ClubAdmin } = require('../database/schemas');
const { PERM, permissionId } = require('../utils/permissions');


/**
 * Middleware to check if user is a club admin
 * Verifies JWT and checks if user is admin of any club
 * Sets req.club_admin with club_ids array
 */
const checkClubAdmin = async (req, res, next) => {
    try {
        const token = req.cookies.auth_token;

        if (!token) {
            return res.status(401).json({
                error: 'No authentication token found',
                message: 'Please login to continue'
            });
        }

        // Verify JWT token
        // Shared verifier: signature + MANDATORY revocation check. Previously this file called
        // jwt.verify directly and never consulted token_version, so a revoked session still worked
        // on every club-admin route.
        const decoded = await verifySession(token);
        const userId = decoded.user_id;

        const permissionCheck = await AdminPermissionAlloted.findOne({
            where: { user_id: userId, admin_permission_id: permissionId(PERM.MANAGE_CLUB_ADMINS) },
            attributes: ['user_id'],
            limit: 1
        });

        if (permissionCheck) {
            const allClubs = await Club.findAll({
                attributes: [['id', 'club_id']],
                order: [['id', 'ASC']]
            });

            req.user = decoded;
            req.club_admin = {
                user_id: userId,
                club_ids: allClubs.map(record => record.dataValues.club_id)
            };

            return next();
        }

        const clubAdminRecords = await ClubAdmin.findAll({
            where: { user_id: userId },
            attributes: ['club_id']
        });

        if (!clubAdminRecords || clubAdminRecords.length === 0) {
            return res.status(403).json({
                error: 'Permission denied',
                message: 'You need to be a club admin to perform this action'
            });
        }

        // Attach user info and club admin info to request
        req.club_admin = {
            club_ids: clubAdminRecords.map(record => record.club_id)
        };

        next();
    } catch (error) {
        console.error('Club admin check error:', error);

        // verifySession also throws SessionRevokedError (missing `tv`, or a bumped token_version).
        // Without this it fell through to a 500, so a logged-out club admin saw an opaque server
        // error instead of being redirected to login — the SPA only redirects on 401.
        if (error.name === 'SessionRevokedError') {
            return res.status(401).json({
                error: 'Session revoked',
                message: 'Your session is no longer valid. Please login again'
            });
        }

        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'Token expired',
                message: 'Your session has expired. Please login again'
            });
        }

        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                error: 'Invalid token',
                message: 'Authentication failed'
            });
        }

        return res.status(500).json({
            error: 'Permission check failed',
            message: 'Could not verify club admin permissions'
        });
    }
};

/**
 * Middleware to check if user is admin of a specific club
 * Expects clubId in req.params or req.body
 */
const checkClubAdminForClub = async (req, res, next) => {
    try {
        const token = req.cookies.auth_token;

        if (!token) {
            return res.status(401).json({
                error: 'No authentication token found',
                message: 'Please login to continue'
            });
        }

        // Verify JWT token
        // Shared verifier: signature + MANDATORY revocation check. Previously this file called
        // jwt.verify directly and never consulted token_version, so a revoked session still worked
        // on every club-admin route.
        const decoded = await verifySession(token);
        const userId = decoded.user_id;

        const permissionCheck = await AdminPermissionAlloted.findOne({
            where: { user_id: userId, admin_permission_id: permissionId(PERM.MANAGE_CLUB_ADMINS) },
            attributes: ['user_id'],
            limit: 1
        });

        if (permissionCheck) {
            req.user = decoded;
            return next();
        }

        // Get club_id from params or body
        const clubId = req.params.clubId || req.body?.club_id;

        if (!clubId) {
            return res.status(400).json({
                error: 'Bad request',
                message: 'Club ID is required'
            });
        }

        const clubAdminRecord = await ClubAdmin.findOne({
            where: { user_id: userId, club_id: clubId },
            attributes: ['club_id']
        });

        if (!clubAdminRecord) {
            return res.status(403).json({
                error: 'Permission denied',
                message: 'You are not an admin of this club'
            });
        }

        // Attach user info and club admin info to request
        next();
    } catch (error) {
        console.error('Club admin check error:', error);

        // verifySession also throws SessionRevokedError (missing `tv`, or a bumped token_version).
        // Without this it fell through to a 500, so a logged-out club admin saw an opaque server
        // error instead of being redirected to login — the SPA only redirects on 401.
        if (error.name === 'SessionRevokedError') {
            return res.status(401).json({
                error: 'Session revoked',
                message: 'Your session is no longer valid. Please login again'
            });
        }

        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'Token expired',
                message: 'Your session has expired. Please login again'
            });
        }

        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                error: 'Invalid token',
                message: 'Authentication failed'
            });
        }

        return res.status(500).json({
            error: 'Permission check failed',
            message: 'Could not verify club admin permissions'
        });
    }
};

module.exports = { checkClubAdmin, checkClubAdminForClub };
