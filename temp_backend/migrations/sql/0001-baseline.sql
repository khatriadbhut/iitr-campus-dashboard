--
-- PostgreSQL database dump
--


-- Dumped from database version 16.14 (Homebrew)
-- Dumped by pg_dump version 16.14 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: btree_gist; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;


--
-- Name: EXTENSION btree_gist; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION btree_gist IS 'support for indexing common datatypes in GiST';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: academic_calendar_entry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.academic_calendar_entry (
    id character varying(160) NOT NULL,
    institution character varying(32) DEFAULT 'IITR'::character varying NOT NULL,
    semester character varying(48) NOT NULL,
    program character varying(32) DEFAULT 'general'::character varying NOT NULL,
    title text NOT NULL,
    category character varying(32) DEFAULT 'Academic'::character varying NOT NULL,
    start_date date,
    end_date date,
    description text,
    is_holiday boolean DEFAULT false NOT NULL,
    tentative boolean DEFAULT false NOT NULL,
    raw_date_text text,
    source_import_id bigint,
    sort_order integer DEFAULT 0 NOT NULL,
    source character varying(8) DEFAULT 'pdf'::character varying NOT NULL
);


--
-- Name: academic_calendar_import; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.academic_calendar_import (
    id bigint NOT NULL,
    institution character varying(32) DEFAULT 'IITR'::character varying NOT NULL,
    semester character varying(48) NOT NULL,
    program character varying(32) DEFAULT 'general'::character varying NOT NULL,
    status character varying(16) NOT NULL,
    strategy character varying(48),
    uploaded_by bigint,
    source_filename text,
    parsed_snapshot jsonb NOT NULL,
    coverage jsonb,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: academic_calendar_import_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.academic_calendar_import_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: academic_calendar_import_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.academic_calendar_import_id_seq OWNED BY public.academic_calendar_import.id;


--
-- Name: admin_permission; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_permission (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: admin_permission_alloted; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_permission_alloted (
    admin_permission_id integer NOT NULL,
    user_id bigint NOT NULL
);


--
-- Name: admin_permission_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.admin_permission_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: admin_permission_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.admin_permission_id_seq OWNED BY public.admin_permission.id;


--
-- Name: classification_override; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.classification_override (
    id integer NOT NULL,
    sender_addr text NOT NULL,
    subject_pattern text,
    target_type character varying(16) NOT NULL,
    created_by bigint,
    hit_count integer DEFAULT 0 NOT NULL,
    last_hit_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: classification_override_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.classification_override_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: classification_override_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.classification_override_id_seq OWNED BY public.classification_override.id;


--
-- Name: club; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.club (
    id integer NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    description text,
    logo_url text,
    is_fest boolean DEFAULT false NOT NULL
);


--
-- Name: club_admin; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.club_admin (
    club_id integer NOT NULL,
    user_id bigint NOT NULL
);


--
-- Name: club_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.club_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: club_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.club_id_seq OWNED BY public.club.id;


--
-- Name: event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event (
    id integer NOT NULL,
    name text NOT NULL,
    club_id bigint NOT NULL,
    location_id integer,
    tentative_start_time timestamp with time zone NOT NULL,
    duration_minutes integer NOT NULL,
    actual_start_time timestamp with time zone,
    description text,
    image_url text,
    is_all_day boolean DEFAULT false,
    source character varying(16) DEFAULT 'manual'::character varying NOT NULL,
    status character varying(16) DEFAULT 'scheduled'::character varying NOT NULL,
    source_sender text,
    source_message_id character varying(255),
    registration_link text,
    audience character varying(24),
    registration_deadline date,
    venue_text text
);


--
-- Name: event_category; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_category (
    id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: event_category_alloted; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_category_alloted (
    event_id integer NOT NULL,
    event_category_id integer NOT NULL
);


--
-- Name: event_category_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.event_category_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: event_category_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.event_category_id_seq OWNED BY public.event_category.id;


--
-- Name: event_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.event_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: event_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.event_id_seq OWNED BY public.event.id;


--
-- Name: event_proposal; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_proposal (
    id bigint NOT NULL,
    ingested_email_id bigint,
    mutation_type character varying(24) NOT NULL,
    target_event_id integer,
    club_id bigint,
    payload jsonb,
    evidence jsonb,
    state character varying(16) DEFAULT 'proposed'::character varying NOT NULL,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: event_proposal_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.event_proposal_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: event_proposal_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.event_proposal_id_seq OWNED BY public.event_proposal.id;


--
-- Name: event_update; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_update (
    id integer NOT NULL,
    event_id integer NOT NULL,
    update text NOT NULL
);


--
-- Name: event_update_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.event_update_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: event_update_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.event_update_id_seq OWNED BY public.event_update.id;


--
-- Name: ingested_email; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ingested_email (
    id bigint NOT NULL,
    message_id character varying(255) NOT NULL,
    thread_id character varying(255),
    internal_date timestamp with time zone,
    from_addr text,
    to_addrs text,
    subject text,
    body_text text,
    raw_snapshot jsonb,
    state character varying(16) DEFAULT 'parsed'::character varying NOT NULL,
    error text,
    created_at timestamp with time zone NOT NULL,
    dedup_key character varying(255)
);


--
-- Name: ingested_email_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ingested_email_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ingested_email_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ingested_email_id_seq OWNED BY public.ingested_email.id;


--
-- Name: ingestion_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ingestion_state (
    key character varying(64) NOT NULL,
    value text,
    updated_at timestamp with time zone NOT NULL
);


--
-- Name: location; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.location (
    id integer NOT NULL,
    name text NOT NULL,
    location_url text,
    latitude double precision,
    longitude double precision,
    description text,
    images jsonb DEFAULT '[]'::jsonb
);


--
-- Name: location_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.location_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: location_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.location_id_seq OWNED BY public.location.id;


--
-- Name: notice; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notice (
    id bigint NOT NULL,
    title text NOT NULL,
    body text,
    priority character varying(12) DEFAULT 'general'::character varying NOT NULL,
    link text,
    deadline date,
    open_ended boolean DEFAULT false NOT NULL,
    audience character varying(24),
    source_message_id character varying(255),
    published_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    source character varying(120),
    kind character varying(24),
    is_opportunity boolean DEFAULT false NOT NULL
);


--
-- Name: notice_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notice_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notice_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notice_id_seq OWNED BY public.notice.id;


--
-- Name: reminder; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reminder (
    event_id integer NOT NULL,
    user_id bigint NOT NULL,
    offset_minutes integer DEFAULT 30 NOT NULL,
    reminder_time timestamp with time zone NOT NULL
);


--
-- Name: sender_entity_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sender_entity_map (
    id integer NOT NULL,
    match_type character varying(16) DEFAULT 'sender'::character varying NOT NULL,
    match_value text NOT NULL,
    club_id bigint,
    created_by bigint,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: sender_entity_map_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sender_entity_map_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sender_entity_map_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sender_entity_map_id_seq OWNED BY public.sender_entity_map.id;


--
-- Name: user; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."user" (
    user_id bigint NOT NULL,
    full_name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    phone_number character varying(20),
    display_picture text,
    enrolment_number character varying(255),
    branch character varying(255),
    current_year integer,
    branch_department_name character varying(255),
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- Name: user_not_preferred_category; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_not_preferred_category (
    event_category_id integer NOT NULL,
    user_id bigint NOT NULL
);


--
-- Name: user_not_preferred_club; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_not_preferred_club (
    club_id bigint NOT NULL,
    user_id bigint NOT NULL
);


--
-- Name: user_preferred_category; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_preferred_category (
    event_category_id integer NOT NULL,
    user_id bigint NOT NULL
);


--
-- Name: user_preferred_club; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_preferred_club (
    club_id bigint NOT NULL,
    user_id bigint NOT NULL
);


--
-- Name: user_todo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_todo (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    text text NOT NULL,
    notes text,
    due_date date,
    due_time character varying(5) DEFAULT NULL::character varying,
    completed boolean DEFAULT false NOT NULL,
    linked_event_id bigint,
    linked_event_name text,
    linked_event_club text,
    linked_event_date text,
    created_at timestamp with time zone
);


--
-- Name: user_todo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_todo_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_todo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_todo_id_seq OWNED BY public.user_todo.id;


--
-- Name: academic_calendar_import id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_calendar_import ALTER COLUMN id SET DEFAULT nextval('public.academic_calendar_import_id_seq'::regclass);


--
-- Name: admin_permission id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_permission ALTER COLUMN id SET DEFAULT nextval('public.admin_permission_id_seq'::regclass);


--
-- Name: classification_override id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classification_override ALTER COLUMN id SET DEFAULT nextval('public.classification_override_id_seq'::regclass);


--
-- Name: club id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club ALTER COLUMN id SET DEFAULT nextval('public.club_id_seq'::regclass);


--
-- Name: event id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event ALTER COLUMN id SET DEFAULT nextval('public.event_id_seq'::regclass);


--
-- Name: event_category id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_category ALTER COLUMN id SET DEFAULT nextval('public.event_category_id_seq'::regclass);


--
-- Name: event_proposal id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_proposal ALTER COLUMN id SET DEFAULT nextval('public.event_proposal_id_seq'::regclass);


--
-- Name: event_update id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_update ALTER COLUMN id SET DEFAULT nextval('public.event_update_id_seq'::regclass);


--
-- Name: ingested_email id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingested_email ALTER COLUMN id SET DEFAULT nextval('public.ingested_email_id_seq'::regclass);


--
-- Name: location id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location ALTER COLUMN id SET DEFAULT nextval('public.location_id_seq'::regclass);


--
-- Name: notice id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notice ALTER COLUMN id SET DEFAULT nextval('public.notice_id_seq'::regclass);


--
-- Name: sender_entity_map id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sender_entity_map ALTER COLUMN id SET DEFAULT nextval('public.sender_entity_map_id_seq'::regclass);


--
-- Name: user_todo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_todo ALTER COLUMN id SET DEFAULT nextval('public.user_todo_id_seq'::regclass);


--
-- Name: academic_calendar_entry academic_calendar_entry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_calendar_entry
    ADD CONSTRAINT academic_calendar_entry_pkey PRIMARY KEY (id);


--
-- Name: academic_calendar_import academic_calendar_import_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_calendar_import
    ADD CONSTRAINT academic_calendar_import_pkey PRIMARY KEY (id);


--
-- Name: admin_permission_alloted admin_permission_alloted_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_permission_alloted
    ADD CONSTRAINT admin_permission_alloted_pkey PRIMARY KEY (admin_permission_id, user_id);


--
-- Name: admin_permission admin_permission_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_permission
    ADD CONSTRAINT admin_permission_name_key UNIQUE (name);


--
-- Name: admin_permission admin_permission_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_permission
    ADD CONSTRAINT admin_permission_pkey PRIMARY KEY (id);


--
-- Name: classification_override classification_override_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classification_override
    ADD CONSTRAINT classification_override_pkey PRIMARY KEY (id);


--
-- Name: club_admin club_admin_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_admin
    ADD CONSTRAINT club_admin_pkey PRIMARY KEY (club_id, user_id);


--
-- Name: club club_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club
    ADD CONSTRAINT club_email_key UNIQUE (email);


--
-- Name: club club_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club
    ADD CONSTRAINT club_name_key UNIQUE (name);


--
-- Name: club club_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club
    ADD CONSTRAINT club_pkey PRIMARY KEY (id);


--
-- Name: event_category_alloted event_category_alloted_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_category_alloted
    ADD CONSTRAINT event_category_alloted_pkey PRIMARY KEY (event_id, event_category_id);


--
-- Name: event_category event_category_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_category
    ADD CONSTRAINT event_category_name_key UNIQUE (name);


--
-- Name: event_category event_category_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_category
    ADD CONSTRAINT event_category_pkey PRIMARY KEY (id);


--
-- Name: event event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event
    ADD CONSTRAINT event_pkey PRIMARY KEY (id);


--
-- Name: event_proposal event_proposal_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_proposal
    ADD CONSTRAINT event_proposal_pkey PRIMARY KEY (id);


--
-- Name: event_update event_update_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_update
    ADD CONSTRAINT event_update_pkey PRIMARY KEY (id);


--
-- Name: ingested_email ingested_email_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingested_email
    ADD CONSTRAINT ingested_email_message_id_key UNIQUE (message_id);


--
-- Name: ingested_email ingested_email_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingested_email
    ADD CONSTRAINT ingested_email_pkey PRIMARY KEY (id);


--
-- Name: ingestion_state ingestion_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingestion_state
    ADD CONSTRAINT ingestion_state_pkey PRIMARY KEY (key);


--
-- Name: location location_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location
    ADD CONSTRAINT location_name_key UNIQUE (name);


--
-- Name: location location_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.location
    ADD CONSTRAINT location_pkey PRIMARY KEY (id);


--
-- Name: notice notice_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notice
    ADD CONSTRAINT notice_pkey PRIMARY KEY (id);


--
-- Name: reminder reminder_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder
    ADD CONSTRAINT reminder_pkey PRIMARY KEY (event_id, user_id, offset_minutes);


--
-- Name: sender_entity_map sender_entity_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sender_entity_map
    ADD CONSTRAINT sender_entity_map_pkey PRIMARY KEY (id);


--
-- Name: user user_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_email_key UNIQUE (email);


--
-- Name: user user_enrolment_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_enrolment_number_key UNIQUE (enrolment_number);


--
-- Name: user_not_preferred_category user_not_preferred_category_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_not_preferred_category
    ADD CONSTRAINT user_not_preferred_category_pkey PRIMARY KEY (event_category_id, user_id);


--
-- Name: user_not_preferred_club user_not_preferred_club_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_not_preferred_club
    ADD CONSTRAINT user_not_preferred_club_pkey PRIMARY KEY (club_id, user_id);


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (user_id);


--
-- Name: user_preferred_category user_preferred_category_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferred_category
    ADD CONSTRAINT user_preferred_category_pkey PRIMARY KEY (event_category_id, user_id);


--
-- Name: user_preferred_club user_preferred_club_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferred_club
    ADD CONSTRAINT user_preferred_club_pkey PRIMARY KEY (club_id, user_id);


--
-- Name: user_todo user_todo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_todo
    ADD CONSTRAINT user_todo_pkey PRIMARY KEY (id);


--
-- Name: idx_acal_entry_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acal_entry_key ON public.academic_calendar_entry USING btree (institution, semester, program);


--
-- Name: idx_acal_entry_start; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acal_entry_start ON public.academic_calendar_entry USING btree (start_date);


--
-- Name: idx_acal_import_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_acal_import_key ON public.academic_calendar_import USING btree (institution, semester, program);


--
-- Name: idx_clsoverride_sender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clsoverride_sender ON public.classification_override USING btree (sender_addr);


--
-- Name: idx_eca_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eca_category ON public.event_category_alloted USING btree (event_category_id);


--
-- Name: idx_event_club; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_club ON public.event USING btree (club_id);


--
-- Name: idx_event_proposal_club; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_proposal_club ON public.event_proposal USING btree (club_id);


--
-- Name: idx_event_proposal_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_proposal_email ON public.event_proposal USING btree (ingested_email_id);


--
-- Name: idx_event_proposal_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_proposal_state ON public.event_proposal USING btree (state);


--
-- Name: idx_event_start_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_start_time ON public.event USING btree (tentative_start_time);


--
-- Name: idx_event_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_status ON public.event USING btree (status);


--
-- Name: idx_ingested_email_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ingested_email_date ON public.ingested_email USING btree (internal_date);


--
-- Name: idx_ingested_email_dedup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ingested_email_dedup ON public.ingested_email USING btree (dedup_key);


--
-- Name: idx_ingested_email_msgid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_ingested_email_msgid ON public.ingested_email USING btree (message_id);


--
-- Name: idx_notice_deadline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notice_deadline ON public.notice USING btree (deadline);


--
-- Name: idx_notice_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notice_priority ON public.notice USING btree (priority);


--
-- Name: idx_notice_published; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notice_published ON public.notice USING btree (published_at);


--
-- Name: idx_pref_club_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pref_club_user ON public.user_preferred_club USING btree (user_id);


--
-- Name: idx_sender_map_value; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sender_map_value ON public.sender_entity_map USING btree (match_value);


--
-- Name: idx_unpref_club_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_unpref_club_user ON public.user_not_preferred_club USING btree (user_id);


--
-- Name: idx_user_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_email ON public."user" USING btree (email);


--
-- Name: idx_user_enrolment_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_enrolment_number ON public."user" USING btree (enrolment_number);


--
-- Name: idx_user_todo_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_todo_user_id ON public.user_todo USING btree (user_id);


--
-- Name: academic_calendar_entry academic_calendar_entry_source_import_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.academic_calendar_entry
    ADD CONSTRAINT academic_calendar_entry_source_import_id_fkey FOREIGN KEY (source_import_id) REFERENCES public.academic_calendar_import(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: admin_permission_alloted admin_permission_alloted_admin_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_permission_alloted
    ADD CONSTRAINT admin_permission_alloted_admin_permission_id_fkey FOREIGN KEY (admin_permission_id) REFERENCES public.admin_permission(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: admin_permission_alloted admin_permission_alloted_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_permission_alloted
    ADD CONSTRAINT admin_permission_alloted_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(user_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: club_admin club_admin_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_admin
    ADD CONSTRAINT club_admin_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.club(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: club_admin club_admin_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_admin
    ADD CONSTRAINT club_admin_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(user_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: event_category_alloted event_category_alloted_event_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_category_alloted
    ADD CONSTRAINT event_category_alloted_event_category_id_fkey FOREIGN KEY (event_category_id) REFERENCES public.event_category(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: event_category_alloted event_category_alloted_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_category_alloted
    ADD CONSTRAINT event_category_alloted_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.event(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: event event_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event
    ADD CONSTRAINT event_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.club(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: event event_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event
    ADD CONSTRAINT event_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.location(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: event_proposal event_proposal_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_proposal
    ADD CONSTRAINT event_proposal_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.club(id) ON DELETE SET NULL;


--
-- Name: event_proposal event_proposal_ingested_email_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_proposal
    ADD CONSTRAINT event_proposal_ingested_email_id_fkey FOREIGN KEY (ingested_email_id) REFERENCES public.ingested_email(id) ON DELETE SET NULL;


--
-- Name: event_proposal event_proposal_target_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_proposal
    ADD CONSTRAINT event_proposal_target_event_id_fkey FOREIGN KEY (target_event_id) REFERENCES public.event(id) ON DELETE SET NULL;


--
-- Name: event_update event_update_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_update
    ADD CONSTRAINT event_update_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.event(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: reminder reminder_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder
    ADD CONSTRAINT reminder_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.event(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: reminder reminder_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder
    ADD CONSTRAINT reminder_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(user_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sender_entity_map sender_entity_map_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sender_entity_map
    ADD CONSTRAINT sender_entity_map_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.club(id) ON DELETE SET NULL;


--
-- Name: user_not_preferred_category user_not_preferred_category_event_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_not_preferred_category
    ADD CONSTRAINT user_not_preferred_category_event_category_id_fkey FOREIGN KEY (event_category_id) REFERENCES public.event_category(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_not_preferred_category user_not_preferred_category_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_not_preferred_category
    ADD CONSTRAINT user_not_preferred_category_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(user_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_not_preferred_club user_not_preferred_club_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_not_preferred_club
    ADD CONSTRAINT user_not_preferred_club_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.club(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_not_preferred_club user_not_preferred_club_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_not_preferred_club
    ADD CONSTRAINT user_not_preferred_club_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(user_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_preferred_category user_preferred_category_event_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferred_category
    ADD CONSTRAINT user_preferred_category_event_category_id_fkey FOREIGN KEY (event_category_id) REFERENCES public.event_category(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_preferred_category user_preferred_category_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferred_category
    ADD CONSTRAINT user_preferred_category_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(user_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_preferred_club user_preferred_club_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferred_club
    ADD CONSTRAINT user_preferred_club_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.club(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_preferred_club user_preferred_club_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_preferred_club
    ADD CONSTRAINT user_preferred_club_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(user_id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: user_todo user_todo_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_todo
    ADD CONSTRAINT user_todo_user_id_fkey FOREIGN KEY (user_id) REFERENCES public."user"(user_id) ON UPDATE CASCADE;


--
-- PostgreSQL database dump complete
--


