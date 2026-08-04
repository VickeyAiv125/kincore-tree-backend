import { DEMO } from '../lib/ids.js';
import { upsert } from '../lib/upsert.js';
import { log, sb, warn } from '../lib/supabase.js';

/**
 * Claims, abuse, disputes, governance, council, sensitive changes, merge requests.
 */
export async function seedGovernance(byEmail) {
    log('--- governance / council / safety ---');
    const owner = byEmail['owner@admin.com'];
    const council = byEmail['council@admin.com'];
    const member1 = byEmail['member1@demo.kincore'];
    const member2 = byEmail['member2@demo.kincore'];
    const auditor = byEmail['auditor@admin.com'];
    const P = DEMO.persons;

    await upsert('claims', [
        {
            id: DEMO.claim1,
            user_id: member1.id,
            person_id: P.pending,
            family_space_id: DEMO.spaceId,
            status: 'pending',
            type: 'identity',
            details: 'Demo pending claim for Council / Family Admin review.',
            requested_by_name: 'Aisha Chen',
            confidence_score: 72,
            claimed_at: new Date().toISOString()
        },
        {
            id: DEMO.claim2,
            user_id: member2.id,
            person_id: P.uncle,
            family_space_id: DEMO.spaceId,
            status: 'approved',
            type: 'lineage',
            details: 'Demo approved claim.',
            requested_by_name: 'Ravi Chen',
            confidence_score: 91,
            claimed_at: new Date(Date.now() - 7 * 86400000).toISOString()
        }
    ], { onConflict: 'id' });

    await upsert('abuse_reports', [
        {
            id: DEMO.abuse1,
            reporter_id: member1.id,
            reported_user_id: member2.id,
            target_type: 'post',
            target_id: DEMO.post3,
            reason: 'spam',
            report_type: 'content',
            status: 'open',
            priority_level: 'medium',
            details: 'Demo abuse report for Auditor / Trust & Safety.',
            assigned_to: auditor.id,
            sla_status: 'within_sla'
        },
        {
            id: DEMO.abuse2,
            reporter_id: owner.id,
            reported_user_id: member2.id,
            target_type: 'user',
            target_id: member2.id,
            reason: 'harassment',
            report_type: 'user',
            status: 'investigating',
            priority_level: 'high',
            details: 'Demo high-priority report.',
            assigned_to: auditor.id,
            sla_status: 'at_risk'
        }
    ], { onConflict: 'id' });

    await upsert('disputes', {
        id: DEMO.dispute1,
        family_space_id: DEMO.spaceId,
        person_id: P.uncle,
        person_name: 'James Chen',
        claimed_by_1: member1.id,
        claimed_by_2: member2.id,
        reason_1: 'I am the direct child (demo).',
        reason_2: 'Lineage documents support my claim (demo).',
        status: 'open',
        resolved_notes: null
    }, { onConflict: 'id' });

    await upsert('governance_cases', {
        id: DEMO.govCase1,
        family_space_id: DEMO.spaceId,
        title: 'Adopt branch invite policy (Demo)',
        description: 'Should North Branch allow open invites? Demo governance vote.',
        proposed_by: owner.id,
        status: 'open',
        stage: 'voting',
        votes_for: 2,
        votes_against: 1,
        threshold: 60,
        ends_at: new Date(Date.now() + 5 * 86400000).toISOString()
    }, { onConflict: 'id' });

    await upsert('voting_configurations', {
        id: DEMO.voteCfg1,
        family_space_id: DEMO.spaceId,
        majority_rule: 'simple',
        threshold_percentage: 60,
        min_quorum: 3
    }, { onConflict: 'id' });

    await upsert('council_family_assignments', {
        id: DEMO.councilAssign1,
        council_user_id: council.id,
        family_space_id: DEMO.spaceId,
        status: 'active',
        assigned_at: new Date().toISOString()
    }, { onConflict: 'id' });

    await upsert('sensitive_changes', {
        id: DEMO.sensitive1,
        family_space_id: DEMO.spaceId,
        requested_by: member1.id,
        change_type: 'birth_date',
        details: { person_id: P.child1, old: '1995-07-08', new: '1995-07-09', demo: true },
        status: 'pending'
    }, { onConflict: 'id' });

    // Trigger on this table references updated_at which may be missing — insert-only if absent
    const { data: existingMerge } = await sb.from('family_merge_requests').select('id').eq('id', DEMO.merge1).maybeSingle();
    if (!existingMerge) {
        const { error: mergeErr } = await sb.from('family_merge_requests').insert({
            id: DEMO.merge1,
            source_space_id: DEMO.spaceRiskId,
            source_space_name: 'Risk Review Space (Demo)',
            target_space_id: DEMO.spaceId,
            target_space_name: 'Chen Family Clan (Demo)',
            requested_by: owner.id,
            status: 'pending'
        });
        if (mergeErr) warn('insert family_merge_requests failed:', mergeErr.message);
        else log('✓ family_merge_requests (1)');
    } else {
        log('✓ family_merge_requests (exists)');
    }

    await upsert('audit_logs', [
        {
            id: DEMO.audit1,
            actor_id: owner.id,
            action: 'DEMO_SEED_FAMILY_CREATED',
            target_type: 'family_space',
            target_id: DEMO.spaceId,
            details: { tag: DEMO.tag },
            ip_address: '127.0.0.1'
        },
        {
            id: DEMO.audit2,
            actor_id: council.id,
            action: 'CLAIM_REVIEWED',
            target_type: 'claim',
            target_id: DEMO.claim2,
            details: { status: 'approved', demo: true },
            ip_address: '127.0.0.1'
        }
    ], { onConflict: 'id' });
}
