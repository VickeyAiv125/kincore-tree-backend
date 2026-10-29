const LABELS = {
    family_space_id: 'Family space',
    start_date: 'Start Date',
    end_date: 'End Date',
    title: 'Event name',
    event_time: 'Event time',
    location: 'Location',
    draw_date: 'Draw Date & Time',
    gift_deadline: 'Gift Exchange / Delivery Date',
    join_deadline: 'Join-by Deadline',
    rsvp_deadline: 'Join-by Deadline',
    gift_theme: 'Gift Theme',
    budget: 'Budget',
    description: 'Description'
};

/** Turn API/snake_case keys into short labels for error messages shown in the app. */
export const userFacingFieldLabel = (fieldKey) => {
    const key = String(fieldKey || '').trim();
    if (!key) return 'This field';
    if (LABELS[key]) return LABELS[key];
    return key
        .split('_')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ');
};

export const requiredFieldMessage = (fieldKey) =>
    `${userFacingFieldLabel(fieldKey)} is required`;
