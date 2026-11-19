const sequelize = require('../connection');
const User = require('./user');
const AdminPermission = require('./adminPermission');
const AdminPermissionAlloted = require('./adminPermissionAlloted');
const Club = require('./club');
const ClubAdmin = require('./clubAdmin');
const Location = require('./location');
const Event = require('./event');
const EventCategory = require('./eventCategory');
const EventCategoryAlloted = require('./eventCategoryAlloted');
const EventUpdate = require('./eventUpdate');
const Reminder = require('./reminder');
const UserNotPreferredCategory = require('./userNotPreferredCategory');
const UserNotPreferredClub = require('./userNotPreferredClub');
const UserPreferredCategory = require('./userPreferredCategory');
const UserPreferredClub = require('./userPreferredClub');
const UserTodo = require('./userTodo');
const AcademicCalendarImport = require('./academicCalendarImport');
const AcademicCalendarEntry = require('./academicCalendarEntry');
const IngestedEmail = require('./ingestedEmail');
const EventProposal = require('./eventProposal');
const Notice = require('./notice');
const SenderEntityMap = require('./senderEntityMap');
const ClassificationOverride = require('./classificationOverride');
const IngestionState = require('./ingestionState');
const PrivilegeAudit = require('./privilegeAudit');
const UserNotificationPref = require('./userNotificationPref');
const Notification = require('./notification');
const NoticeReminder = require('./noticeReminder');
const PushSubscription = require('./pushSubscription');

// ─── Associations ────────────────────────────────────────────────────────────

// AdminPermission <-> User (through AdminPermissionAlloted)
AdminPermission.belongsToMany(User, { through: AdminPermissionAlloted, foreignKey: 'admin_permission_id' });
User.belongsToMany(AdminPermission, { through: AdminPermissionAlloted, foreignKey: 'user_id' });

// Club <-> User (admins, through ClubAdmin)
Club.belongsToMany(User, { through: ClubAdmin, foreignKey: 'club_id', as: 'admins' });
User.belongsToMany(Club, { through: ClubAdmin, foreignKey: 'user_id', as: 'adminOf' });

ClubAdmin.belongsTo(User, { foreignKey: 'user_id' });
User.hasMany(ClubAdmin, { foreignKey: 'user_id' });

// Event -> Club
Event.belongsTo(Club, { foreignKey: 'club_id' });
Club.hasMany(Event, { foreignKey: 'club_id' });

// Notice -> Club (optional: office notices have no club; club recruitment/PoR/competition notices do)
Notice.belongsTo(Club, { foreignKey: 'club_id' });
Club.hasMany(Notice, { foreignKey: 'club_id' });

// Event -> Location
Event.belongsTo(Location, { foreignKey: 'location_id' });
Location.hasMany(Event, { foreignKey: 'location_id' });

// EventCategory <-> Event (through EventCategoryAlloted)
EventCategory.belongsToMany(Event, { through: EventCategoryAlloted, foreignKey: 'event_category_id' });
Event.belongsToMany(EventCategory, { through: EventCategoryAlloted, foreignKey: 'event_id' });
// belongsToMany defines the association on Event and EventCategory, NOT on the join model itself, so
// querying EventCategoryAlloted directly with an include threw
// "EventCategory is not associated to EventCategoryAlloted!" and 500'd. That is what the email-review
// queue does when it looks up candidate events for an UPDATE proposal — it reads the join table for a
// handful of event ids rather than eager-loading categories for all 300 candidates. These two make
// that direction of the association legal.
EventCategoryAlloted.belongsTo(EventCategory, { foreignKey: 'event_category_id' });
EventCategoryAlloted.belongsTo(Event, { foreignKey: 'event_id' });

// EventUpdate -> Event
EventUpdate.belongsTo(Event, { foreignKey: 'event_id' });
Event.hasMany(EventUpdate, { foreignKey: 'event_id' });

// Reminder -> Event, User
Reminder.belongsTo(Event, { foreignKey: 'event_id' });
Reminder.belongsTo(User, { foreignKey: 'user_id' });
Event.hasMany(Reminder, { foreignKey: 'event_id' });
User.hasMany(Reminder, { foreignKey: 'user_id' });

