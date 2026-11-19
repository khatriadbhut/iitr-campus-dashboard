import api from './api';

const noticesService = {
    /** Published notices for the Notices tab (important first, then nearest deadline). */
    getNotices: async () => {
        const response = await api.get('/ingestion/notices');
        return response.data;
    },

    /** One notice by id (for the detail view). */
    getNotice: async (id) => {
        const response = await api.get(`/ingestion/notices/${id}`);
        return response.data;
    },
};

export default noticesService;
