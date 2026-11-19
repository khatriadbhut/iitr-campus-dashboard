const { DataTypes } = require('sequelize');
const sequelize = require('../connection');

const Club = sequelize.define('Club', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    name: {
        type: DataTypes.TEXT,
        allowNull: false,
        unique: true,
    },
    email: {
        // Optional: a club that only broadcasts through a gensec relay has no address of its own.
        // Never invent one — it is rendered to students as a mailto: link.
        type: DataTypes.TEXT,
        allowNull: true,
        unique: true,
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    logo_url: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    // fests (Cognizance/Srishti/Thomso/Sangram) are club rows shown in a "Fests" group.
    is_fest: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
    },
}, {
    tableName: 'club',
    timestamps: false,
});

module.exports = Club;

// const createClubTable = async (sql) => {
//     await sql`
//         CREATE TABLE IF NOT EXISTS club (
//             id SERIAL PRIMARY KEY,
//             name TEXT NOT NULL UNIQUE,
//             email TEXT NOT NULL UNIQUE,
//             description TEXT,
//             logo_url TEXT
//         );
//     `;
// };
// module.exports = createClubTable;