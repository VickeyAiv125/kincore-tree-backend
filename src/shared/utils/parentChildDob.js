const parseDobValue = (raw) => {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s || s.toLowerCase() === 'unknown' || s.toLowerCase() === 'null') return null;
    const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) {
        const d = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3], 12));
        return Number.isNaN(d.getTime()) ? null : d;
    }
    const yearOnly = s.match(/^(\d{4})$/);
    if (yearOnly) {
        const d = new Date(Date.UTC(+yearOnly[1], 0, 1, 12));
        return Number.isNaN(d.getTime()) ? null : d;
    }
    const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slash) {
        const d = new Date(Date.UTC(+slash[3], +slash[1] - 1, +slash[2], 12));
        return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
};

const personLabel = (person) => {
    const named = [person?.first_name, person?.last_name].filter(Boolean).join(' ').trim();
    return named || person?.full_name || 'This person';
};

/**
 * Parent must be born strictly before the target person.
 * Child must be born strictly after the target person.
 * A missing target date of birth is a hard stop: the comparison cannot be skipped.
 */
const assertParentChildDob = ({ role, newDobRaw, targetPerson }) => {
    const newDob = parseDobValue(newDobRaw);
    const targetDob = parseDobValue(targetPerson?.date_of_birth || targetPerson?.birth_date);
    const who = role === 'parent' ? 'Parent' : 'Child';
    const name = personLabel(targetPerson);

    if (!newDob) {
        const err = new Error(`${who} date of birth is required.`);
        err.status = 400;
        throw err;
    }

    const today = new Date();
    const endOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 23, 59, 59);
    if (newDob.getTime() > endOfToday) {
        const err = new Error('Date of birth cannot be in the future.');
        err.status = 400;
        throw err;
    }

    if (!targetDob) {
        const err = new Error(
            role === 'parent'
                ? `${name} has no date of birth. Add it before adding a parent. A parent must be born before ${name}.`
                : `${name} has no date of birth. Add it before adding a child. A child must be born after ${name}.`
        );
        err.status = 400;
        throw err;
    }
    if (role === 'parent' && newDob.getTime() >= targetDob.getTime()) {
        const err = new Error(`Parent date of birth must be earlier than ${name}'s date of birth.`);
        err.status = 400;
        throw err;
    }
    if (role === 'child' && newDob.getTime() <= targetDob.getTime()) {
        const err = new Error(`Child date of birth must be later than ${name}'s date of birth.`);
        err.status = 400;
        throw err;
    }
};

export { parseDobValue, assertParentChildDob };
