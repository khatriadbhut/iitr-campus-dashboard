/**
 * S3 poster storage — durable, decoupled from the (ephemeral) container, served via CloudFront.
 * OPT-IN: only used when POSTER_S3_BUCKET is set; otherwise the caller falls back to local disk (dev).
 * On the EC2, credentials come from the instance IAM role (no keys in env). Returns the public URL
 * (via the CloudFront domain in POSTER_PUBLIC_BASE) so <img src> works, or null on disabled/failure.
 *   Env: POSTER_S3_BUCKET, AWS_REGION, POSTER_PUBLIC_BASE (CloudFront domain fronting the bucket)
 */
const logger = require('./logger');

const BUCKET = process.env.POSTER_S3_BUCKET;
const REGION = process.env.AWS_REGION || 'ap-south-1';
const PUBLIC_BASE = (process.env.POSTER_PUBLIC_BASE || '').replace(/\/$/, '');

let client = null;
function isConfigured() { return !!BUCKET; }

function getClient() {
    if (!client) {
        const { S3Client } = require('@aws-sdk/client-s3');
        client = new S3Client({ region: REGION });   // creds from the EC2 instance role
    }
    return client;
}

// Never persist a caller-supplied Content-Type verbatim: posters are served from the SAME ORIGIN as the
// app, so an attacker-declared image/svg+xml (or text/html) becomes a script-bearing document running
// with the auth cookie. Pin to a known-safe raster type and force `inline` so the header can't be
// widened later by accident. The ingestion side allowlists too — this is the second line.
const SAFE_POSTER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

async function uploadPoster(key, buffer, contentType) {
    if (!isConfigured()) return null;
    try {
        const declared = String(contentType || '').toLowerCase().split(';')[0].trim();
        const safeType = SAFE_POSTER_TYPES.has(declared === 'image/jpg' ? 'image/jpeg' : declared)
            ? (declared === 'image/jpg' ? 'image/jpeg' : declared) : 'image/jpeg';
        const { PutObjectCommand } = require('@aws-sdk/client-s3');
        await getClient().send(new PutObjectCommand({
            Bucket: BUCKET, Key: key, Body: buffer,
            ContentType: safeType,
            ContentDisposition: 'inline',
            CacheControl: 'public, max-age=31536000, immutable',
        }));
        return PUBLIC_BASE ? `${PUBLIC_BASE}/${key}` : `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
    } catch (e) {
        logger.error({ err: e }, 'poster S3 upload failed');
        return null;   // caller keeps going without a poster; best-effort
    }
}

module.exports = { isConfigured, uploadPoster };
