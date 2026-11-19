# Campus Dashboard & Event Planner — Architecture & Database Documentation

This directory contains technical documentation for the **IITR Campus Dashboard & Event Planner** backend and frontend system.

---

## 1. High-Level Architecture Overview

The system is structured as a full-stack campus event and personal management platform:
- **Frontend**: React Single Page Application (Vite, React Router, Lucide Icons, PWA enabled).
- **Backend**: Express.js REST API with Node.js.
- **ORM & Database**: Sequelize ORM connecting to PostgreSQL (Neon Cloud / Local).
- **Auth Flow**: Channel-i OAuth 2.0 authentication combined with HTTP-Only JWT cookies.

---

## 2. Entity-Relationship (ER) Diagram

```mermaid
erDiagram
    USER ||--o{ CLUB_ADMIN : "manages"
    USER ||--o{ ADMIN_PERMISSION_ALLOTED : "has permissions"
    USER ||--o{ REMINDER : "sets"
    USER ||--o{ USER_TODO : "owns"
    USER ||--o{ USER_PREFERRED_CLUB : "follows"
    USER ||--o{ USER_NOT_PREFERRED_CLUB : "blocks"
    USER ||--o{ USER_PREFERRED_CATEGORY : "prefers"
    USER ||--o{ USER_NOT_PREFERRED_CATEGORY : "blocks category"

    CLUB ||--o{ EVENT : "hosts"
    CLUB ||--o{ CLUB_ADMIN : "assigned admins"
    
    LOCATION ||--o{ EVENT : "location for"

    EVENT ||--o{ EVENT_CATEGORY_ALLOTED : "categorized as"
    EVENT ||--o{ EVENT_UPDATE : "has updates"
    EVENT ||--o{ REMINDER : "reminded for"

    EVENT_CATEGORY ||--o{ EVENT_CATEGORY_ALLOTED : "assigned to"
    ADMIN_PERMISSION ||--o{ ADMIN_PERMISSION_ALLOTED : "granted via"

    USER {
        bigint user_id PK
        string full_name
        string email
        string phone_number
        string display_picture
        string enrolment_number
        string branch
        int current_year
        string branch_department_name
        timestamp created_at
        timestamp updated_at
    }

    CLUB {
        bigint id PK
        string name
        string email
        text description
        text logo_url
    }

    LOCATION {
        int id PK
        string name
        string map_url
    }

    EVENT {
        int id PK
        text name
        bigint club_id FK
        int location_id FK
        timestamp tentative_start_time
        int duration_minutes
        timestamp actual_start_time
        text description
        text image_url
        boolean is_all_day
    }

    EVENT_CATEGORY {
        int id PK
        string name
    }

    EVENT_CATEGORY_ALLOTED {
        int event_id PK, FK
        int event_category_id PK, FK
    }

    EVENT_UPDATE {
        int id PK
        int event_id FK
        text update_title
        text update_description
        timestamp created_at
    }

    REMINDER {
        int event_id PK, FK
        bigint user_id PK, FK
        int offset_minutes PK
        timestamp reminder_time
    }

    USER_TODO {
        bigint id PK
        bigint user_id FK
        text text
        text notes
        dateonly due_date
        string due_time
        boolean completed
        bigint linked_event_id
        text linked_event_name
        text linked_event_club
        text linked_event_date
        timestamp created_at
    }

    ADMIN_PERMISSION {
        int id PK
        text name
    }

    ADMIN_PERMISSION_ALLOTED {
        bigint user_id PK, FK
        int admin_permission_id PK, FK
    }

    CLUB_ADMIN {
        bigint user_id PK, FK
        bigint club_id PK, FK
    }

    USER_PREFERRED_CLUB {
        bigint user_id PK, FK
        bigint club_id PK, FK
    }

    USER_NOT_PREFERRED_CLUB {
        bigint user_id PK, FK
        bigint club_id PK, FK
    }

    USER_PREFERRED_CATEGORY {
        bigint user_id PK, FK
        int event_category_id PK, FK
    }

    USER_NOT_PREFERRED_CATEGORY {
        bigint user_id PK, FK
        int event_category_id PK, FK
    }
```

---

## 3. Core Database Tables & Models

### 1. `user`
Stores student / user profile information synchronized directly from Channel-i OAuth.
* **Primary Key**: `user_id` (BIGINT, mapped from Channel-i `userId`).
* **Key Fields**: `email`, `enrolment_number`, `branch`, `current_year`, `display_picture`.

### 2. `club`
Campus clubs, groups, or administrative bodies hosting events.
* **Primary Key**: `id` (BIGINT).
* **Fields**: `name`, `email`, `description`, `logo_url`.

### 3. `event`
Events posted by campus clubs or populated via the Academic Calendar integration.
* **Primary Key**: `id` (INTEGER).
* **Foreign Keys**: `club_id` $\rightarrow$ `club(id)`, `location_id` $\rightarrow$ `location(id)`.
* **Fields**: `tentative_start_time` (TIMESTAMPTZ), `duration_minutes`, `is_all_day`, `image_url`.

### 4. `user_todo`
Personal Assistant & TODO items created by students or auto-linked directly from event cards.
* **Primary Key**: `id` (BIGINT).
* **Foreign Key**: `user_id` $\rightarrow$ `user(user_id)`.
* **Fields**: `text`, `notes`, `due_date`, `due_time`, `completed`, `linked_event_id`, `linked_event_name`.

### 5. `reminder`
Browser/local notifications scheduled by users for specific events with customized lead times.
* **Composite Primary Key**: `(event_id, user_id, offset_minutes)`.
* **Fields**: `reminder_time`.

### 6. `admin_permission` & `admin_permission_alloted`
Global administrative role management system (`event_crud`, `manage_admins`, etc.).

---

## 4. Initialization & Migration Workflow

Database schema creation, indexing, and constraint configuration are managed programmatically:
* **Entry point**: `temp_backend/database/initializeSchema.js`
* **Sequelize Auto-Sync**: Creates table definitions if non-existent without destroying production data.
* **Seed Data**: Automatically ensures default admin permissions (e.g. `event_crud`) exist on startup.

To force a fresh database setup locally:
```bash
cd temp_backend
node database/initializeSchema.js
```