// The four preference tables. Both directions are declared: routes/event.js filters events by
// including Club -> UserPreferredClub (and EventCategory -> UserPreferredCategory), which needs the
// REVERSE association. Only belongsTo was declared, so Sequelize threw "UserPreferredClub is not
// associated to Club!" and /events/clubs/preferred, /clubs/not-preferred, /categories/preferred and
// /categories/not-preferred all returned 500.

// UserNotPreferredCategory <-> User, EventCategory
UserNotPreferredCategory.belongsTo(User, { foreignKey: 'user_id' });
UserNotPreferredCategory.belongsTo(EventCategory, { foreignKey: 'event_category_id' });
User.hasMany(UserNotPreferredCategory, { foreignKey: 'user_id' });
EventCategory.hasMany(UserNotPreferredCategory, { foreignKey: 'event_category_id' });

// UserNotPreferredClub <-> User, Club
UserNotPreferredClub.belongsTo(User, { foreignKey: 'user_id' });
UserNotPreferredClub.belongsTo(Club, { foreignKey: 'club_id' });
User.hasMany(UserNotPreferredClub, { foreignKey: 'user_id' });
Club.hasMany(UserNotPreferredClub, { foreignKey: 'club_id' });

// UserPreferredCategory <-> User, EventCategory
UserPreferredCategory.belongsTo(User, { foreignKey: 'user_id' });
UserPreferredCategory.belongsTo(EventCategory, { foreignKey: 'event_category_id' });
User.hasMany(UserPreferredCategory, { foreignKey: 'user_id' });
EventCategory.hasMany(UserPreferredCategory, { foreignKey: 'event_category_id' });

// UserPreferredClub <-> User, Club
UserPreferredClub.belongsTo(User, { foreignKey: 'user_id' });
UserPreferredClub.belongsTo(Club, { foreignKey: 'club_id' });
User.hasMany(UserPreferredClub, { foreignKey: 'user_id' });
Club.hasMany(UserPreferredClub, { foreignKey: 'club_id' });

// UserTodo -> User
UserTodo.belongsTo(User, { foreignKey: 'user_id' });
User.hasMany(UserTodo, { foreignKey: 'user_id' });

// AcademicCalendarEntry -> AcademicCalendarImport (provenance / rollback)
AcademicCalendarEntry.belongsTo(AcademicCalendarImport, { foreignKey: 'source_import_id' });
AcademicCalendarImport.hasMany(AcademicCalendarEntry, { foreignKey: 'source_import_id' });

// Email ingestion (Feature #2): raw email -> typed change-proposals -> published events/notices
IngestedEmail.hasMany(EventProposal, { foreignKey: 'ingested_email_id' });
EventProposal.belongsTo(IngestedEmail, { foreignKey: 'ingested_email_id' });
EventProposal.belongsTo(Club, { foreignKey: 'club_id' });
EventProposal.belongsTo(Event, { foreignKey: 'target_event_id' });
SenderEntityMap.belongsTo(Club, { foreignKey: 'club_id' });

// ─── Export ──────────────────────────────────────────────────────────────────

// NoticeReminder -> Notice, so GET /notice-reminders can return the notice's title and date and a
// second device can rebuild the card without already having a local copy of the notice.
NoticeReminder.belongsTo(Notice, { foreignKey: 'notice_id' });
Notice.hasMany(NoticeReminder, { foreignKey: 'notice_id' });

module.exports = {
    sequelize,
    User,
    AdminPermission,
    AdminPermissionAlloted,
    Club,
    ClubAdmin,
    Location,
    Event,
    EventCategory,
    EventCategoryAlloted,
    EventUpdate,
    Reminder,
    UserNotPreferredCategory,
    UserNotPreferredClub,
    UserPreferredCategory,
    UserPreferredClub,
    UserTodo,
    AcademicCalendarImport,
    AcademicCalendarEntry,
    IngestedEmail,
    EventProposal,
    Notice,
    SenderEntityMap,
    ClassificationOverride,
    IngestionState,
    PrivilegeAudit,
    UserNotificationPref,
    Notification,
    NoticeReminder,
    PushSubscription,
};