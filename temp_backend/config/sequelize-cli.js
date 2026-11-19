// sequelize-cli database config — reads DATABASE_URL from env (same source the app uses), SSL in prod
// (RDS). One config; the environment is chosen by NODE_ENV but all point at DATABASE_URL.
require('dotenv').config();

const common = {
    url: process.env.DATABASE_URL,
    dialect: 'postgres',
    dialectOptions: {
        ssl: process.env.NODE_ENV === 'production'
            ? { require: true, rejectUnauthorized: false }
            : false,
    },
};

module.exports = { development: common, test: common, production: common };
