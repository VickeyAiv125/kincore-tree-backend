/**
 * Family Admin Help & Support knowledge content.
 * Stored in platform_settings.key = 'support_knowledge' (CMS-style override).
 */

const DEFAULT_SUPPORT_KNOWLEDGE = {
    contact: {
        email: 'support@kincore.com',
        phone: '+1 (800) 555-0199',
        hours: 'Mon–Fri, 9:00–18:00 IST',
        response_sla: 'We typically respond within 1 business day.'
    },
    faqs: [
        {
            id: 'invite-members',
            question: 'How do I invite members to the family tree?',
            answer:
                'As a Family Admin, invite members from the Lineage Registry. Click “Add Member”, enter their details, and send an invite email or share an invite link. Depending on Governance settings, invitees may join directly or require approval.'
        },
        {
            id: 'admin-roles',
            question: 'What is the difference between Family Admin and Branch Admin?',
            answer:
                'A Family Admin can manage the whole family space (members, governance, settings, and all branches). A Branch Admin is limited to their assigned lineage branch and cannot change global family settings or ownership.'
        },
        {
            id: 'moderation',
            question: 'How do I manage reported content?',
            answer:
                'Reported photos, comments, or posts appear under Content Moderation. Review each report and take action: dismiss, remove content, warn the member, or suspend access depending on your policies.'
        },
        {
            id: 'lineage-branches',
            question: 'Can I restrict who can create new lineage branches?',
            answer:
                'Yes. In Governance & Roles, configure whether all members can add lineage or whether Admin approval is required. You can also control merge/transfer options that restructure the tree.'
        },
        {
            id: 'media-visibility',
            question: 'How do I change the default visibility for new media?',
            answer:
                'Go to Settings → Registration & Privacy and set Default Visibility for new uploads to Family Only, Branch Only, or Public.'
        },
        {
            id: 'support-ticket',
            question: 'How do I track a support ticket I submitted?',
            answer:
                'Open Help & Support → My Tickets. You can view status, read platform replies, attach context, and continue the conversation in the ticket thread.'
        }
    ],
    admin_guide: {
        title: 'Family Admin Guide',
        subtitle: 'Operational playbook for running your family space',
        sections: [
            {
                id: 'getting-started',
                title: '1. Getting started',
                body:
                    'Confirm your family space, branding, and default privacy settings first. Assign Co-Admins / Branch Admins only after roles and approvals are clear. Keep an Owner available for ownership-sensitive actions.'
            },
            {
                id: 'members',
                title: '2. Members & invitations',
                body:
                    'Use Lineage Registry to add people, invite claimants, and approve join requests. Prefer invite links for bulk onboarding. Review pending claims regularly so the tree stays accurate.'
            },
            {
                id: 'governance',
                title: '3. Governance & roles',
                body:
                    'Configure who can edit lineage, merge branches, and moderate content. Family Admin delegations (set by Owner) control which admin panels Editors and Branch Admins can reach.'
            },
            {
                id: 'content',
                title: '4. Content & moderation',
                body:
                    'Media and posts inherit default visibility from Settings. Use moderation queues for reports. Prefer remove-and-notify over silent deletes so members understand policy.'
            },
            {
                id: 'billing-support',
                title: '5. Billing & platform support',
                body:
                    'Subscription and storage limits appear under Settings / Subscription. For platform issues, open a Support Ticket from Help & Support and include screenshots when possible.'
            },
            {
                id: 'notifications',
                title: '6. Notification policies',
                body:
                    'Use Policies to choose which family events send email or in-app alerts, and which roles receive them. Test a policy before relying on it for critical workflows.'
            }
        ]
    },
    video_tutorials: [
        {
            id: 'overview',
            title: 'Family space overview',
            description: 'Navigate dashboard, members, and key admin panels.',
            youtube_id: 'ScMzIvxBSi4',
            duration: '3 min'
        },
        {
            id: 'invites',
            title: 'Inviting & onboarding members',
            description: 'Add members, send invites, and approve join requests.',
            youtube_id: 'aqz-KE-bpKQ',
            duration: '4 min'
        },
        {
            id: 'roles',
            title: 'Roles & branch admins',
            description: 'Assign roles safely and understand ownership vs admin.',
            youtube_id: 'EngW7tLk6R8',
            duration: '5 min'
        },
        {
            id: 'coming-soon-mall',
            title: 'K-Mall & KCC (coming soon)',
            description: 'Guided walkthrough of family marketplace flows. Video publishing soon.',
            youtube_id: null,
            coming_soon: true,
            duration: '—'
        }
    ]
};

export const getDefaultSupportKnowledge = () =>
    JSON.parse(JSON.stringify(DEFAULT_SUPPORT_KNOWLEDGE));

export const mergeSupportKnowledge = (stored = {}) => {
    const defaults = getDefaultSupportKnowledge();
    return {
        contact: { ...defaults.contact, ...(stored.contact || {}) },
        faqs: Array.isArray(stored.faqs) && stored.faqs.length ? stored.faqs : defaults.faqs,
        admin_guide: {
            ...defaults.admin_guide,
            ...(stored.admin_guide || {}),
            sections:
                Array.isArray(stored.admin_guide?.sections) && stored.admin_guide.sections.length
                    ? stored.admin_guide.sections
                    : defaults.admin_guide.sections
        },
        video_tutorials:
            Array.isArray(stored.video_tutorials) && stored.video_tutorials.length
                ? stored.video_tutorials
                : defaults.video_tutorials
    };
};
