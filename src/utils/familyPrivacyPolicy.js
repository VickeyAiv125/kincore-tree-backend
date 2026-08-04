/**
 * Family-space privacy policy (Owner Privacy + shared settings keys).
 * Family-scoped only — never platform-global.
 */

export const DEFAULT_FAMILY_PRIVACY = {
    globalProfileVisibility: false,
    dnaDataAccess: false,
    externalSearchIndexing: false,
    branchLeaderVisibility: 'Limited', // Full | Limited
    memberVisibility: 'Limited', // Full | Limited
    // Shared with Council Privacy Vault (merged, not overwritten)
    lineageVisibility: true,
    autoApproveCousins: false,
    sensitiveDataRedaction: true,
    postMortemAccess: true
};

export const PRIVACY_SETTING_KEYS = Object.keys(DEFAULT_FAMILY_PRIVACY);

export const parseFamilyPrivacy = (settings = {}, spaceVisibility = null) => {
    const s = settings && typeof settings === 'object' ? settings : {};
    const listed =
        spaceVisibility === 'Listed on marketplace'
        || spaceVisibility === 'public'
        || spaceVisibility === 'Public';

    return {
        globalProfileVisibility:
            s.globalProfileVisibility !== undefined ? !!s.globalProfileVisibility : listed,
        dnaDataAccess: s.dnaDataAccess !== undefined ? !!s.dnaDataAccess : DEFAULT_FAMILY_PRIVACY.dnaDataAccess,
        externalSearchIndexing:
            s.externalSearchIndexing !== undefined ? !!s.externalSearchIndexing : listed,
        branchLeaderVisibility:
            s.branchLeaderVisibility === 'Full' ? 'Full' : 'Limited',
        memberVisibility:
            s.memberVisibility === 'Full' ? 'Full' : 'Limited',
        lineageVisibility:
            s.lineageVisibility !== undefined ? !!s.lineageVisibility : DEFAULT_FAMILY_PRIVACY.lineageVisibility,
        autoApproveCousins:
            s.autoApproveCousins !== undefined ? !!s.autoApproveCousins : DEFAULT_FAMILY_PRIVACY.autoApproveCousins,
        sensitiveDataRedaction:
            s.sensitiveDataRedaction !== undefined ? !!s.sensitiveDataRedaction : DEFAULT_FAMILY_PRIVACY.sensitiveDataRedaction,
        postMortemAccess:
            s.postMortemAccess !== undefined ? !!s.postMortemAccess : DEFAULT_FAMILY_PRIVACY.postMortemAccess
    };
};

/**
 * Merge privacy patch into existing family_spaces.settings without wiping other keys
 * (adminDelegations, notifications, etc.).
 */
export const mergePrivacyIntoSettings = (existingSettings = {}, privacyPatch = {}) => {
    const base = existingSettings && typeof existingSettings === 'object' ? { ...existingSettings } : {};
    for (const key of PRIVACY_SETTING_KEYS) {
        if (Object.prototype.hasOwnProperty.call(privacyPatch, key) && privacyPatch[key] !== undefined) {
            base[key] = privacyPatch[key];
        }
    }
    return base;
};

/** Map indexing/visibility toggles → family_spaces.visibility column */
export const resolveSpaceVisibility = (privacy) => {
    if (privacy.globalProfileVisibility || privacy.externalSearchIndexing) {
        return 'Listed on marketplace';
    }
    return 'Private (internal only)';
};

/** Whether this family may appear in external / find-yourself search */
export const familyAllowsExternalSearch = (privacy) =>
    Boolean(privacy?.externalSearchIndexing || privacy?.globalProfileVisibility);

/**
 * Viewer data-visibility tier based on membership role + owner privacy settings.
 * Full: see birth/location/status fields (unless person-level hides)
 * Limited: redact sensitive fields
 */
export const getViewerVisibilityTier = (viewerRole, privacy) => {
    const role = String(viewerRole || 'member').toLowerCase().replace(/_/g, '-');
    if (['owner', 'family-admin', 'admin', 'co-admin'].includes(role)) return 'Full';
    if (['branch-admin', 'manager'].includes(role)) {
        return privacy.branchLeaderVisibility === 'Full' ? 'Full' : 'Limited';
    }
    if (['editor', 'council', 'council-admin'].includes(role)) {
        return privacy.memberVisibility === 'Full' ? 'Full' : 'Limited';
    }
    return privacy.memberVisibility === 'Full' ? 'Full' : 'Limited';
};

/**
 * Redact person / user profile fields for Limited viewers or person-level hide flags.
 */
export const redactPersonForViewer = (person, { tier = 'Limited', privacy = DEFAULT_FAMILY_PRIVACY } = {}) => {
    if (!person) return person;
    const out = { ...person };
    const forceRedact = tier === 'Limited' || privacy.sensitiveDataRedaction;

    const hideBirth = out.hide_birth_date || out.hideBirthDate || (forceRedact && tier === 'Limited');
    const hideLoc = out.hide_location || out.hideLocation || (forceRedact && tier === 'Limited');
    const hideLiving = out.hide_living_status || out.hideLivingStatus || (forceRedact && tier === 'Limited');

    if (hideBirth) {
        out.birth_date = null;
        out.date_of_birth = null;
        out.birth_year_only = true;
        out._redacted = [...(out._redacted || []), 'birth_date'];
    }
    if (hideLoc) {
        out.birth_place = null;
        out.place_of_birth = null;
        out.death_place = null;
        out.location = null;
        out.latitude = null;
        out.longitude = null;
        out._redacted = [...(out._redacted || []), 'location'];
    }
    if (hideLiving) {
        out.is_alive = null;
        out.death_date = null;
        out._redacted = [...(out._redacted || []), 'living_status'];
    }

    // DNA payloads never leave the API unless owner enabled dnaDataAccess
    if (!privacy.dnaDataAccess) {
        delete out.dna_profile;
        delete out.dna_data;
        delete out.dna_markers;
        if (out.metadata && typeof out.metadata === 'object') {
            const meta = { ...out.metadata };
            delete meta.dna;
            delete meta.dna_data;
            out.metadata = meta;
        }
    }

    if (!privacy.postMortemAccess && out.is_alive === false) {
        out.bio = null;
        out.bio_notes = null;
        out._redacted = [...(out._redacted || []), 'post_mortem'];
    }

    return out;
};
