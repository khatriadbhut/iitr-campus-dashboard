/**
 * Institution registry + the deterministic three-way document classifier.
 *
 * Adding a college later = register its config + strategy here. Everything else
 * (pipeline, DB, endpoints, UI) is untouched — this is the "start here" seam.
 */

const iitrConfig = require('./institutions/iitr.config');
const iitrDeterministic = require('./strategies/iitrDeterministic');

const REGISTRY = [
    { config: iitrConfig, strategy: iitrDeterministic },
];

/**
 * Deterministic-first classifier. Returns one of:
 *   { kind: 'general',      config, strategy }          → parse it
 *   { kind: 'coming_soon',  reason }                    → recognized but unsupported (MBA/other)
 *   { kind: 'not_calendar' }                            → unrelated document
 *   { kind: 'uncertain' }                               → let the LLM tie-break (fail safe otherwise)
 *
 * Groq is intentionally NOT called here — the orchestrator invokes the LLM
 * tie-breaker only when kind === 'uncertain', and fails safe if it's unavailable.
 */
function classifyDocument(pages) {
    const text = (pages || []).join('\n');

    for (const { config, strategy } of REGISTRY) {
        const isCalendar = config.calendarMarkers.some((re) => re.test(text));
        if (!isCalendar) continue;

        const isMBA = config.mbaMarkers.some((re) => re.test(text));
        const isGeneral =
            config.generalMarkers.some((re) => re.test(text)) ||
            config.structureMarkers.some((re) => re.test(text));

        if (isMBA) {
            return { kind: 'coming_soon', reason: 'mba', institution: config.institution };
        }
        if (isGeneral) {
            return { kind: 'general', config, strategy, institution: config.institution };
        }
        // It's an IITR calendar but neither clearly general nor MBA → recognized, unsupported.
        return { kind: 'coming_soon', reason: 'other-format', institution: config.institution };
    }

    // No institution's calendar fingerprint matched.
    const looksCalendarish = /academic\s+calendar|semester|examination/i.test(text);
    return looksCalendarish ? { kind: 'uncertain' } : { kind: 'not_calendar' };
}

module.exports = { classifyDocument, REGISTRY };
