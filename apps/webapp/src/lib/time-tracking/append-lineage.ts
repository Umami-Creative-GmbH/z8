/**
 * Read-only append-lineage classification for one employee's time entries (#262).
 *
 * Append lineage records which entry a new entry followed when written. It is
 * resolved only from stored predecessor evidence: an explicit predecessor ID whose
 * row hash agrees with the stored `previousHash`, or, when the ID is missing, the
 * unique same-scope row carrying that hash. Event time, creation time, UUID order,
 * work-period pairing and correction supersession are never evidence, so input
 * order does not change the result. Retained inactive entries participate.
 */
import { verifyHash } from "./blockchain";

export interface AppendEvidenceEntry {
	id: string;
	organizationId: string;
	employeeId: string;
	type: string;
	timestamp: Date;
	hash: string;
	previousHash: string | null;
	previousEntryId: string | null;
}

export interface AppendScope {
	organizationId: string;
	employeeId: string;
}

export type AppendLineageIssue =
	| { kind: "foreign_entry"; entryId: string }
	| { kind: "unverified_hash"; entryId: string }
	| { kind: "nonstandard_genesis"; entryId: string }
	| { kind: "self_reference"; entryId: string }
	| { kind: "predecessor_outside_scope"; entryId: string; previousEntryId: string }
	| { kind: "predecessor_hash_missing"; entryId: string; previousEntryId: string }
	| { kind: "predecessor_hash_mismatch"; entryId: string; previousEntryId: string }
	| { kind: "missing_predecessor"; entryId: string }
	| { kind: "ambiguous_predecessor"; entryId: string; candidateIds: string[] }
	| { kind: "fork"; predecessorId: string; successorIds: string[] }
	| { kind: "multiple_roots"; rootIds: string[] }
	| { kind: "cycle"; entryIds: string[] };

export type AppendLineage =
	| { kind: "empty" }
	| {
			kind: "lineage";
			tip: { id: string; hash: string };
			entryCount: number;
			/** Hash-only links resolved read-only from unique agreeing evidence. */
			derivedLinks: number;
	  }
	| { kind: "review_required"; issues: AppendLineageIssue[] };

const byId = (left: { id: string }, right: { id: string }) =>
	left.id < right.id ? -1 : left.id > right.id ? 1 : 0;

export function classifyAppendLineage(
	scope: AppendScope,
	evidence: readonly AppendEvidenceEntry[],
): AppendLineage {
	if (evidence.length === 0) return { kind: "empty" };

	// Sorting only makes reported issues stable; it never chooses an edge.
	const entries = evidence.toSorted(byId);
	const issues: AppendLineageIssue[] = [];
	const rowsById = new Map(entries.map((entry) => [entry.id, entry]));
	const rowsByHash = new Map<string, AppendEvidenceEntry[]>();
	for (const entry of entries) {
		rowsByHash.set(entry.hash, [...(rowsByHash.get(entry.hash) ?? []), entry]);
	}

	const predecessorOf = new Map<string, string>();
	const roots: string[] = [];
	let derivedLinks = 0;

	for (const entry of entries) {
		if (entry.organizationId !== scope.organizationId || entry.employeeId !== scope.employeeId) {
			issues.push({ kind: "foreign_entry", entryId: entry.id });
			continue;
		}
		if (!verifyHash(entry).isValid) {
			issues.push({ kind: "unverified_hash", entryId: entry.id });
		}

		if (entry.previousEntryId !== null) {
			const previousEntryId = entry.previousEntryId;
			const predecessor = rowsById.get(previousEntryId);
			if (previousEntryId === entry.id) {
				issues.push({ kind: "self_reference", entryId: entry.id });
			} else if (
				!predecessor ||
				predecessor.organizationId !== scope.organizationId ||
				predecessor.employeeId !== scope.employeeId
			) {
				issues.push({ kind: "predecessor_outside_scope", entryId: entry.id, previousEntryId });
			} else if (entry.previousHash === null) {
				issues.push({ kind: "predecessor_hash_missing", entryId: entry.id, previousEntryId });
			} else if (predecessor.hash !== entry.previousHash) {
				// A dangling or contradictory ID is never replaced by a different hash match.
				issues.push({ kind: "predecessor_hash_mismatch", entryId: entry.id, previousEntryId });
			} else {
				predecessorOf.set(entry.id, predecessor.id);
			}
			continue;
		}

		if (entry.previousHash === null) {
			roots.push(entry.id);
			continue;
		}
		if (entry.previousHash === "" || entry.previousHash === "genesis") {
			// Hash input normalization must not redefine the recorded graph meaning.
			issues.push({ kind: "nonstandard_genesis", entryId: entry.id });
			continue;
		}
		const candidates = (rowsByHash.get(entry.previousHash) ?? []).filter(
			(candidate) => candidate.id !== entry.id,
		);
		if (candidates.length === 0) {
			issues.push({ kind: "missing_predecessor", entryId: entry.id });
		} else if (candidates.length > 1) {
			issues.push({
				kind: "ambiguous_predecessor",
				entryId: entry.id,
				candidateIds: candidates.map((candidate) => candidate.id),
			});
		} else {
			predecessorOf.set(entry.id, candidates[0].id);
			derivedLinks += 1;
		}
	}

	const successorsOf = new Map<string, string[]>();
	for (const [successorId, predecessorId] of predecessorOf) {
		successorsOf.set(predecessorId, [...(successorsOf.get(predecessorId) ?? []), successorId]);
	}
	for (const [predecessorId, successorIds] of successorsOf) {
		if (successorIds.length > 1) {
			issues.push({ kind: "fork", predecessorId, successorIds: successorIds.toSorted() });
		}
	}
	if (roots.length > 1) issues.push({ kind: "multiple_roots", rootIds: roots });
	issues.push(...findCycles(entries, predecessorOf));

	if (issues.length === 0) {
		// One root, no forks, no cycles and every other entry linked: the entries
		// form a single path, whose end is the only tip.
		const visited: string[] = [];
		let current: string | undefined = roots[0];
		while (current !== undefined) {
			visited.push(current);
			current = successorsOf.get(current)?.[0];
		}
		const tip = rowsById.get(visited[visited.length - 1] ?? "");
		if (tip && visited.length === entries.length) {
			return {
				kind: "lineage",
				tip: { id: tip.id, hash: tip.hash },
				entryCount: entries.length,
				derivedLinks,
			};
		}
		throw new Error("Append lineage classification is inconsistent");
	}

	return { kind: "review_required", issues };
}

/** Each entry has at most one resolved predecessor, so cycles are found by walking back. */
function findCycles(
	entries: readonly AppendEvidenceEntry[],
	predecessorOf: ReadonlyMap<string, string>,
): AppendLineageIssue[] {
	const settled = new Set<string>();
	const cycles: AppendLineageIssue[] = [];
	for (const entry of entries) {
		const path: string[] = [];
		const onPath = new Set<string>();
		let current: string | undefined = entry.id;
		while (current !== undefined && !settled.has(current) && !onPath.has(current)) {
			path.push(current);
			onPath.add(current);
			current = predecessorOf.get(current);
		}
		if (current !== undefined && onPath.has(current)) {
			cycles.push({ kind: "cycle", entryIds: path.slice(path.indexOf(current)).toSorted() });
		}
		for (const id of path) settled.add(id);
	}
	return cycles;
}
