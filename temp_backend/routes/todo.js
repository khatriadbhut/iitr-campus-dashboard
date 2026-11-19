const express = require('express');
const router = express.Router();
const { UserTodo } = require('../database/schemas/index');
const { userData } = require('../middlewares/userAuth');
const { Joi, validateBody, validateParams, id, isoDate, hhmm } = require('../middlewares/validate');

// Every field the handlers actually read — stripUnknown drops anything else rather than letting it
// reach a model write. Optional wherever the handler already treats it as optional.
const todoFields = {
    text: Joi.string().trim().max(500),
    notes: Joi.string().trim().max(2000).allow(null, ''),
    due_date: isoDate,
    due_time: hhmm,
    linked_event_id: id.allow(null),
    linked_event_name: Joi.string().trim().max(300).allow(null, ''),
    linked_event_club: Joi.string().trim().max(200).allow(null, ''),
    linked_event_date: Joi.string().max(40).allow(null, ''),
};
const createTodoBody = Joi.object({ ...todoFields, text: todoFields.text.required() });
const updateTodoBody = Joi.object({ ...todoFields, completed: Joi.boolean() });
const todoIdParam = Joi.object({ id: id.required() });


// GET /todos — fetch all todos for the authenticated user
router.get('/', userData, async (req, res) => {
    try {
        const userId = req.user.user_id;
        const todos = await UserTodo.findAll({
            where: { user_id: userId },
            order: [['created_at', 'DESC']],
            raw: true,
        });
        res.json({ todos });
    } catch (error) {
        console.error('Error fetching todos:', error);
        res.status(500).json({ error: 'Internal server error', message: 'Could not fetch todos' });
    }
});

// POST /todos — create a new todo
router.post('/', userData, validateBody(createTodoBody), async (req, res) => {
    try {
        const userId = req.user.user_id;
        const { text, notes, due_date, due_time, linked_event_id, linked_event_name, linked_event_club, linked_event_date } = req.body;

        if (!text || !String(text).trim()) {
            return res.status(400).json({ error: 'Bad request', message: 'Todo text is required' });
        }

        // IDEMPOTENT for the "Add to Todo" button on an event card. That button called this endpoint
        // with no guard of any kind, so every press created another identical row — press it five
        // times and the Assistant list held five copies of the same task, with five separate
        // reminders to dismiss.
        //
        // Deduped HERE rather than only in the UI because the client is the wrong place to enforce
        // it: a double-tap fires two requests before either returns, and the same event added from a
        // phone and a laptop would still duplicate. The server is the only point that sees both.
        //
        // The key is (user, text, due_date) and NOT linked_event_id, which is null for academic
        // calendar rows and notice deadlines — precisely the cards this was first noticed on. `text`
        // is derived deterministically from the event name ("Attend <name>" / "Apply for <name>"), so
        // it is stable for a given card while still letting a user keep two genuinely different tasks
        // that happen to fall on the same day.
        //
        // Returns 200 with the EXISTING row rather than 409: the user asked for this task to be on
        // their list, and it is. Nothing was created, so the status distinguishes it from the 201.
        const duplicate = await UserTodo.findOne({
            where: {
                user_id: userId,
                text: String(text).trim(),
                due_date: due_date || null,
                completed: false,
            },
        });
        if (duplicate) {
            return res.status(200).json({ todo: duplicate.toJSON(), alreadyExists: true });
        }

        const todo = await UserTodo.create({
            user_id: userId,
            text: String(text).trim(),
            notes: notes || null,
            due_date: due_date || null,
            due_time: due_time || null,
            linked_event_id: linked_event_id || null,
            linked_event_name: linked_event_name || null,
            linked_event_club: linked_event_club || null,
            linked_event_date: linked_event_date || null,
            completed: false,
        });

        res.status(201).json({ todo: todo.toJSON() });
    } catch (error) {
        console.error('Error creating todo:', error);
        res.status(500).json({ error: 'Internal server error', message: 'Could not create todo' });
    }
});

// PATCH /todos/:id — update any todo field
router.patch('/:id', userData, validateParams(todoIdParam), validateBody(updateTodoBody), async (req, res) => {
    try {
        const userId = req.user.user_id;
        const todoId = req.params.id;
        const { completed, text, notes, due_date, due_time } = req.body;

        const todo = await UserTodo.findOne({ where: { id: todoId, user_id: userId } });
        if (!todo) {
            return res.status(404).json({ error: 'Not found', message: 'Todo not found' });
        }

        const updateData = {};
        if (completed !== undefined) updateData.completed = completed;
        if (text !== undefined && String(text).trim()) updateData.text = String(text).trim();
        if (notes !== undefined) updateData.notes = notes;
        if (due_date !== undefined) updateData.due_date = due_date;
        if (due_time !== undefined) updateData.due_time = due_time;

        await todo.update(updateData);
        res.json({ todo: todo.toJSON() });
    } catch (error) {
        console.error('Error updating todo:', error);
        res.status(500).json({ error: 'Internal server error', message: 'Could not update todo' });
    }
});

// DELETE /todos/:id — delete a specific todo
router.delete('/:id', userData, async (req, res) => {
    try {
        const userId = req.user.user_id;
        const todoId = req.params.id;

        const deleted = await UserTodo.destroy({ where: { id: todoId, user_id: userId } });
        if (!deleted) {
            return res.status(404).json({ error: 'Not found', message: 'Todo not found' });
        }

        res.json({ success: true, message: 'Todo deleted' });
    } catch (error) {
        console.error('Error deleting todo:', error);
        res.status(500).json({ error: 'Internal server error', message: 'Could not delete todo' });
    }
});

module.exports = router;
