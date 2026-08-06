import { supabase } from '../../config/supabaseClient.js';
import { uploadFile, BUCKETS } from '../../config/storageClient.js';

/**
 * List marketplace listings with search, category, and condition filters.
 * GET /api/marketplace?search=&category=&condition=&family_space_id=
 */
export const getListings = async (req, res) => {
    try {
        const { search, category, condition, family_space_id } = req.query;
        const userId = req.user?.id;

        let query = supabase
            .from('marketplace_listings')
            .select('*, seller:users!marketplace_listings_seller_id_fkey(first_name, last_name, avatar_url)')
            .neq('status', 'deleted')
            .order('created_at', { ascending: false });

        if (userId) {
            query = query.or(
                `and(status.eq.active,moderation_status.eq.approved),seller_id.eq.${userId}`
            );
        } else {
            query = query.eq('status', 'active').eq('moderation_status', 'approved');
        }

        // If family context, filter by family space
        if (family_space_id) {
            query = query.eq('family_space_id', family_space_id);
        }

        if (category && category !== 'All') {
            query = query.eq('category', category);
        }

        if (condition) {
            query = query.eq('condition', condition);
        }

        if (search) {
            query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
        }

        const { data, error } = await query;
        if (error) throw error;

        // Format for app consumption
        const formatted = data.map(listing => ({
            id: listing.id,
            title: listing.title,
            price: listing.price,
            is_negotiable: listing.is_negotiable,
            category: listing.category,
            condition: listing.condition,
            location: listing.location,
            description: listing.description,
            image: listing.image_urls?.[0] || '',           // Primary image for grid view
            image_urls: listing.image_urls || [],           // All images for detail view
            seller_id: listing.seller_id,
            seller_name: listing.seller ? `${listing.seller.first_name} ${listing.seller.last_name}` : 'Unknown',
            seller_avatar: listing.seller?.avatar_url || '',
            status: listing.status,
            moderation_status: listing.moderation_status,
            created_at: listing.created_at,
        }));

        res.json(formatted);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get a single marketplace listing by ID.
 * GET /api/marketplace/:id
 */
export const getListing = async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from('marketplace_listings')
            .select('*, seller:users!marketplace_listings_seller_id_fkey(first_name, last_name, avatar_url)')
            .eq('id', id)
            .single();

        if (error) throw error;

        res.json({
            id: data.id,
            title: data.title,
            price: data.price,
            is_negotiable: data.is_negotiable,
            category: data.category,
            condition: data.condition,
            location: data.location,
            description: data.description,
            image: data.image_urls?.[0] || '',
            image_urls: data.image_urls || [],
            seller_id: data.seller_id,
            seller_name: data.seller ? `${data.seller.first_name} ${data.seller.last_name}` : 'Unknown',
            seller_avatar: data.seller?.avatar_url || '',
            status: data.status,
            created_at: data.created_at,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Create a new marketplace listing.
 * POST /api/marketplace  (multipart/form-data, images[] file upload)
 */
export const createListing = async (req, res) => {
    try {
        const { title, price, category, condition, location, description, is_negotiable, family_space_id } = req.body;
        const { user } = req;

        if (!title || !price || !category || !condition) {
            return res.status(400).json({ error: 'title, price, category, and condition are required' });
        }

        // Upload all images
        let image_urls = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const ext = file.originalname.split('.').pop().toLowerCase();
                const path = `marketplace/${user.id}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
                const url = await uploadFile(BUCKETS.MEDIA, path, file.buffer, file.mimetype);
                image_urls.push(url);
            }
        }

        // Family listings wait for family-admin approval.
        // Listings with no family never reach that queue, so publish them immediately.
        const needsFamilyApproval = Boolean(family_space_id);
        const initialStatus = needsFamilyApproval ? 'pending' : 'active';
        const initialModeration = needsFamilyApproval ? 'pending' : 'approved';

        const { data, error } = await supabase
            .from('marketplace_listings')
            .insert({
                seller_id: user.id,
                family_space_id: family_space_id || null,
                title,
                price: parseFloat(price),
                category,
                condition,
                location,
                description,
                is_negotiable: is_negotiable === 'true' || is_negotiable === true,
                image_urls,
                status: initialStatus,
                moderation_status: initialModeration,
            })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json({
            message: needsFamilyApproval
                ? 'request sent to admin'
                : 'Listing published',
            data
        });
    } catch (err) {
        console.error('>>> [MARKETPLACE ERROR]', err);
        
        if (err.message?.includes('row-level security policy')) {
            return res.status(403).json({ 
                error: 'Row-level security policy violation.',
                details: 'The database rejected this insert. This usually means RLS is enabled on "marketplace_listings" but no policy allows this operation, or the service role key is missing/restricted.',
                suggestion: 'Please run the "migration_marketplace_fix.sql" script to set up correct RLS policies.'
            });
        }
        
        res.status(500).json({ error: err.message });
    }
};

/**
 * Update an existing listing. Only the seller can update.
 * PATCH /api/marketplace/:id
 */
export const updateListing = async (req, res) => {
    try {
        const { id } = req.params;
        const { user } = req;
        const updates = req.body;

        // Ensure only seller can update
        const { data: existing, error: fetchErr } = await supabase
            .from('marketplace_listings')
            .select('seller_id')
            .eq('id', id)
            .single();

        if (fetchErr) throw fetchErr;
        if (existing.seller_id !== user.id) {
            return res.status(403).json({ error: 'Only the seller can update this listing.' });
        }

        const { data, error } = await supabase
            .from('marketplace_listings')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Delete a listing (soft-delete by setting status = 'deleted').
 * DELETE /api/marketplace/:id
 */
export const deleteListing = async (req, res) => {
    try {
        const { id } = req.params;
        const { user } = req;

        const { data: existing, error: fetchErr } = await supabase
            .from('marketplace_listings')
            .select('seller_id')
            .eq('id', id)
            .single();

        if (fetchErr) throw fetchErr;
        if (existing.seller_id !== user.id) {
            return res.status(403).json({ error: 'Only the seller can delete this listing.' });
        }

        const { error } = await supabase
            .from('marketplace_listings')
            .update({ status: 'deleted' })
            .eq('id', id);

        if (error) throw error;
        res.json({ message: 'Listing deleted successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get all listings by the logged-in user (My Listings).
 * GET /api/marketplace/my-listings
 */
export const getMyListings = async (req, res) => {
    try {
        const { user } = req;

        const { data, error } = await supabase
            .from('marketplace_listings')
            .select('*')
            .eq('seller_id', user.id)
            .neq('status', 'deleted')
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Mark a listing as sold.
 * PATCH /api/marketplace/:id/mark-sold
 */
export const markSold = async (req, res) => {
    try {
        const { id } = req.params;
        const { user } = req;

        const { data: existing } = await supabase.from('marketplace_listings').select('seller_id').eq('id', id).single();
        if (existing.seller_id !== user.id) return res.status(403).json({ error: 'Unauthorized' });

        const { data, error } = await supabase
            .from('marketplace_listings')
            .update({ status: 'sold' })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        res.json({ message: 'Listing marked as sold.', listing: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get Seller Dashboard Data (Overview, Products, Order History)
 * GET /api/marketplace/seller/dashboard
 */
export const getSellerDashboard = async (req, res) => {
    try {
        const { user } = req;

        // Fetch all listings by the seller (excluding deleted)
        const { data: listings, error } = await supabase
            .from('marketplace_listings')
            .select('*')
            .eq('seller_id', user.id)
            .neq('status', 'deleted')
            .order('created_at', { ascending: false });

        if (error) throw error;

        let activeProducts = [];
        let soldOrders = [];
        let totalRevenue = 0;

        listings.forEach(listing => {
            if (listing.status === 'sold') {
                soldOrders.push(listing);
                totalRevenue += (listing.price || 0);
            } else {
                activeProducts.push(listing);
            }
        });

        const totalOrders = soldOrders.length;
        const averageOrderValue = totalOrders > 0 ? (totalRevenue / totalOrders).toFixed(2) : 0;

        res.json({
            overview: {
                total_revenue: totalRevenue,
                total_orders: totalOrders,
                average_order_value: parseFloat(averageOrderValue)
            },
            products: activeProducts,
            orders: soldOrders
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
