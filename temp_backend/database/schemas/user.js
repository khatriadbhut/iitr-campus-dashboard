const { DataTypes } = require('sequelize');
const sequelize = require('../connection');

const User = sequelize.define('User', {
    user_id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        allowNull: false,
    },
    full_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
    },
    email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
    },
    phone_number: {
        type: DataTypes.STRING(20),
        allowNull: true,
    },
    display_picture: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    enrolment_number: {
        type: DataTypes.STRING(255),
        allowNull: true,
        unique: true,
    },
    branch: {
        type: DataTypes.STRING(255),
        allowNull: true,
    },
    current_year: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    branch_department_name: {
        type: DataTypes.STRING(255),
        allowNull: true,
    },
    /**
     * Last authenticated request from this user, for the "active now" figure in admin analytics.
     *
     * Throttled to one write per minute per user (see middlewares/presence.js) — updating a row on
     * every request would turn a read-heavy app into a write-heavy one for a number nobody needs to
     * the second.
     */
    last_seen_at: { type: DataTypes.DATE, allowNull: true },

    // Bumped on logout (or manually) to invalidate every token this account has been issued. Stamped
    // into the JWT as `tv` and compared on each request — without it, logout only clears the cookie in
    // one browser and a leaked token stays valid until it expires.
    token_version: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
    },
    // Super admin. NOT an admin_permission row — see initializeSchema for why that distinction is the
    // whole point. Only PATCH /admins/:userId can change it, and only for a caller who already is one.
    // It is read from the DATABASE on every gated request, never trusted from the JWT, so revoking
    // someone takes effect on their very next call rather than when their token happens to expire.
    is_super_admin: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
    },
    updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
    },
}, {
    tableName: 'user',
    timestamps: false,
    indexes: [
        { fields: ['email'], name: 'idx_user_email' },
        { fields: ['enrolment_number'], name: 'idx_user_enrolment_number' },
    ],
});

module.exports = User;

// const createUsersTable = async (sql) => {
//     await sql`
//         CREATE TABLE IF NOT EXISTS "user" (
//             user_id BIGINT PRIMARY KEY,
//             full_name VARCHAR(255) NOT NULL,
//             email VARCHAR(255) UNIQUE NOT NULL,
//             phone_number VARCHAR(20),
//             display_picture TEXT,
//             enrolment_number VARCHAR(255) UNIQUE,
//             branch VARCHAR(255),
//             current_year INTEGER,
//             branch_department_name VARCHAR(255),
//             created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//             updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
//         );
//     `;

//     await sql`CREATE INDEX IF NOT EXISTS idx_user_email ON "user"(email);`;
//     await sql`CREATE INDEX IF NOT EXISTS idx_user_enrolment_number ON "user"(enrolment_number);`;
// };

// module.exports = createUsersTable;
