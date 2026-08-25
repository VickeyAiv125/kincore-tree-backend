/**
 * Post Settings helpers — visibility + who can comment.
 * Aligns with Flutter Post Settings UI (public / friends / friends_except / specific_friends
 * and followers / friends / chosen_friends).
 */

export const POST_VISIBILITY = [
    'public',
    'friends',
    'friends_except',
    'specific_friends',
    'family',
    'branch'
];

export const COMMENT_PERMISSIONS = ['followers', 'friends', 'chosen_friends'];

const VISIBILITY_ALIASES = {
    Public: 'public',
    public: 'public',
    Friends: 'friends',
    friends: 'friends',
    family: 'family',
    Family: 'family',
    branch: 'branch',
    me: 'friends_except',
    friends_except: 'friends_except',
    friendsExcept: 'friends_except',
    sf: 'specific_friends',
    specific_friends: 'specific_friends',
    specificFriends: 'specific_friends'
};

const COMMENT_ALIASES = {
    followers: 'followers',
    Followers: 'followers',
    followers_only: 'followers',
    Friends: 'friends',
    friends: 'friends',
    'Chosen Friends': 'chosen_friends',
    chosen_friends: 'chosen_friends',
    chosenFriends: 'chosen_friends'
};

const asIdArray = (value) => {
    if (value == null || value === '') return [];
    let raw = value;
    if (typeof raw === 'string') {
        try {
            raw = JSON.parse(raw);
        } catch {
            raw = raw.split(',').map((s) => s.trim()).filter(Boolean);
        }
    }
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.map((id) => String(id)).filter(Boolean))];
};

export const normalizeVisibility = (value, fallback = 'family') => {
    if (value == null || value === '') return fallback;
    const key = String(value).trim();
    const mapped = VISIBILITY_ALIASES[key] || key.toLowerCase();
    return POST_VISIBILITY.includes(mapped) ? mapped : null;
};

export const normalizeCommentPermission = (value, fallback = 'friends') => {
    if (value == null || value === '') return fallback;
    const key = String(value).trim();
    const mapped = COMMENT_ALIASES[key] || key.toLowerCase();
    return COMMENT_PERMISSIONS.includes(mapped) ? mapped : null;
};

export const parsePostSettingsBody = (body = {}) => {
    const visibility = normalizeVisibility(
        body.visibility ?? body.who_can_see,
        undefined
    );
    const comment_permission = normalizeCommentPermission(
        body.comment_permission ?? body.who_can_comment ?? body.commentPrivacy,
        undefined
    );

    const errors = [];
    if (body.visibility != null || body.who_can_see != null) {
        if (!visibility) errors.push('Invalid visibility option');
    }
    if (
        body.comment_permission != null
        || body.who_can_comment != null
        || body.commentPrivacy != null
    ) {
        if (!comment_permission) errors.push('Invalid comment_permission option');
    }

    return {
        errors,
        visibility,
        comment_permission,
        visibility_except_ids: asIdArray(
            body.visibility_except_ids ?? body.friends_except_ids ?? body.except_user_ids
        ),
        visibility_allowed_ids: asIdArray(
            body.visibility_allowed_ids ?? body.specific_friends_ids ?? body.allowed_user_ids
        ),
        comment_allowed_ids: asIdArray(
            body.comment_allowed_ids ?? body.chosen_friends_ids
        )
    };
};

export const settingsFromPost = (post) => ({
    post_id: post.id,
    visibility: post.visibility || 'family',
    comment_permission: post.comment_permission || 'friends',
    visibility_except_ids: post.visibility_except_ids || [],
    visibility_allowed_ids: post.visibility_allowed_ids || [],
    comment_allowed_ids: post.comment_allowed_ids || [],
    options: {
        visibility: ['public', 'friends', 'friends_except', 'specific_friends'],
        comment_permission: COMMENT_PERMISSIONS
    }
});

export const canUserSeePost = (post, userId) => {
    const visibility = post.visibility || 'family';
    const uid = String(userId);
    if (String(post.user_id) === uid) return true;

    if (visibility === 'public' || visibility === 'family' || visibility === 'friends' || visibility === 'branch') {
        return true;
    }
    if (visibility === 'friends_except') {
        const except = (post.visibility_except_ids || []).map(String);
        return !except.includes(uid);
    }
    if (visibility === 'specific_friends') {
        const allowed = (post.visibility_allowed_ids || []).map(String);
        return allowed.includes(uid);
    }
    return true;
};

export const canUserCommentOnPost = (post, userId) => {
    const uid = String(userId);
    if (String(post.user_id) === uid) return true;

    const permission = post.comment_permission || 'friends';
    if (permission === 'followers' || permission === 'friends') return true;
    if (permission === 'chosen_friends') {
        const allowed = (post.comment_allowed_ids || []).map(String);
        return allowed.includes(uid);
    }
    return false;
};
