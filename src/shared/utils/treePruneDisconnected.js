/**
 * After a person is removed from a family tree, drop branches that no longer
 * reach the main tree. Nodes that still have another path stay.
 */

export const relationEndpoints = (relation) => {
    const a = relation?.person_id_1 || relation?.person_id;
    const b = relation?.person_id_2 || relation?.related_person_id;
    if (!a || !b) return null;
    return [String(a), String(b)];
};

const addUndirected = (graph, a, b) => {
    if (!a || !b || a === b) return;
    if (!graph.has(a)) graph.set(a, new Set());
    if (!graph.has(b)) graph.set(b, new Set());
    graph.get(a).add(b);
    graph.get(b).add(a);
};

export const buildUndirectedGraph = (personIds, relations, skipPersonId = null) => {
    const remaining = personIds.map(String).filter((id) => id && id !== String(skipPersonId || ''));
    const remainingSet = new Set(remaining);
    const graph = new Map(remaining.map((id) => [id, new Set()]));
    for (const relation of relations || []) {
        const ends = relationEndpoints(relation);
        if (!ends) continue;
        const [a, b] = ends;
        if (a === String(skipPersonId || '') || b === String(skipPersonId || '')) continue;
        if (!remainingSet.has(a) || !remainingSet.has(b)) continue;
        addUndirected(graph, a, b);
    }
    return { remaining, graph };
};

const reachableFrom = (graph, seeds) => {
    const visited = new Set();
    const queue = [...seeds].filter((id) => graph.has(id));
    while (queue.length) {
        const id = queue.pop();
        if (visited.has(id)) continue;
        visited.add(id);
        for (const next of graph.get(id) || []) {
            if (!visited.has(next)) queue.push(next);
        }
    }
    return visited;
};

const largestComponentSeeds = (graph, remaining) => {
    const seen = new Set();
    let best = [];
    for (const start of remaining) {
        if (seen.has(start)) continue;
        const component = reachableFrom(graph, [start]);
        component.forEach((id) => seen.add(id));
        if (component.size > best.length) best = [...component];
    }
    return best;
};

/**
 * @returns {string[]} person ids that should be removed because they no longer
 * connect to the main family tree after `removedPersonId` is gone.
 */
export const collectDisconnectedPersonIds = ({
    personIds = [],
    relations = [],
    removedPersonId,
    anchorPersonIds = []
} = {}) => {
    const removed = String(removedPersonId || '');
    if (!removed) return [];
    const { remaining, graph } = buildUndirectedGraph(personIds, relations, removed);
    const anchors = [...new Set((anchorPersonIds || []).map(String).filter((id) => id && id !== removed && graph.has(id)))];
    const seeds = anchors.length ? anchors : largestComponentSeeds(graph, remaining);
    if (!seeds.length) return remaining;
    const kept = reachableFrom(graph, seeds);
    return remaining.filter((id) => !kept.has(id));
};
