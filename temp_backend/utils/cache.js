const NodeCache = require('node-cache');

// Standard cache configuration:
// - stdTTL: standard time to live in seconds (default 10 minutes)
// - checkperiod: interval for cache eviction checks
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

/**
 * Cache instance to be used across the app.
 * Use cache.get(key) to retrieve
 * Use cache.set(key, value, [ttl]) to store
 * Use cache.del(key) to invalidate
 */

module.exports = cache;
