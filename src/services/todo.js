import api from './api';

const todoService = {
    getAll: async () => {
        const response = await api.get('/todos');
        return response.data?.todos || [];
    },

    create: async (data) => {
        const response = await api.post('/todos', data);
        // The endpoint is idempotent: an identical unfinished task returns the EXISTING row with
        // `alreadyExists: true` and a 200 instead of a 201. Carried alongside the todo's own fields
        // (rather than replacing the return shape) so existing callers that treat this as the created
        // todo keep working, while the card can tell "added" from "was already there".
        return { ...(response.data?.todo || {}), alreadyExists: response.data?.alreadyExists === true };
    },

    update: async (id, data) => {
        const response = await api.patch(`/todos/${id}`, data);
        return response.data?.todo;
    },

    delete: async (id) => {
        await api.delete(`/todos/${id}`);
    },
};

export default todoService;
