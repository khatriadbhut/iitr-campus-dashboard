const { sequelize } = require('./schemas');
const applyConstraints = require('./initConstraints');


/**
 * Initialize database schema
 * Creates tables if they don't exist
 */
const dropAllTables = async () => {
    await sequelize.query(`
        DROP TABLE IF EXISTS
            admin_permission_alloted,
            admin_permission,
            user_not_preferred_club,
            user_preferred_club,
            user_not_preferred_category,
            user_preferred_category,
            reminder,
            event_update,
            event_category_alloted,
            event,
            event_category,
            location,
            club_admin,
            club,
            "user"
        CASCADE;
    `);
};

// ⚠️ FROZEN (2026-07): do NOT add new schema changes here. We've adopted sequelize-cli migrations
// (temp_backend/migrations/) — every new column/table/index is a migration file now. This boot-time
// initializer is kept ONLY as a belt-and-suspenders for the first AWS deploy and will be removed one
// release after prod boots clean (replaced by a plain sequelize.authenticate() connectivity check).
const initializeSchema = async () => {
    try {
        console.log('🔄 Checking and initializing database schema...');

        // GUARD: the drop-all-tables path is dev-only. In production it is HARD-DISABLED regardless of the
        // env var — so an accidental RESET_DB=true (copied .env, typo) can NEVER wipe the prod database.
        // Deliberate wipes go through pgAdmin/a confirm-script, not this flag. (Migrations replace this
        // pattern entirely once adopted.)
        if (process.env.RESET_DB === 'true') {
            if (process.env.NODE_ENV === 'production') {
                console.error('⛔ RESET_DB=true IGNORED in production — refusing to drop tables. Unset it in the deploy env.');
            } else {
                console.log('⚠️ RESET_DB=true detected. Dropping all tables...');
                await dropAllTables();
                console.log('✅ All tables dropped');
            }
        }



        const schemaSteps = [
            'Users',
            'Club',
            'Club admin',
            'Location',
            'Event category',
            'Event',
            'Event category alloted',
            'Event update',
            'Reminder',
            'User preferred category',
            'User not preferred category',
            'User preferred club',
            'User not preferred club',
            'Admin permission',
            'Admin permission alloted',
        ];

        // sequelize.sync() handles all models in dependency order via foreign key awareness.
        // alter: false = safe for existing DBs, never modifies existing columns.
        await sequelize.sync({ alter: false });

        // Ensure is_all_day column exists in event table (non-blocking)
        sequelize.query(`
            ALTER TABLE event ADD COLUMN IF NOT EXISTS is_all_day BOOLEAN DEFAULT FALSE;
        `).catch(err => console.error('Column existence check failed:', err.message));

        // Feature #2 (email ingestion): new columns on event + club. sync({alter:false})
        // never adds columns to existing tables, so add them idempotently here.
        sequelize.query(`
            ALTER TABLE event
            ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'manual',
            ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'scheduled',
            ADD COLUMN IF NOT EXISTS source_sender TEXT,
            ADD COLUMN IF NOT EXISTS source_message_id VARCHAR(255),
            ADD COLUMN IF NOT EXISTS registration_link TEXT,
            ADD COLUMN IF NOT EXISTS registration_deadline DATE,
            ADD COLUMN IF NOT EXISTS audience VARCHAR(24),
            ADD COLUMN IF NOT EXISTS venue_text TEXT,
            ADD COLUMN IF NOT EXISTS venue_mode VARCHAR(8);
        `).catch(err => console.error('Event ingestion columns check failed:', err.message));
        sequelize.query(`
            ALTER TABLE club ADD COLUMN IF NOT EXISTS is_fest BOOLEAN NOT NULL DEFAULT FALSE;
        `).catch(err => console.error('Club is_fest column check failed:', err.message));
        // SUPER ADMIN. Deliberately a column on `user` and NOT a row in admin_permission, because a
        // permission is grantable and that made "super admin" circular: whoever could grant
        // permissions could mint another super admin, so no gate could ever close the loop. As a
        // separate column it is settable through exactly ONE route (PATCH /admins/:userId, itself
        // super-admin-only) and by nothing else — no mass assignment, no OAuth upsert, no preferences
        // PATCH. Defaults FALSE so an existing row can never gain it by accident.
        sequelize.query(`
            ALTER TABLE "user" ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;
            -- Presence, for the "active now" figure in admin analytics. sync({alter:false}) never adds
            -- a column to an existing table, so without this line every authenticated request 500s the
            -- moment the model declares it (middlewares/presence.js writes on each verified session).
            ALTER TABLE "user" ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
            -- The audit log is now a queryable stream filtered by action (admin analytics), not just an
            -- append target. Without this, every filtered page is a full scan of a table that only
            -- ever grows.
            CREATE INDEX IF NOT EXISTS idx_privilege_audit_action ON privilege_audit(action);
            -- How loudly a security row should read. Null for ordinary activity.
            ALTER TABLE privilege_audit ADD COLUMN IF NOT EXISTS severity VARCHAR(16);
            -- The urgent view is the one opened under pressure; it should not scan the whole table.
            CREATE INDEX IF NOT EXISTS idx_privilege_audit_severity ON privilege_audit(severity)
                WHERE severity IS NOT NULL;
            -- Burst detection counts recent failures from one address on every failed login.
            CREATE INDEX IF NOT EXISTS idx_privilege_audit_ip_time ON privilege_audit(ip, created_at);
        `).catch(err => console.error('User is_super_admin column check failed:', err.message));
        // Not every club owns a broadcast mailbox. Sections that only ever go out through a gensec
        // relay (BlocSoc, ArIES, Esports, Comedy Section…) have no address of their own, and the
        // column being NOT NULL meant they could not be added at all without inventing one — which
        // would then be shown to students as a mailto: link that bounces. Postgres permits many NULLs
        // under a UNIQUE constraint, so uniqueness for the clubs that DO have an address is unaffected.
        sequelize.query(`
            ALTER TABLE club ALTER COLUMN email DROP NOT NULL;
        `).catch(err => console.error('Club email nullability check failed:', err.message));
        sequelize.query(`
            ALTER TABLE notice
            ADD COLUMN IF NOT EXISTS source VARCHAR(120),
            ADD COLUMN IF NOT EXISTS kind VARCHAR(24),
            ADD COLUMN IF NOT EXISTS is_opportunity BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS deadline_time VARCHAR(5),
            ADD COLUMN IF NOT EXISTS venue_mode VARCHAR(8),
            ADD COLUMN IF NOT EXISTS club_id BIGINT REFERENCES club(id) ON DELETE SET NULL;
        `).catch(err => console.error('Notice column check failed:', err.message));
        sequelize.query('ALTER TABLE ingested_email ADD COLUMN IF NOT EXISTS dedup_key VARCHAR(255)')
            .then(() => sequelize.query('CREATE INDEX IF NOT EXISTS idx_ingested_email_dedup ON ingested_email (dedup_key)'))
            .catch(err => console.error('IngestedEmail dedup_key check failed:', err.message));
        sequelize.query("ALTER TABLE academic_calendar_entry ADD COLUMN IF NOT EXISTS source VARCHAR(8) NOT NULL DEFAULT 'pdf'")
            .catch(err => console.error('AcademicCalendarEntry source check failed:', err.message));

        // PERFORMANCE INDEXES (from the Docker stress test: 20k events → the feed query was a full Seq Scan
        // on `event`, ~11.7ms; with these it's an Index Scan ~0.09ms, ~130x, and holds 7k+ q/s at 20 clients).
        // The feed filters/orders by tentative_start_time + club_id + status, and looks up hidden clubs by
        // user_id. event_category_alloted(event_id) is already covered by its composite PK's leading column.
        sequelize.query(`
            CREATE INDEX IF NOT EXISTS idx_event_start_time ON event (tentative_start_time);
            CREATE INDEX IF NOT EXISTS idx_event_club ON event (club_id);
            CREATE INDEX IF NOT EXISTS idx_event_status ON event (status);
            CREATE INDEX IF NOT EXISTS idx_unpref_club_user ON user_not_preferred_club (user_id);
            CREATE INDEX IF NOT EXISTS idx_pref_club_user ON user_preferred_club (user_id);
            CREATE INDEX IF NOT EXISTS idx_eca_category ON event_category_alloted (event_category_id);
        `).catch(err => console.error('Performance index check failed:', err.message));

        // Ensure user_todo has all the new columns for details and linked events
        sequelize.query(`
            ALTER TABLE user_todo 
            ADD COLUMN IF NOT EXISTS notes TEXT,
            ADD COLUMN IF NOT EXISTS due_date DATE,
            ADD COLUMN IF NOT EXISTS due_time VARCHAR(5),
            ADD COLUMN IF NOT EXISTS linked_event_id BIGINT,
            ADD COLUMN IF NOT EXISTS linked_event_name TEXT,
            ADD COLUMN IF NOT EXISTS linked_event_club TEXT,
            ADD COLUMN IF NOT EXISTS linked_event_date TEXT;
        `).catch(err => console.error('Todo Column existence check failed:', err.message));

        // Ensure reminder table supports multiple offsets per user/event pair.
        await sequelize.query(`
            ALTER TABLE reminder
            ADD COLUMN IF NOT EXISTS offset_minutes INTEGER;
        `);

        await sequelize.query(`
            UPDATE reminder
            SET offset_minutes = GREATEST(
                1,
                ROUND(EXTRACT(EPOCH FROM (event.tentative_start_time - reminder.reminder_time)) / 60.0)
            )::INTEGER
            FROM event
            WHERE reminder.event_id = event.id
              AND reminder.offset_minutes IS NULL;
        `);

        await sequelize.query(`
            UPDATE reminder
            SET offset_minutes = 30
            WHERE offset_minutes IS NULL;
        `);

        await sequelize.query(`
            ALTER TABLE reminder
            ALTER COLUMN offset_minutes SET NOT NULL,
            ALTER COLUMN offset_minutes SET DEFAULT 30;
        `);

        await sequelize.query(`
            DO $$
            DECLARE pk_cols text;
            BEGIN
                -- Current reminder PK columns (sorted), or NULL if no PK. Only REBUILD when it's missing or
                -- has the WRONG columns — dropping+re-adding a CORRECT pk on every boot takes an ACCESS
                -- EXCLUSIVE lock and leaves a brief PK-less window for no reason.
                SELECT string_agg(a.attname, ',' ORDER BY a.attname)
                INTO pk_cols
                FROM pg_constraint c
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
                WHERE c.conname = 'reminder_pkey' AND c.conrelid = 'reminder'::regclass AND c.contype = 'p';

                IF pk_cols IS DISTINCT FROM 'event_id,offset_minutes,user_id' THEN
                    IF pk_cols IS NOT NULL THEN
                        ALTER TABLE reminder DROP CONSTRAINT reminder_pkey;
                    END IF;
                    ALTER TABLE reminder ADD CONSTRAINT reminder_pkey PRIMARY KEY (event_id, user_id, offset_minutes);
                END IF;
            END
            $$;
        `);


        // Normalize legacy timestamp columns to timestamptz so event times are timezone-safe.
        await sequelize.query(`
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = 'no_overlapping_events_at_location'
                ) THEN
                    ALTER TABLE event DROP CONSTRAINT no_overlapping_events_at_location;
                END IF;

                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'event'
                      AND column_name = 'tentative_start_time'
                      AND data_type = 'timestamp without time zone'
                ) THEN
                    ALTER TABLE event
                    ALTER COLUMN tentative_start_time TYPE TIMESTAMPTZ
                    USING tentative_start_time AT TIME ZONE 'Asia/Kolkata';
                END IF;

                IF EXISTS (
                    SELECT 1
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'event'
                      AND column_name = 'actual_start_time'
                      AND data_type = 'timestamp without time zone'
                ) THEN
                    ALTER TABLE event
                    ALTER COLUMN actual_start_time TYPE TIMESTAMPTZ
                    USING actual_start_time AT TIME ZONE 'Asia/Kolkata';
                END IF;
            END
            $$;
        `);



        const { AdminPermission } = require('./schemas');
        await AdminPermission.findOrCreate({ where: { id: 1 }, defaults: { name: 'event_crud' } });

        for (const label of schemaSteps) {
            console.log(`✅ ${label} table initialized`);
        }
        await applyConstraints();

        console.log('✨ Database schema initialized successfully!');
    } catch (error) {
        console.error('❌ Error initializing database schema:', error);
        throw error;
    }
};

module.exports = initializeSchema;
