/**
 * Image upload — posters and club logos.
 *
 * Replaces the old browser→ImgBB path, which (a) shipped a real API key inside the public JS bundle,
 * (b) never captured ImgBB's delete handle, so nothing uploaded there could ever be taken down, and
 * (c) put content we're responsible for on a free third-party host with no retention guarantee, while
 * the URL lives in Postgres for years. Everything now lands in our own bucket via utils/s3.
 *
 * The browser holds no credentials: it POSTs the file here, we authorise, sanitise, and store.
 *
 * ONE sharp() call does three jobs, which is why it earns its place:
 *   1. resize  — a 4 MB phone photo of a printed poster becomes ~150 KB. Students are on mid-range
 *                Android over congested campus wifi; this is the difference between a feed that
 *                loads and one that doesn't.
 *   2. validate — sharp throws on anything that isn't a real image, so this IS the magic-byte check.
 *                Never trust the client's Content-Type or filename.
 *   3. sanitise — re-encoding drops EXIF (phone photos of posters carry GPS) and destroys polyglot
 *                files that are simultaneously a valid image and a valid script.
 */
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs/promises');
const sharp = require('sharp');

const router = express.Router();
const { userData } = require('../middlewares/userAuth');
const { AdminPermissionAlloted, ClubAdmin } = require('../database/schemas');
const { PERM, permissionIds } = require('../utils/permissions');
const s3 = require('../utils/s3');
const logger = require('../utils/logger');

// Any of these may attach an image. Names, not ids — see utils/permissions.
const UPLOAD_PERMISSIONS = [PERM.EVENT_CRUD, PERM.MANAGE_CLUBS, PERM.MANAGE_CLUB_ADMINS, PERM.MANAGE_ADMINS];

// Uploading is a side-effect of creating/editing an event or club, so anyone who can do either may
// upload. Deliberately NOT tied to a specific event/club id: the image is chosen before the row it
// will belong to exists. The narrower object-level check still happens on the write itself.
const canUploadMedia = (req, res, next) => {
    userData(req, res, async () => {
        try {
            const userId = req.user.user_id;
            // Two steps rather than a join: User<->AdminPermission is a belongsToMany *through* this
            // table, so there's no direct association to `include` from here, and adding one just to
            // satisfy this query risks side effects on other callers.
            const held = await AdminPermissionAlloted.findOne({
                where: { user_id: userId, admin_permission_id: permissionIds(UPLOAD_PERMISSIONS) },
                attributes: ['user_id'],
            });
            if (held) return next();

            // Club admins may upload for their own club's events.
            const isClubAdmin = await ClubAdmin.findOne({ where: { user_id: userId }, attributes: ['user_id'] });
            if (isClubAdmin) return next();

            return res.status(403).json({ error: 'Forbidden', message: 'You do not have permission to upload images.' });
        } catch (err) {
            logger.error({ err }, 'upload permission check failed');
            return res.status(500).json({ error: 'Permission check failed' });
        }
    });
};

// memoryStorage: the buffer goes straight to sharp and is never written to the container's disk
// (which is ephemeral, and writing user files there is how you fill a t3.micro's root volume).
const makeUploader = (maxBytes) => multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1 },
    // Cheap first gate only. The real check is sharp throwing below — a filename and a declared
    // mimetype are both fully client-controlled.
    fileFilter: (req, file, cb) => {
        if (/^image\//i.test(file.mimetype)) return cb(null, true);
        cb(Object.assign(new Error('Only image files are accepted.'), { code: 'NOT_IMAGE' }));
    },
});

// Turn multer's errors into clean JSON rather than a generic 500.
const wrapUpload = (uploader, maxBytes) => (req, res, next) => {
    uploader.single('image')(req, res, (err) => {
        if (!err) return next();
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                error: 'File too large',
                message: `The image must be under ${Math.round(maxBytes / (1024 * 1024))} MB.`,
            });
        }
        if (err.code === 'NOT_IMAGE') return res.status(400).json({ error: 'Not an image', message: err.message });
        logger.error({ err }, 'multer upload error');
        return res.status(400).json({ error: 'Upload failed', message: 'Could not read the uploaded file.' });
    });
};

