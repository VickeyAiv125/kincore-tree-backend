import { supabase } from '../../config/supabaseClient.js';

/**
 * Get all members of a family space for the App
 * Supports filtering by "families" (blood/marriage) and "people" (friends/neighbors)
 */
export const getAppMembers = async (req, res) => {
    try {
        const { family_space_id, filter } = req.query;

        if (!family_space_id) {
            return res.status(400).json({ error: 'family_space_id is required' });
        }

        // Fetch all persons in the given family space
        const { data: persons, error: pError } = await supabase
            .from('persons')
            .select('id, full_name, first_name, last_name, avatar_url, role, birth_date, death_date')
            .eq('family_space_id', family_space_id);

        if (pError) throw pError;

        if (!persons || persons.length === 0) {
            return res.json([]);
        }

        const personIds = persons.map(p => p.id);
        
        // Fetch relations for these persons to determine connection tags
        const { data: relations, error: rError } = await supabase
            .from('person_relations')
            .select('person_id_1, person_id_2, relation_type')
            .or(`person_id_1.in.(${personIds.join(',')}),person_id_2.in.(${personIds.join(',')})`);

        if (rError) throw rError;

        // Process persons and categorize them
        const enrichedPersons = persons.map(person => {
            let relationTag = person.role || 'Member'; 
            let isPeople = false;

            // Check role first
            if (person.role && (person.role.toLowerCase() === 'friend' || person.role.toLowerCase() === 'neighbor')) {
                isPeople = true;
                relationTag = person.role;
            }

            // Check explicit relations
            const personRels = relations.filter(r => r.person_id_1 === person.id || r.person_id_2 === person.id);
            for (let rel of personRels) {
                if (rel.relation_type) {
                    const type = rel.relation_type.toLowerCase();
                    if (type === 'friend' || type === 'neighbor') {
                        isPeople = true;
                        relationTag = rel.relation_type;
                        break;
                    } else if (relationTag.toLowerCase() === 'member') {
                        // Use the relation as the tag if the person just has a generic 'member' role
                        relationTag = rel.relation_type;
                    }
                }
            }

            // Format years string "YYYY - Present"
            let years = 'Unknown';
            if (person.birth_date) {
                const birthYear = person.birth_date.split('-')[0];
                const deathYear = person.death_date ? person.death_date.split('-')[0] : 'Present';
                years = `${birthYear} - ${deathYear}`;
            }

            return {
                id: person.id,
                full_name: person.full_name || `${person.first_name || ''} ${person.last_name || ''}`.trim(),
                avatar_url: person.avatar_url,
                relation_tag: relationTag.charAt(0).toUpperCase() + relationTag.slice(1),
                years: years,
                is_family: !isPeople
            };
        });

        // Apply filter if provided
        let filteredPersons = enrichedPersons;
        if (filter === 'families') {
            filteredPersons = enrichedPersons.filter(p => p.is_family);
        } else if (filter === 'people') {
            filteredPersons = enrichedPersons.filter(p => !p.is_family);
        }

        res.json(filteredPersons);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
