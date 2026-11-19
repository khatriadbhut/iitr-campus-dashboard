import api from './api';

/**
 * Upload an image and get back a URL to store on the event/club row.
 *
 * Was: the browser POSTed straight to ImgBB carrying VITE_IMGBB_API_KEY — which meant a real API key
 * sat in the public JS bundle for anyone to read, and because only the returned URL was kept (never
 * ImgBB's delete handle) nothing uploaded there could ever be taken down. Now the file goes to our
 * own backend, which authorises the caller, strips EXIF, resizes, and stores it in our S3 bucket.
 *
 * No key is involved on the client at all — the session cookie is the authorisation.
 */
const postImage = async (path, file) => {
    if (!file) throw new Error('No file provided');

    const formData = new FormData();
    formData.append('image', file);

    // Let the browser set Content-Type itself so it can append the multipart boundary; axios' JSON
    // default would produce a body the server cannot parse.
    const res = await api.post(path, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
    });

    if (!res?.data?.url) throw new Error('Upload succeeded but no URL was returned');
    return res.data.url;
};

/** Event posters — re-encoded and resized to 1600px wide server-side. */
export const uploadImageToCDN = (file) => postImage('/upload/poster', file);

/** Club logos — resized to 512px wide, tighter size cap. */
export const uploadLogo = (file) => postImage('/upload/logo', file);

export default {
    uploadImageToCDN,
    uploadLogo,
};
