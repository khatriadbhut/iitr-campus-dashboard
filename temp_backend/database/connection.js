require('dotenv').config();
const { Sequelize } = require('sequelize');
// const postgres = require('postgres');

// module.exports = postgres(`${process.env.DATABASE_URL}`);
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: {
    ssl: process.env.NODE_ENV === 'production'
      ? { require: true, rejectUnauthorized: false }
      : false,
    // Never let a single query hang forever and cascade into pool exhaustion → whole-app freeze.
    // Generous defaults (tune DOWN with data from the Docker stress test); catches a runaway / missing-
    // index query and an idle-in-transaction session holding locks. Env-tunable, no code change needed.
    statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 30000),
    idle_in_transaction_session_timeout: Number(process.env.DB_IDLE_TXN_TIMEOUT_MS || 30000),
  },
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  pool: {
    max: Number(process.env.DB_POOL_MAX || 10),
    min: 0,
    acquire: 15000,   // fail fast when the pool is exhausted, instead of hanging up to 30-60s
    idle: 10000,
  },
});

(async () => {
  try {
    await sequelize.authenticate();
    console.log('PostgreSQL connected via Sequelize.');
  } catch (err) {
    console.error('Database connection failed:', err);
    process.exit(1);
  }
})();

module.exports = sequelize;