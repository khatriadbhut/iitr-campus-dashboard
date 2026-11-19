import React, { useEffect, useMemo, useState } from 'react';
import clubsService from '../../services/clubs';
import { noticeBodyLines } from '../../utils/notice';

/**
 * Every field a notice has, in one place.
 *
 * It existed twice in effect: the Edit Notice modal captured the whole notice, while the review card
 * showed a subset — no body, no kind, no audience, no importance, no external chip. So an admin
 * approved a notice without ever seeing the text a student would read, and could only fix it AFTER
 * publishing. That is backwards: review is where you decide whether it is good, and the body is the
 * main thing being judged. Three notices reached the feed that way with a stray "• Prof. Karun Rawat"
 * signature line, and one with raw forwarded text cut mid-URL, none of it visible at review time.
 *
 * Sharing rather than copying is deliberate. Two other pairs in this codebase were duplicated and
 * drifted — getDurationLabel (Calendar vs EventDetail) and isExpired — and each drift was invisible
 * until someone compared them by hand.
 *
 * The vocabulary is the NOTICE's own field names (body, kind, deadline, is_external…), not the review
 * draft's camelCase. The review card maps into and out of them, so this component never has to know
 * which screen it is on.
 */
const TEXTISH = [
    ['title', 'Title', 'text'],
    ['deadline', 'Apply by (deadline)', 'date'],
    ['deadline_time', 'Closes at', 'time'],
    ['event_date', 'Happens on', 'date'],
    ['time_start', 'Start time', 'time'],
    ['venue', 'Venue', 'text'],
    ['link', 'Link', 'text'],
    ['kind', 'Kind', 'text'],
    ['audience', 'Audience (max 24)', 'text'],
];

// `omit` exists because the review card renders the title as its own headline input above the grid;
// rendering it twice would be two inputs for one value.
const NoticeFields = ({ value, onChange, deadlineSource = null, clubs: clubsProp = null, omit = [] }) => {
    const skip = (k) => omit.includes(k);
    // Raw text while the body field has focus; null means "show the tidied version".
    const [typing, setTyping] = useState(null);
    // The roster is fetched here unless the parent already has it, so either screen can drop the
    // component in without wiring a fetch of its own.
    const [fetched, setFetched] = useState([]);
    useEffect(() => {
        if (clubsProp) return undefined;
        let alive = true;
        clubsService.getAllClubs().then((c) => { if (alive) setFetched(c); }).catch(() => { if (alive) setFetched([]); });
        return () => { alive = false; };
    }, [clubsProp]);
    const clubs = clubsProp || fetched;

    const val = (k) => (value[k] ?? '');
    const set = (k, v) => onChange(k, v);

    // One point per LINE, because that is how the card renders it — the reader sees bullets, so the
    // editor should show bullets. As a paragraph an admin cannot tell which sentence becomes which
    // bullet. The splitter is abbreviation-aware, so "Prof. S.N. Tandon" stays on one line.
    const bodyLines = useMemo(
        () => String(value.body || '')
            .split(/\r?\n/)
            .flatMap((line) => noticeBodyLines(line))
            .map((l) => l.trim())
            .filter(Boolean),
        [value.body],
    );

    const seg = (key, fallback, options, label, hint) => (
        <div className="pr-field" style={{ gridColumn: '1 / -1' }}>
            <span>{label} <em className="pr-muted">— {hint}</em></span>
            <div className="pr-seg">
                {options.map(([v, text]) => (
                    <button
                        key={String(v)} type="button"
                        className={`pr-seg-btn ${(value[key] ?? fallback) === v ? 'active' : ''}`}
                        onClick={() => set(key, v)}
                    >
                        {text}
                    </button>
                ))}
            </div>
        </div>
    );

    return (
        <>
            {TEXTISH.filter(([k]) => !skip(k)).map(([k, label, type]) => (
                <div className="pr-field" key={k}>
                    <span>{label}</span>
                    <input
                        className="pr-input" type={type} value={val(k)}
                        maxLength={k === 'audience' ? 24 : undefined}
                        onChange={(e) => set(k, e.target.value)}
                    />
                </div>
            ))}

            {/* A dropdown, not a name box: the API takes club_id, and a typed name is how attribution
                silently breaks — "Fine Arts " with a trailing space matches no club and quietly becomes
                an office notice. "No club" stores NULL, which is what keeps an office announcement off
                every club page — and club_id is what "hide clubs I don't follow" tests against. */}
            <div className="pr-field">
                <span>Club</span>
                <select
                    className="pr-input"
                    value={value.club_id ?? ''}
                    onChange={(e) => set('club_id', e.target.value === '' ? null : Number(e.target.value))}
                >
                    <option value="">No club — office notice</option>
                    {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
            </div>

            <div className="pr-field" style={{ gridColumn: '1 / -1' }}>
                <span>Body <em className="pr-muted">— one point per line, as shown on the card</em></span>
                <textarea
                    className="pr-input"
                    rows={Math.min(10, Math.max(4, bodyLines.length + 1))}
                    // `typing` holds the RAW text while the field has focus. Normalising on every
                    // keystroke made it impossible to add a line at all: pressing Enter created an
                    // empty line, filter(Boolean) removed it in the same tick, and the value came back
                    // unchanged — so the caret could never reach the new line. The same trim() also ate
                    // a leading space as you typed it. Tidy on blur instead, when the edit is finished.
                    value={typing !== null ? typing : bodyLines.join('\n')}
                    onChange={(e) => { setTyping(e.target.value); set('body', e.target.value); }}
                    onBlur={() => {
                        set('body', String(value.body || '').split('\n').map((l) => l.trim()).filter(Boolean).join('\n'));
                        setTyping(null);   // fall back to the tidied, derived view
                    }}
                />
            </div>

            {/* Provenance for a derived deadline. Editing the date clears this on the server — a
                corrected date is a stated one. */}
            {deadlineSource === 'calendar' && (
                <div className="pr-field" style={{ gridColumn: '1 / -1' }}>
                    <span>Apply-by provenance</span>
                    <div className="pr-rule-preview">
                        📅 <strong>{value.deadline}</strong> was taken from the academic calendar — this notice
                        stated no date of its own. Editing the date above replaces it with a stated one.
                    </div>
                </div>
            )}

            {/* Flags the pipeline already decided, pre-selected to its answer, so reviewing is
                confirming-or-correcting rather than filling a form in: agreeing should cost zero clicks. */}
            {seg('priority', 'general', [['important', 'Important'], ['general', 'General']],
                'Importance', 'pinned band on the Notices tab')}
            {seg('is_external', false, [[false, 'IIT Roorkee'], [true, 'External body']],
                'Run by', 'shows the EXTERNAL chip')}
        </>
    );
};

export default NoticeFields;
