import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { collectDisconnectedPersonIds } from './treePruneDisconnected.js';

const edge = (a, b) => ({ person_id_1: a, person_id_2: b });
const edgeLegacy = (a, b) => ({ person_id: a, related_person_id: b });

describe('collectDisconnectedPersonIds', () => {
    it('A—B—C—D: removing B keeps A (main) and drops C—D', () => {
        const pruned = collectDisconnectedPersonIds({
            personIds: ['A', 'B', 'C', 'D'],
            relations: [edge('A', 'B'), edge('B', 'C'), edge('C', 'D')],
            removedPersonId: 'B',
            anchorPersonIds: ['A']
        });
        assert.deepEqual(pruned.sort(), ['C', 'D']);
    });

    it('keeps a node that still has another path to the main tree', () => {
        const pruned = collectDisconnectedPersonIds({
            personIds: ['A', 'B', 'C', 'D'],
            relations: [edge('A', 'B'), edge('B', 'C'), edge('A', 'C'), edge('C', 'D')],
            removedPersonId: 'B',
            anchorPersonIds: ['A']
        });
        assert.deepEqual(pruned, []);
    });

    it('drops a leaf that was only connected through the removed node', () => {
        const pruned = collectDisconnectedPersonIds({
            personIds: ['A', 'B', 'E'],
            relations: [edgeLegacy('A', 'B'), edgeLegacy('B', 'E')],
            removedPersonId: 'B',
            anchorPersonIds: ['A']
        });
        assert.deepEqual(pruned, ['E']);
    });

    it('prunes a claimed person if they are only connected through the removed node', () => {
        const pruned = collectDisconnectedPersonIds({
            personIds: ['owner', 'B', 'claimedLeaf'],
            relations: [edge('owner', 'B'), edge('B', 'claimedLeaf')],
            removedPersonId: 'B',
            anchorPersonIds: ['owner']
        });
        assert.deepEqual(pruned, ['claimedLeaf']);
    });

    it('uses the largest remaining component as the main tree when there is no anchor', () => {
        const pruned = collectDisconnectedPersonIds({
            personIds: ['A', 'B', 'C', 'D'],
            relations: [edge('A', 'B'), edge('B', 'C'), edge('C', 'D')],
            removedPersonId: 'B',
            anchorPersonIds: []
        });
        assert.deepEqual(pruned, ['A']);
    });
});
