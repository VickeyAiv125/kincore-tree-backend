import { DEMO } from '../lib/ids.js';
import { upsert } from '../lib/upsert.js';
import { log } from '../lib/supabase.js';

/**
 * Posts, comments, reactions, stories, events, media, albums, chat, bookmarks, notifications.
 */
export async function seedContent(byEmail) {
    log('--- app content ---');
    const owner = byEmail['owner@admin.com'];
    const member1 = byEmail['member1@demo.kincore'];
    const member2 = byEmail['member2@demo.kincore'];
    const seller = byEmail['seller@demo.kincore'];
    const branch = byEmail['branch@admin.com'];

    await upsert('posts', [
        {
            id: DEMO.post1,
            user_id: owner.id,
            family_space_id: DEMO.spaceId,
            content: 'Welcome to the Chen Family Clan demo space! Explore the tree, events, and mall.',
            visibility: 'family',
            post_type: 'text',
            media_urls: []
        },
        {
            id: DEMO.post2,
            user_id: member1.id,
            family_space_id: DEMO.spaceId,
            content: 'Family reunion photos from last weekend — tagging cousins!',
            visibility: 'family',
            post_type: 'media',
            media_urls: ['https://placehold.co/800x600/png?text=Chen+Reunion']
        },
        {
            id: DEMO.post3,
            user_id: seller.id,
            family_space_id: DEMO.spaceId,
            content: 'New handmade crafts listed in the Family Mall (demo).',
            visibility: 'family',
            post_type: 'text',
            media_urls: []
        }
    ], { onConflict: 'id' });

    await upsert('comments', [
        { id: 'a3100000-0000-4000-8000-000000000001', post_id: DEMO.post1, user_id: member1.id, content: 'Excited to be here!' },
        { id: 'a3100000-0000-4000-8000-000000000002', post_id: DEMO.post2, user_id: member2.id, content: 'Great photos, Aisha.' }
    ], { onConflict: 'id' });

    await upsert('reactions', [
        { id: 'a3200000-0000-4000-8000-000000000001', post_id: DEMO.post1, user_id: member1.id, type: 'like' },
        { id: 'a3200000-0000-4000-8000-000000000002', post_id: DEMO.post1, user_id: member2.id, type: 'love' },
        { id: 'a3200000-0000-4000-8000-000000000003', post_id: DEMO.post2, user_id: owner.id, type: 'like' }
    ], { onConflict: 'id' });

    const expires = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
    await upsert('stories', {
        id: DEMO.story1,
        user_id: member1.id,
        family_space_id: DEMO.spaceId,
        media_url: 'https://placehold.co/400x700/png?text=Story',
        media_type: 'image',
        text_content: 'Demo story (expires in ~36h)',
        visibility: 'family',
        expires_at: expires
    }, { onConflict: 'id' });

    const start = new Date();
    start.setDate(start.getDate() + 14);
    const end = new Date(start);
    end.setHours(end.getHours() + 4);

    await upsert('events', [
        {
            id: DEMO.event1,
            family_space_id: DEMO.spaceId,
            creator_id: owner.id,
            title: 'Chen Family Reunion 2026 (Demo)',
            description: 'Annual reunion for all branches. RSVP to demo the events module.',
            start_date: start.toISOString(),
            end_date: end.toISOString(),
            location: 'Singapore Botanic Gardens',
            status: 'published',
            event_type: 'reunion',
            request_rsvp: true,
            visibility: 'family',
            max_participants: 120,
            branch_name: 'North Branch'
        },
        {
            id: DEMO.event2,
            family_space_id: DEMO.spaceId,
            creator_id: branch.id,
            title: 'North Branch Potluck (Demo)',
            description: 'Branch-level event for Branch Admin demos.',
            start_date: new Date(Date.now() + 7 * 86400000).toISOString(),
            end_date: new Date(Date.now() + 7 * 86400000 + 3 * 3600000).toISOString(),
            location: 'Community Hall',
            status: 'published',
            event_type: 'gathering',
            request_rsvp: true,
            visibility: 'branch',
            branch_name: 'North Branch'
        }
    ], { onConflict: 'id' });

    await upsert('event_rsvps', [
        { id: 'a3300000-0000-4000-8000-000000000001', event_id: DEMO.event1, user_id: member1.id, status: 'going', guest_count: 1 },
        { id: 'a3300000-0000-4000-8000-000000000002', event_id: DEMO.event1, user_id: member2.id, status: 'maybe', guest_count: 0 },
        { id: 'a3300000-0000-4000-8000-000000000003', event_id: DEMO.event1, user_id: seller.id, status: 'going', guest_count: 2 },
        { id: 'a3300000-0000-4000-8000-000000000004', event_id: DEMO.event2, user_id: member1.id, status: 'going', guest_count: 0 }
    ], { onConflict: 'id' });

    await upsert('albums', {
        id: DEMO.album1,
        family_space_id: DEMO.spaceId,
        creator_id: owner.id,
        title: 'Heritage Photos (Demo)',
        description: 'Demo media album',
        cover_url: 'https://placehold.co/600x400/png?text=Heritage'
    }, { onConflict: 'id' });

    await upsert('media', {
        id: DEMO.media1,
        user_id: owner.id,
        family_space_id: DEMO.spaceId,
        album_id: DEMO.album1,
        url: 'https://placehold.co/800x600/png?text=Archive+Photo',
        thumbnail_url: 'https://placehold.co/200x150/png?text=Thumb',
        type: 'image',
        size: 245760,
        storage_size: 245760,
        visibility: 'family',
        metadata: { demo: true, tag: DEMO.tag }
    }, { onConflict: 'id' });

    await upsert('chat_rooms', {
        id: DEMO.chatRoom1,
        family_space_id: DEMO.spaceId,
        name: 'Chen Family Chat (Demo)',
        is_group: true
    }, { onConflict: 'id' });

    await upsert('chat_messages', [
        { id: 'a3400000-0000-4000-8000-000000000001', room_id: DEMO.chatRoom1, sender_id: owner.id, content: 'Welcome to the family chat (demo).' },
        { id: 'a3400000-0000-4000-8000-000000000002', room_id: DEMO.chatRoom1, sender_id: member1.id, content: 'Hi everyone!' }
    ], { onConflict: 'id' });

    await upsert('bookmarks', {
        id: 'a3500000-0000-4000-8000-000000000001',
        user_id: member1.id,
        post_id: DEMO.post2
    }, { onConflict: 'id' });

    await upsert('notifications', [
        {
            id: DEMO.notif1,
            user_id: owner.id,
            type: 'event_rsvp',
            title: 'New RSVP',
            message: 'Aisha Chen is going to Chen Family Reunion 2026',
            notification_metadata: { event_id: DEMO.event1, demo: true }
        },
        {
            id: DEMO.notif2,
            user_id: member1.id,
            type: 'post_comment',
            title: 'New comment',
            message: 'Ravi commented on your post',
            notification_metadata: { post_id: DEMO.post2, demo: true }
        }
    ], { onConflict: 'id' });
}
