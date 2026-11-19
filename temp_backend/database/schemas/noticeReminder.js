const { DataTypes } = require('sequelize');
const sequelize = require('../connection');

/**
 * A reminder on a NOTICE, mirroring `reminder` (which is events-only).
 *
 * Why a second table rather than a nullable event_id on `reminder`: that table's primary key is
 * (event_id, user_id, offset_minutes) and Postgres does not permit NULL in a primary-key column. So
 * supporting notices there means replacing the PK on a table that already holds live production
 * rows — a heavier migration than this earns, days before launch. This is purely additive and
 * touches nothing that exists.
 *
 * Until now a notice bell wrote ONLY to localStorage, under a `notice-<id>` key, because
 * eventReminders POSTs any purely-numeric id to the events API and would otherwise have written a
 * reminder against the EVENT of that number — a different item entirely. The consequence was a bell
 * that looked identical to the event one and quietly did less: gone when storage cleared, invisible
 * on another device, and unreachable by the notification generator. This table is what makes it real.
 *
 * A notice is remindable only when it has a `deadline` or an `event_date` (see NoticeActions.jsx);
 * one with neither is added to the todo list instead, where the user picks their own time.
 */
const NoticeReminder = sequelize.define('NoticeReminder', {
    notice_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        primaryKey: true,
        references: { model: 'notice', key: 'id' },
        onDelete: 'CASCADE',
    },
    user_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        primaryKey: true,
        references: { model: 'user', key: 'user_id' },
        onDelete: 'CASCADE',
    },
    // Minutes before the notice's moment. Defaults to 30 rather than 5: five minutes before a
    // deadline is too late to do anything about it.
    offset_minutes: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 30,
        primaryKey: true,
    },
    // Resolved at write time from the notice's deadline/event_date + time, exactly as `reminder`
    // stores an absolute instant rather than recomputing from the parent row. If the notice's date
    // later changes, the reminder is rewritten by the same path that wrote it.
    reminder_time: {
        type: DataTypes.DATE,
        allowNull: false,
    },
}, {
    tableName: 'notice_reminder',
    timestamps: false,
});

module.exports = NoticeReminder;
