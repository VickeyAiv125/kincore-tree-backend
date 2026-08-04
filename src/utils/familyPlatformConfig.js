/**
 * Family-space platform configuration (Owner System → Platform Configuration).
 * Family-scoped only — never platform-global.
 */

export const TIMEZONE_OPTIONS = [
    { value: 'UTC', label: 'UTC +0:00' },
    { value: 'Europe/London', label: 'London, UTC +0:00 / +1:00' },
    { value: 'America/New_York', label: 'New York, UTC -5:00 / -4:00' },
    { value: 'America/Los_Angeles', label: 'Los Angeles, UTC -8:00 / -7:00' },
    { value: 'Asia/Kolkata', label: 'India, UTC +5:30' },
    { value: 'Asia/Dubai', label: 'Dubai, UTC +4:00' },
    { value: 'Asia/Singapore', label: 'Singapore, UTC +8:00' },
    { value: 'Australia/Sydney', label: 'Sydney, UTC +10:00 / +11:00' }
];

export const LANGUAGE_OPTIONS = [
    { value: 'en-GB', label: 'English (UK)' },
    { value: 'en-US', label: 'English (US)' },
    { value: 'hi-IN', label: 'Hindi' },
    { value: 'ar-AE', label: 'Arabic' },
    { value: 'fr-FR', label: 'French' },
    { value: 'es-ES', label: 'Spanish' }
];

export const AUDIT_LEVELS = [
    { value: 'basic', label: 'Basic' },
    { value: 'standard', label: 'Standard' },
    { value: 'forensic', label: 'Forensic Level' }
];

/** Soft member seat limits by subscription tier (UI gauge only when plan table unavailable). */
export const TIER_MEMBER_LIMITS = {
    free: 50,
    standard: 100,
    premium: 500,
    enterprise: 2000
};

export const DEFAULT_FAMILY_PLATFORM_CONFIG = {
    timezone: 'Europe/London',
    language: 'en-GB',
    push_notifications: true,
    audit_logging: 'forensic'
};

const timezoneValues = new Set(TIMEZONE_OPTIONS.map((o) => o.value));
const languageValues = new Set(LANGUAGE_OPTIONS.map((o) => o.value));
const auditValues = new Set(AUDIT_LEVELS.map((o) => o.value));

export const parseFamilyPlatformConfig = (settings = {}) => {
    const s = settings && typeof settings === 'object' ? settings : {};
    const p = s.platform && typeof s.platform === 'object' ? s.platform : {};

    const timezone = timezoneValues.has(p.timezone)
        ? p.timezone
        : (timezoneValues.has(s.timezone) ? s.timezone : DEFAULT_FAMILY_PLATFORM_CONFIG.timezone);

    const language = languageValues.has(p.language)
        ? p.language
        : (languageValues.has(s.language) ? s.language : DEFAULT_FAMILY_PLATFORM_CONFIG.language);

    const audit_logging = auditValues.has(p.audit_logging)
        ? p.audit_logging
        : (auditValues.has(s.audit_logging) ? s.audit_logging : DEFAULT_FAMILY_PLATFORM_CONFIG.audit_logging);

    const pushRaw = p.push_notifications ?? s.push_notifications ?? s.notifications?.push;
    const push_notifications =
        pushRaw !== undefined ? !!pushRaw : DEFAULT_FAMILY_PLATFORM_CONFIG.push_notifications;

    return { timezone, language, push_notifications, audit_logging };
};

export const labelForTimezone = (value) =>
    TIMEZONE_OPTIONS.find((o) => o.value === value)?.label || value;

export const labelForLanguage = (value) =>
    LANGUAGE_OPTIONS.find((o) => o.value === value)?.label || value;

export const labelForAudit = (value) =>
    AUDIT_LEVELS.find((o) => o.value === value)?.label || value;

/**
 * Merge platform config patch into family_spaces.settings without wiping other keys.
 */
export const mergePlatformConfigIntoSettings = (existingSettings = {}, patch = {}) => {
    const base = existingSettings && typeof existingSettings === 'object' ? { ...existingSettings } : {};
    const current = parseFamilyPlatformConfig(base);
    const next = { ...current };

    if (patch.timezone !== undefined) {
        if (!timezoneValues.has(patch.timezone)) {
            throw new Error('Invalid timezone');
        }
        next.timezone = patch.timezone;
    }
    if (patch.language !== undefined) {
        if (!languageValues.has(patch.language)) {
            throw new Error('Invalid language');
        }
        next.language = patch.language;
    }
    if (patch.audit_logging !== undefined) {
        if (!auditValues.has(patch.audit_logging)) {
            throw new Error('Invalid audit logging level');
        }
        next.audit_logging = patch.audit_logging;
    }
    if (patch.push_notifications !== undefined) {
        next.push_notifications = !!patch.push_notifications;
    }

    base.platform = next;
    return base;
};

export const memberLimitForTier = (tier) => {
    const key = String(tier || 'free').toLowerCase();
    return TIER_MEMBER_LIMITS[key] || TIER_MEMBER_LIMITS.free;
};