/**
 * Sanitise + store. Returns the public URL.
 * Falls back to local disk when POSTER_S3_BUCKET is unset (dev), mirroring the ingestion path.
 */
async function processAndStore(buffer, { prefix, maxWidth }) {
    // ── Decompression-bomb guard ─────────────────────────────────────────────
    // Byte size does NOT bound decode cost, and neither does sharp's default ~268MP limitInputPixels.
    // libvips decodes in strips, so peak memory tracks IMAGE WIDTH, not pixel count — which makes the
    // cheap attack a long thin image, not a big square one. Measured on this pipeline:
    //
    //     16000x12500 (200MP) JPEG, 1.1MB   ->   94MB peak   (legitimate 200MP phone shot)
    //     16000x16000 (256MP) PNG,  758KB   ->  227MB peak
    //     200000x1340 (268MP) PNG,  768KB   ->  576MB peak   <- passes limitInputPixels, kills the box
    //
    // That last one is a 768KB upload. The EC2 has ~315MB free and no swap, so it OOMs the HOST.
    //
    // Capping a DIMENSION rather than the pixel count is what lets the real photo through: the 200MP
    // shot the previous limitInputPixels attempt wrongly rejected is only 16000px on its long edge and
    // costs 94MB, while the bomb needs an edge an order of magnitude longer. The worst image still
    // admitted here (20000 x 13400, 268MP) peaks at 219MB, inside the container's 512m ceiling.
    //
    // metadata() reads the header only — it does NOT decode — so this probe is safe on a bomb (67MB)
    // and must therefore run BEFORE any pixels are touched. limitInputPixels:false applies to the
    // probe alone so we can report real dimensions instead of throwing sharp's generic error.
    const meta = await sharp(buffer, { limitInputPixels: false }).metadata();
    if (!meta.width || !meta.height) {
        throw Object.assign(new Error('Could not read image dimensions.'), { code: 'BAD_IMAGE' });
    }
    if (meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION) {
        throw Object.assign(
            new Error(`Image is ${meta.width}x${meta.height}px; the limit is ${MAX_DIMENSION}px on a side.`),
            { code: 'IMAGE_TOO_LARGE' },
        );
    }

    // .rotate() with no argument applies the EXIF orientation BEFORE we strip it, so phone photos
    // don't come out sideways. withoutEnlargement avoids upscaling a small image into a big file.
    //
    // limitInputPixels stays at sharp's ~268MP default here: the dimension check above is the real
    // guard, and the default is a useful backstop for a 20000x20000-style input that clears it.
    const encode = (quality) => sharp(buffer)
        .rotate()
        .resize({ width: maxWidth, withoutEnlargement: true })
        .webp({ quality })
        .toBuffer();

    let webp = await encode(82);

    // The whole point of this step is to make images SMALLER. Normally it does, by a lot — a phone
    // photo of a poster drops ~92%, a Canva export ~75%. But an image that is already small, already
    // heavily compressed, and below maxWidth (so no downscale happens) can come out bigger, because
    // we'd be spending more bits on it than the source did. Re-encoding is not optional (it strips
    // EXIF and kills polyglots), so we can't just keep the original bytes — instead try once more at
    // a lower quality and keep whichever is smallest.
    if (webp.length > buffer.length) {
        const leaner = await encode(65);
        if (leaner.length < webp.length) webp = leaner;
    }

    // Server-generated key: never the client's filename (path traversal, collisions, and it's what
    // makes the immutable cache header honest).
    //
    // NOTE the shared `posters/` prefix. CloudFront has exactly one behaviour pointing at this
    // bucket — `/posters/*` — so a `logos/` key would return 403, and because CloudFront rewrites
    // errors to index.html an <img> would receive HTML with a 200 status: a silent, invisible break
    // with a dead URL persisted to Postgres. Distinguish by filename, not by a new prefix, unless a
    // matching CloudFront behaviour is added first.
    const key = `posters/${prefix}-${crypto.randomUUID()}.webp`;

    const url = await s3.uploadPoster(key, webp, 'image/webp');
    if (url) return url;

    if (s3.isConfigured()) throw new Error('S3 upload failed');   // configured but broken → real error

    // POSTER_S3_BUCKET is a manual deploy step, so "unconfigured" is a plausible production mistake.
    // Falling back to disk there would return HTTP 200 with a URL pointing at an ephemeral container
    // layer the next deploy destroys — and that dead URL gets written to the database permanently.
    // Fail loudly instead; a 500 is recoverable, silent data corruption is not.
    if (process.env.NODE_ENV === 'production') {
        throw new Error('POSTER_S3_BUCKET is not configured — refusing to write uploads to local disk');
    }

    // Dev fallback: local disk, served by the /uploads static mount in app.js.
    const dir = path.join(__dirname, '..', 'uploads', prefix);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, path.basename(key)), webp);
    const base = (process.env.INGEST_PUBLIC_BASE || '').replace(/\/$/, '');
    return `${base}/uploads/${prefix}/${path.basename(key)}`;
}

