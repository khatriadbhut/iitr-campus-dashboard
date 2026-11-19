#!/usr/bin/env node
/**
 * Mint the Play Store tester credential.
 *
 *   node scripts/generate-guest-credential.js
 *
 * Prints a passphrase ONCE and the scrypt hash to store. The passphrase is never written to disk and
 * cannot be recovered from the hash — if you lose it, run this again and re-deploy the new hash.
 *
 * Put the hash in GUEST_LOGIN_PASSWORD_HASH (SSM / .env), give the passphrase to the Play Console
 * reviewer note and to your closed testers. Rotating is one variable: generate, replace, restart —
 * every previously issued passphrase dies at that moment.
 */

const crypto = require('crypto');
const { hashPassword, normalizeSecret } = require('../utils/guestCredential');

// Crockford base32: no I, L, O or U. Nothing in it can be confused with 1, 0 or a swear word, which
// matters because a human retypes this from a Play Console note on a phone keyboard.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const GROUPS = 5;
const GROUP_LEN = 5;   // 25 chars x 5 bits = 125 bits of entropy

/**
 * Rejection sampling, not `% 32`. The modulo shortcut is the classic bias bug: 256 is not a multiple
 * of 32 here in general, and a skewed alphabet quietly costs entropy. 256 % 32 === 0 so it would in
 * fact be uniform today, but the property is silent and breaks the moment the alphabet changes length.
 */
const randomChar = () => {
    const limit = 256 - (256 % ALPHABET.length);
    for (;;) {
        const byte = crypto.randomBytes(1)[0];
        if (byte < limit) return ALPHABET[byte % ALPHABET.length];
    }
};

const generatePassphrase = () => Array.from({ length: GROUPS }, () => Array.from({ length: GROUP_LEN }, randomChar).join(''))
    .join('-');

(async () => {
    const username = process.argv[2] || 'playstore-tester';
    const passphrase = generatePassphrase();
    const hash = await hashPassword(passphrase);

    const bits = Math.round(Math.log2(ALPHABET.length) * GROUPS * GROUP_LEN);

    console.log('');
    console.log('  Play Store guest credential');
    console.log('  ' + '-'.repeat(60));
    console.log('');
    console.log('  Username     ', username);
    console.log('  Passphrase   ', passphrase);
    console.log(`  Entropy       ${bits} bits (dashes and case are optional when signing in)`);
    console.log('');
    console.log('  Set on the server (SSM parameter or .env), then restart:');
    console.log('');
    console.log('    GUEST_LOGIN_ENABLED=true');
    console.log(`    GUEST_LOGIN_USERNAME=${username}`);
    console.log(`    GUEST_LOGIN_PASSWORD_HASH=${hash}`);
    console.log('');
    console.log('  The passphrase is shown here ONCE and is not stored anywhere. Copy it now.');
    console.log('');

    // Fail loudly rather than hand over a credential that will not work.
    const { verifyPassword } = require('../utils/guestCredential');
    if (!(await verifyPassword(passphrase, hash))) {
        console.error('  FATAL: the generated hash does not verify against its own passphrase.');
        process.exit(1);
    }
    // A '$' here is not cosmetic: this value goes into temp_backend/.env, docker-compose loads that
    // with `env_file`, and Compose interpolates `$name` inside the value. That silently truncated the
    // hash on the first production deploy — correct on disk, corrupt in the container, and the only
    // symptom was the right passphrase being rejected. Refuse to print one rather than let it happen
    // again. (See the delimiter note in utils/guestCredential.js.)
    if (hash.includes('$')) {
        console.error('  FATAL: the generated hash contains "$", which docker-compose will mangle.');
        process.exit(1);
    }
    if (normalizeSecret(passphrase).length !== GROUPS * GROUP_LEN) {
        console.error('  FATAL: passphrase is the wrong length.');
        process.exit(1);
    }
})();
