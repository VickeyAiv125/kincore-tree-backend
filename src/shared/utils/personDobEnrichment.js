import { supabase } from '../../config/supabaseClient.js';
import { parseDobValue } from './parentChildDob.js';

const hasDob = (person) =>
    Boolean(parseDobValue(person?.date_of_birth || person?.birth_date));

/**
 * Use account profile DOB when the tree person row is empty (common for claimed nodes).
 */
export const enrichPersonWithAccountDob = async (person) => {
    if (!person) return person;
    if (hasDob(person)) return person;

    let accountDob = null;

    const userId = person.claimed_by || person.user_id || null;
    if (userId) {
        const { data: user, error } = await supabase
            .from('users')
            .select('date_of_birth')
            .eq('id', userId)
            .maybeSingle();
        if (error) console.warn('[enrichPersonWithAccountDob]', error.message);
        accountDob = user?.date_of_birth || null;
    }

    if (!accountDob && person.id) {
        const { data: linkedUser, error } = await supabase
            .from('users')
            .select('date_of_birth')
            .eq('person_id', person.id)
            .maybeSingle();
        if (error) console.warn('[enrichPersonWithAccountDob person_id]', error.message);
        accountDob = linkedUser?.date_of_birth || null;
    }

    if (!accountDob) return person;

    return {
        ...person,
        date_of_birth: person.date_of_birth || accountDob,
        birth_date: person.birth_date || accountDob
    };
};

/** Batch-fill DOB on person objects already in memory (tree list / search). */
export const fillPersonsDobFromUsers = async (persons = []) => {
    if (!Array.isArray(persons) || persons.length === 0) return persons;

    const needUserIds = [...new Set(
        persons
            .filter((p) => !hasDob(p))
            .map((p) => p.claimed_by || p.user_id)
            .filter(Boolean)
    )];
    const needPersonIds = persons.filter((p) => !hasDob(p)).map((p) => p.id).filter(Boolean);

    const dobByUser = new Map();
    const dobByPersonId = new Map();

    if (needUserIds.length > 0) {
        const { data: users, error } = await supabase
            .from('users')
            .select('id, date_of_birth, person_id')
            .in('id', needUserIds);
        if (error) console.warn('[fillPersonsDobFromUsers]', error.message);
        (users || []).forEach((u) => {
            if (u.date_of_birth) dobByUser.set(u.id, u.date_of_birth);
        });
    }

    if (needPersonIds.length > 0) {
        const { data: byPerson, error } = await supabase
            .from('users')
            .select('person_id, date_of_birth')
            .in('person_id', needPersonIds);
        if (error) console.warn('[fillPersonsDobFromUsers person_id]', error.message);
        (byPerson || []).forEach((u) => {
            if (u.person_id && u.date_of_birth) dobByPersonId.set(u.person_id, u.date_of_birth);
        });
    }

    persons.forEach((p) => {
        if (hasDob(p)) return;
        const uid = p.claimed_by || p.user_id;
        const dob = (uid && dobByUser.get(uid)) || dobByPersonId.get(p.id) || null;
        if (!dob) return;
        if (!p.date_of_birth) p.date_of_birth = dob;
        if (!p.birth_date) p.birth_date = dob;
    });

    return persons;
};
