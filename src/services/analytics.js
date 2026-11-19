import api from './api';

/**
 * Admin analytics. Every endpoint behind is super-admin only — a club admin gets 403, so the caller
 * should only render this for someone who can actually read it.
 */
const qs = (params) => {
    const p = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') p.set(k, v);
    });
    const s = p.toString();
    return s ? `?${s}` : '';
};

const analyticsService = {
    overview: async () => (await api.get('/analytics/overview')).data,

    /**
     * One page of the log stream, newest first.
     * `before` walks backwards through history; `since` fetches only what is new (live tail).
     */
    logs: async (params = {}) => (await api.get(`/analytics/logs${qs(params)}`)).data,

    counts: async (params = {}) => (await api.get(`/analytics/logs/counts${qs(params)}`)).data,

    content: async () => (await api.get('/analytics/content')).data,
};

export default analyticsService;