// Sized for reality, not for a round number: a phone photo of a printed poster is 8-15MB, and a
// 200MP shot is 15-25MB. The old 6MB cap would have rejected ordinary uploads. Byte size is cheap —
// what actually costs memory is pixel count, which limitInputPixels handles separately.
const POSTER_MAX_BYTES = 20 * 1024 * 1024;
const LOGO_MAX_BYTES = 5 * 1024 * 1024;

// Longest edge we will decode. A 200MP phone camera tops out at ~16000px, and a scanned A0 poster at
// 600dpi is ~14000px, so this clears anything real with room to spare. See processAndStore().
const MAX_DIMENSION = 20000;

router.post('/poster', canUploadMedia, wrapUpload(makeUploader(POSTER_MAX_BYTES), POSTER_MAX_BYTES), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file', message: 'Attach an image as the "image" field.' });
    try {
        const url = await processAndStore(req.file.buffer, { prefix: 'posters', maxWidth: 1600 });
        logger.info({ userId: req.user?.user_id, url, bytes: req.file.size }, 'poster uploaded');
        return res.json({ url });
    } catch (err) {
        // A pixel-dimension rejection is a DIFFERENT thing from an unreadable file, and telling the
        // admin which one happened is the difference between "resize it" and "pick another file".
        if (err.code === 'IMAGE_TOO_LARGE') {
            return res.status(400).json({ error: 'Image too large', message: err.message });
        }
        // sharp throws on anything that isn't a decodable image — that's the real file-type check.
        logger.error({ err, userId: req.user?.user_id }, 'poster upload failed');
        return res.status(400).json({ error: 'Invalid image', message: 'That file could not be read as an image.' });
    }
});

router.post('/logo', canUploadMedia, wrapUpload(makeUploader(LOGO_MAX_BYTES), LOGO_MAX_BYTES), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file', message: 'Attach an image as the "image" field.' });
    try {
        const url = await processAndStore(req.file.buffer, { prefix: 'logos', maxWidth: 512 });
        logger.info({ userId: req.user?.user_id, url, bytes: req.file.size }, 'logo uploaded');
        return res.json({ url });
    } catch (err) {
        // A pixel-dimension rejection is a DIFFERENT thing from an unreadable file, and telling the
        // admin which one happened is the difference between "resize it" and "pick another file".
        if (err.code === 'IMAGE_TOO_LARGE') {
            return res.status(400).json({ error: 'Image too large', message: err.message });
        }
        // sharp throws on anything that isn't a decodable image — that's the real file-type check.
        logger.error({ err, userId: req.user?.user_id }, 'logo upload failed');
        return res.status(400).json({ error: 'Invalid image', message: 'That file could not be read as an image.' });
    }
});

module.exports = router;
