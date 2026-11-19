import api from './api';

// Admin-side email-ingestion review: the proposal queue + publish/dismiss + health.
const ingestionService = {
    /** Proposals awaiting review (state='proposed'). */
    getProposals: async () => (await api.get('/ingestion/proposals')).data,

    /** Publish a proposal. body = { payload, mode?, targetId? } (mode/targetId for calendar amend). */
    publishProposal: async (id, body) => (await api.post(`/ingestion/proposals/${id}/publish`, body || {})).data,

    /** Existing academic-calendar entries a calendar proposal might be amending. */
    getCalendarCandidates: async (id) => (await api.get(`/ingestion/proposals/${id}/calendar-candidates`)).data,

    /** Live events a PATCH/CANCEL (lifecycle) proposal might be updating. */
    getEventCandidates: async (id) => (await api.get(`/ingestion/proposals/${id}/event-candidates`)).data,

    /** Live notices a PATCH_NOTICE (deadline extension) proposal might be moving the apply-by on. */
    getNoticeCandidates: async (id) => (await api.get(`/ingestion/proposals/${id}/notice-candidates`)).data,

    /** Dismiss a proposal (won't be published). */
    dismissProposal: async (id) => (await api.post(`/ingestion/proposals/${id}/dismiss`)).data,

    /** Every published notice (the Notices feed) — also backs the Manage Notices admin tab. */
    getNotices: async () => (await api.get('/ingestion/notices')).data,

    /** Publish a notice written by hand, with no source email. title required. */
    createNotice: async (body) => (await api.post('/ingestion/notices', body)).data,

    /** Correct a live notice. body = any subset of the editable Notice columns. */
    updateNotice: async (id, body) => (await api.patch(`/ingestion/notices/${id}`, body)).data,

    /** Remove a live notice. Does NOT re-queue the source email. */
    deleteNotice: async (id) => (await api.delete(`/ingestion/notices/${id}`)).data,

    /** Ingestion health: gmail configured?, authOk, last sync. */
    getStatus: async () => (await api.get('/ingestion/status')).data,

    /** Force an immediate Gmail pull → pipeline → proposals (near-live; polling also runs on its own). */
    runNow: async () => (await api.post('/ingestion/run')).data,

    /** Classification override rules (super-admin scoped: sender[+pattern] → type). */
    getOverrides: async () => (await api.get('/ingestion/overrides')).data,
    previewOverride: async (sender, pattern) => (await api.get('/ingestion/overrides/preview', { params: { sender, pattern } })).data,
    createOverride: async (body) => (await api.post('/ingestion/overrides', body)).data,
    deleteOverride: async (id) => (await api.delete(`/ingestion/overrides/${id}`)).data,
};

export default ingestionService;
