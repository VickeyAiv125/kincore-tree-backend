import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideFacebookAction } from './facebookAuthService.js';

describe('Issue 7 Facebook → KCC behaviour', () => {
    it('logs in directly when Facebook is already linked to a KCC ID', () => {
        const decision = decideFacebookAction({
            linkedUser: { id: 'u1', email: 'linked@kcc.test' },
            profileEmail: 'other@fb.test',
            existingUserByEmail: { id: 'u2' }
        });
        assert.equal(decision.action, 'login');
        assert.equal(decision.email, 'linked@kcc.test');
        assert.equal(decision.userId, 'u1');
    });

    it('asks to sign in and confirm linking when email matches an unlinked KCC ID', () => {
        const decision = decideFacebookAction({
            linkedUser: null,
            profileEmail: 'existing@kcc.test',
            existingUserByEmail: { id: 'u9' }
        });
        assert.equal(decision.action, 'confirm_link');
        assert.equal(decision.email, 'existing@kcc.test');
        assert.equal(decision.userId, 'u9');
    });

    it('continues registration when no matching KCC ID exists', () => {
        const decision = decideFacebookAction({
            linkedUser: null,
            profileEmail: 'new@kcc.test',
            existingUserByEmail: null
        });
        assert.equal(decision.action, 'register');
        assert.equal(decision.email, 'new@kcc.test');
    });

    it('asks for email when Facebook does not provide one', () => {
        const decision = decideFacebookAction({
            linkedUser: null,
            profileEmail: '',
            existingUserByEmail: null
        });
        assert.equal(decision.action, 'need_email');
    });
});
