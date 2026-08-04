import { supabase } from '../../config/supabaseClient.js';
import { uploadFile, BUCKETS } from '../../config/storageClient.js';

export const getPendingListings = async (req, res) => {
    try {
        const { id } = req.params; // family_space_id

        const { data, error } = await supabase
            .from('marketplace_listings')
            .select('*, seller:users!marketplace_listings_seller_id_fkey(first_name, last_name, avatar_url, email)')
            .eq('family_space_id', id)
            // Fetch everything except deleted or fully globally rejected (optional: you might want to show rejected)
            .neq('status', 'deleted')
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const approveListing = async (req, res) => {
    try {
        const { id, listingId } = req.params;
        const { user } = req;

        // Family admin approves -> fully approves at both levels
        const { data, error } = await supabase
            .from('marketplace_listings')
            .update({ 
                family_moderation_status: 'approved', 
                moderation_status: 'approved',
                status: 'active',
                updated_at: new Date() 
            })
            .eq('id', listingId)
            .eq('family_space_id', id)
            .select()
            .single();

        if (error) throw error;

        await supabase.from('audit_logs').insert({
            actor_id: user.id,
            action: 'MARKETPLACE_LISTING_FAMILY_APPROVED',
            target_type: 'marketplace_listings',
            target_id: listingId,
            details: { family_space_id: id }
        });

        res.json({ message: 'Listing approved by family admin, waiting for platform approval.', listing: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const rejectListing = async (req, res) => {
    try {
        const { id, listingId } = req.params;
        const { user } = req;

        // Family admin rejects -> both statuses become rejected
        const { data, error } = await supabase
            .from('marketplace_listings')
            .update({ 
                family_moderation_status: 'rejected',
                moderation_status: 'rejected', 
                status: 'rejected', 
                updated_at: new Date() 
            })
            .eq('id', listingId)
            .eq('family_space_id', id)
            .select()
            .single();

        if (error) throw error;

        await supabase.from('audit_logs').insert({
            actor_id: user.id,
            action: 'MARKETPLACE_LISTING_FAMILY_REJECTED',
            target_type: 'marketplace_listings',
            target_id: listingId,
            details: { family_space_id: id }
        });

        res.json({ message: 'Listing rejected by family admin', listing: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// --- New CRUD endpoints for Family Admin ---

export const createListing = async (req, res) => {
    try {
        const { id } = req.params; // family_space_id
        const { title, price, category, condition, location, description, is_negotiable } = req.body;
        const { user } = req;

        if (!title || !price || !category || !condition) {
            return res.status(400).json({ error: 'title, price, category, and condition are required' });
        }

        let image_urls = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const ext = file.originalname.split('.').pop().toLowerCase();
                const path = `marketplace/${user.id}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
                const url = await uploadFile(BUCKETS.MEDIA, path, file.buffer, file.mimetype);
                image_urls.push(url);
            }
        }

        const { data, error } = await supabase
            .from('marketplace_listings')
            .insert({
                seller_id: user.id,
                family_space_id: id,
                title,
                price: parseFloat(price),
                category,
                condition,
                location,
                description,
                is_negotiable: is_negotiable === 'true' || is_negotiable === true,
                image_urls,
                status: 'pending',
                family_moderation_status: 'approved', // Pre-approved by family admin
                moderation_status: 'pending',         // Needs platform approval
            })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json({ message: "Listing created and waiting for platform approval.", data });
    } catch (err) {
        console.error('>>> [MARKETPLACE ADMIN ERROR]', err);
        res.status(500).json({ error: err.message });
    }
};

export const updateListing = async (req, res) => {
    try {
        const { id, listingId } = req.params;
        const updates = req.body;
        const { user } = req;

        let image_urls = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const ext = file.originalname.split('.').pop().toLowerCase();
                const path = `marketplace/${user.id}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
                const url = await uploadFile(BUCKETS.MEDIA, path, file.buffer, file.mimetype);
                image_urls.push(url);
            }
        }

        const updateData = {
            ...updates,
            family_moderation_status: 'approved',
            moderation_status: 'pending',
            updated_at: new Date().toISOString()
        };

        if (image_urls.length > 0) {
            updateData.image_urls = image_urls; // Currently overwrites, could append based on logic
        }

        const { data, error } = await supabase
            .from('marketplace_listings')
            .update(updateData)
            .eq('id', listingId)
            .eq('family_space_id', id)
            .select();

        if (error) throw error;
        if (!data || data.length === 0) {
            return res.status(404).json({ error: "Listing not found or you don't have permission to update it." });
        }
        res.json({ message: "Listing updated and requires platform review.", data: data[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const deleteListing = async (req, res) => {
    try {
        const { id, listingId } = req.params;

        const { error } = await supabase
            .from('marketplace_listings')
            .update({ status: 'deleted', updated_at: new Date().toISOString() })
            .eq('id', listingId)
            .eq('family_space_id', id);

        if (error) throw error;
        res.json({ message: 'Listing deleted successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
