const BLANK = new Set(['', 'null', 'undefined']);

const isBlank = (value) => {
    if (value == null) return true;
    const s = String(value).trim();
    return !s || BLANK.has(s.toLowerCase());
};

const firstNonBlank = (...values) => {
    for (const v of values) {
        if (!isBlank(v)) return String(v).trim();
    }
    return null;
};

/** dd/MM/yyyy, dd-MM-yyyy, dd.MM.yyyy */
export const parseDayMonthYear = (raw) => {
    const s = String(raw || '').trim();
    const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s|$)/);
    if (!m) return null;
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1000) return null;
    return { day, month, year };
};

/** Parses common app time strings (12h / 24h). Returns null if empty or invalid. */
export const parseEventTimeText = (raw) => {
    const t = String(raw || '').trim();
    if (!t) return null;

    let m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$/);
    if (m) {
        let hour = Number(m[1]);
        const minute = Number(m[2]);
        const meridiem = m[3].toUpperCase();
        if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
        if (meridiem === 'PM' && hour !== 12) hour += 12;
        if (meridiem === 'AM' && hour === 12) hour = 0;
        return { hour, minute };
    }

    m = t.match(/^(\d{1,2}):(\d{2})$/);
    if (m) {
        const hour = Number(m[1]);
        const minute = Number(m[2]);
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
        return { hour, minute };
    }

    return null;
};

const DEFAULT_WHEN_DATE_ONLY = { hour: 9, minute: 0 };

/**
 * Build ISO8601 UTC string from a date part + optional time text.
 * @param {string} datePart - ISO, yyyy-MM-dd, or dd/MM/yyyy
 * @param {string|null} timeText
 * @param {{ defaultTimeIfMissing?: boolean }} opts
 */
export const buildEventDateTimeIso = (datePart, timeText, opts = {}) => {
    if (isBlank(datePart)) return null;
    const s = String(datePart).trim();

    if (s.includes('T')) {
        const parsed = Date.parse(s);
        if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
    }

    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const [ymd] = s.split(/[T\s]/);
        const [year, month, day] = ymd.split('-').map(Number);
        const time = parseEventTimeText(timeText)
            || (opts.defaultTimeIfMissing ? DEFAULT_WHEN_DATE_ONLY : null);
        if (!time) return null;
        return new Date(Date.UTC(year, month - 1, day, time.hour, time.minute)).toISOString();
    }

    const dmy = parseDayMonthYear(s);
    if (!dmy) return null;

    const time = parseEventTimeText(timeText)
        || (opts.defaultTimeIfMissing ? DEFAULT_WHEN_DATE_ONLY : null);
    if (!time) return null;

    return new Date(
        Date.UTC(dmy.year, dmy.month - 1, dmy.day, time.hour, time.minute)
    ).toISOString();
};

/**
 * Normalizes mobile create-event payloads:
 * - Accepts `starts` / `startDateText` (dd/MM/yyyy) when `start_date` ISO is empty
 * - Combines date with `event_time`
 * - Date-only alias fields default to 09:00 when time omitted
 */
export const normalizeEventCreateInput = (raw = {}) => {
    const out = { ...raw };

    const timeText = firstNonBlank(
        out.event_time,
        out.time,
        out.start_time,
        out.startTime
    );

    const startFromAlias = firstNonBlank(
        out.starts,
        out.start,
        out.startDate,
        out.start_date_text,
        out.startDateText
    );

    let startRaw = firstNonBlank(out.start_date);
    let startUsedAlias = false;

    if (!startRaw && startFromAlias) {
        startRaw = startFromAlias;
        startUsedAlias = true;
    }

    if (startRaw && !startRaw.includes('T') && parseDayMonthYear(startRaw)) {
        const built = buildEventDateTimeIso(startRaw, timeText, {
            defaultTimeIfMissing: startUsedAlias || Boolean(startFromAlias)
        });
        if (built) out.start_date = built;
    } else if (startRaw) {
        const built = buildEventDateTimeIso(startRaw, timeText, {
            defaultTimeIfMissing: false
        });
        if (built) out.start_date = built;
        else if (!isBlank(startRaw) && startRaw.includes('T')) {
            const parsed = Date.parse(startRaw);
            if (!Number.isNaN(parsed)) out.start_date = new Date(parsed).toISOString();
        }
    }

    if (isBlank(out.start_date)) out.start_date = null;

    const endFromAlias = firstNonBlank(
        out.ends,
        out.end,
        out.endDate,
        out.end_date_text,
        out.endDateText
    );

    let endRaw = firstNonBlank(out.end_date);
    let endUsedAlias = false;
    if (!endRaw && endFromAlias) {
        endRaw = endFromAlias;
        endUsedAlias = true;
    }

    if (endRaw && !endRaw.includes('T') && parseDayMonthYear(endRaw)) {
        const built = buildEventDateTimeIso(endRaw, timeText, {
            defaultTimeIfMissing: endUsedAlias || Boolean(endFromAlias)
        });
        if (built) out.end_date = built;
    } else if (endRaw) {
        const built = buildEventDateTimeIso(endRaw, timeText, {
            defaultTimeIfMissing: endUsedAlias
        });
        if (built) out.end_date = built;
    }

    if (isBlank(out.end_date)) out.end_date = null;

    if (timeText && !out.event_time) out.event_time = timeText;

    return out;
};

export const eventTimeText = (raw = {}) =>
    firstNonBlank(raw.event_time, raw.time, raw.start_time, raw.startTime);

export const hasStartDateHint = (raw = {}) =>
    Boolean(
        firstNonBlank(
            raw.starts,
            raw.start,
            raw.startDate,
            raw.start_date_text,
            raw.startDateText,
            raw.start_date
        )
    );
