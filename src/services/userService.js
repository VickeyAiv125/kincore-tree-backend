import { supabase } from '../config/supabaseClient.js';

export const UserService = {
    async getMe(userId) {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', userId)
            .single();

        if (error) throw error;
        return data;
    },

    async updateMe(userId, updates) {
        const allowedFields = [
            'first_name',
            'last_name',
            'avatar_url',
            'language',
            'theme',
            'date_of_birth',
            'bio',
            'place_of_birth',
            'gender',
            'hide_birth_date',
            'hide_location',
            'hide_living_status',
            'protect_as_minor',
            'occupation',
            'designation',
            'company_name',
            'website',
            'linkedin',
            'instagram',
            'facebook',
            'other_link'
        ];

        const updatePayload = {
            updated_at: new Date().toISOString()
        };

        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                updatePayload[field] = updates[field];
            }
        }

        const { data, error } = await supabase
            .from('users')
            .update(updatePayload)
            .eq('id', userId)
            .select()
            .single();

        if (error) throw error;
        return data;
    }
};
