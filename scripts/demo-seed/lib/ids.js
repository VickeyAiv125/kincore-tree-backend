/**
 * Fixed demo UUIDs — stable across re-runs for upserts.
 */
export const DEMO = {
    password: 'Demo@Kincore1',
    tag: 'kincore-demo',

    spaceId: 'a1000000-0000-4000-8000-000000000001',
    spaceRiskId: 'a1000000-0000-4000-8000-000000000010',
    treeId: 'a1000000-0000-4000-8000-000000000002',
    branchNorthId: '6b8eb992-571f-4637-b031-a56007560cad', // hardcoded for branch@admin.com
    branchSouthId: 'a1000000-0000-4000-8000-000000000003',

    persons: {
        grandpa: 'a2000000-0000-4000-8000-000000000001',
        grandma: 'a2000000-0000-4000-8000-000000000002',
        father: 'a2000000-0000-4000-8000-000000000003',
        mother: 'a2000000-0000-4000-8000-000000000004',
        uncle: 'a2000000-0000-4000-8000-000000000005',
        aunt: 'a2000000-0000-4000-8000-000000000006',
        child1: 'a2000000-0000-4000-8000-000000000007',
        child2: 'a2000000-0000-4000-8000-000000000008',
        cousin: 'a2000000-0000-4000-8000-000000000009',
        pending: 'a2000000-0000-4000-8000-000000000010'
    },

    post1: 'a3000000-0000-4000-8000-000000000001',
    post2: 'a3000000-0000-4000-8000-000000000002',
    post3: 'a3000000-0000-4000-8000-000000000003',
    album1: 'a3000000-0000-4000-8000-000000000010',
    media1: 'a3000000-0000-4000-8000-000000000011',
    story1: 'a3000000-0000-4000-8000-000000000020',
    event1: 'a3000000-0000-4000-8000-000000000030',
    event2: 'a3000000-0000-4000-8000-000000000031',
    chatRoom1: 'a3000000-0000-4000-8000-000000000040',

    listing1: 'a4000000-0000-4000-8000-000000000001',
    listing2: 'a4000000-0000-4000-8000-000000000002',
    listing3: 'a4000000-0000-4000-8000-000000000003',
    order1: 'a4000000-0000-4000-8000-000000000010',
    order2: 'a4000000-0000-4000-8000-000000000011',
    kcc1: 'a4000000-0000-4000-8000-000000000020',
    kcc2: 'a4000000-0000-4000-8000-000000000021',
    kcc3: 'a4000000-0000-4000-8000-000000000022',
    campaign1: 'a4000000-0000-4000-8000-000000000030',
    feeId: 'a4000000-0000-4000-8000-000000000040',
    subPlanStd: 'a4000000-0000-4000-8000-000000000050',
    subPlanPrem: 'a4000000-0000-4000-8000-000000000051',
    platformSub1: 'a4000000-0000-4000-8000-000000000060',

    claim1: 'a5000000-0000-4000-8000-000000000001',
    claim2: 'a5000000-0000-4000-8000-000000000002',
    abuse1: 'a5000000-0000-4000-8000-000000000010',
    abuse2: 'a5000000-0000-4000-8000-000000000011',
    dispute1: 'a5000000-0000-4000-8000-000000000020',
    govCase1: 'a5000000-0000-4000-8000-000000000030',
    sensitive1: 'a5000000-0000-4000-8000-000000000040',
    merge1: 'a5000000-0000-4000-8000-000000000050',
    migration1: 'a5000000-0000-4000-8000-000000000060',
    voteCfg1: 'a5000000-0000-4000-8000-000000000070',
    councilAssign1: 'a5000000-0000-4000-8000-000000000080',

    ticket1: 'a6000000-0000-4000-8000-000000000001',
    ticketMsg1: 'a6000000-0000-4000-8000-000000000002',
    incident1: 'a6000000-0000-4000-8000-000000000010',
    announcement1: 'a6000000-0000-4000-8000-000000000020',
    notif1: 'a6000000-0000-4000-8000-000000000030',
    notif2: 'a6000000-0000-4000-8000-000000000031',
    audit1: 'a6000000-0000-4000-8000-000000000040',
    audit2: 'a6000000-0000-4000-8000-000000000041',
    history1: 'a6000000-0000-4000-8000-000000000050',
    worker1: 'a6000000-0000-4000-8000-000000000060',
    log1: 'a6000000-0000-4000-8000-000000000070'
};

/** Platform + family demo accounts (existing DEFAULT_ADMINS + members). */
export const DEMO_USERS = [
    { email: 'family@admin.com', password: DEMO.password, first_name: 'Family', last_name: 'Super', platform_role: 'superadmin', family_role: 'owner' },
    { email: 'owner@admin.com', password: DEMO.password, first_name: 'Owner', last_name: 'Admin', platform_role: 'owner', family_role: 'owner' },
    { email: 'council@admin.com', password: DEMO.password, first_name: 'Council', last_name: 'Admin', platform_role: 'council', family_role: 'editor' },
    { email: 'branch@admin.com', password: DEMO.password, first_name: 'Branch', last_name: 'Admin', platform_role: 'branch-admin', family_role: 'branch-admin', branch_id: DEMO.branchNorthId },
    { email: 'business@admin.com', password: DEMO.password, first_name: 'Business', last_name: 'Admin', platform_role: 'business', family_role: null },
    { email: 'devops@admin.com', password: DEMO.password, first_name: 'DevOps', last_name: 'Admin', platform_role: 'devops', family_role: null },
    { email: 'auditor@admin.com', password: DEMO.password, first_name: 'Auditor', last_name: 'Admin', platform_role: 'auditor', family_role: null },
    { email: 'member1@demo.kincore', password: DEMO.password, first_name: 'Aisha', last_name: 'Chen', platform_role: null, family_role: 'member', branch_id: DEMO.branchNorthId },
    { email: 'member2@demo.kincore', password: DEMO.password, first_name: 'Ravi', last_name: 'Chen', platform_role: null, family_role: 'member', branch_id: DEMO.branchSouthId },
    { email: 'seller@demo.kincore', password: DEMO.password, first_name: 'Maya', last_name: 'Seller', platform_role: null, family_role: 'member', branch_id: DEMO.branchNorthId },
    { email: 'coadmin@demo.kincore', password: DEMO.password, first_name: 'Leo', last_name: 'CoAdmin', platform_role: null, family_role: 'family-admin', branch_id: null }
];
