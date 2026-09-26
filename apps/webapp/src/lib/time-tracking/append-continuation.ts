/**
 * Authorized append continuation proposals (#262 §4, #323).
 *
 * When an employee's history cannot be admitted automatically (forks, islands,
 * holes, unknown hash formats), an operator may propose continuing future appends
 * from one exact existing entry: the anchor. The proposal is inspectable evidence:
 * the anchor's identity and hash, every competing tip, the lineage components and
 * issues, the limitations the continuation accepts, and the expected history state
 * that makes a proposal stale when anything changes.
 *
 * A continuation records a forward choice, not a historical fact. It never rehashes,
 * rechains or erases rows, invents a genesis, or marks earlier history verified.
 * Missing, foreign or ambiguous anchors and anchors that already have a successor
 * cannot be waived. Nothing here writes.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json";
import {
	type AppendEvidenceEntry,
	type AppendHashStatus,
	type AppendLineageIssue,
	type AppendLinkResolution,
	type AppendScope,
	classifyAppendLinkGraph,
	predecessorIdOf,
	resolveAppendLinks,
} from "./append-lineage";

export const APPEND_CONTINUATION_PROPOSAL_VERSION = 1;

/** Order-independent identity of every stored field an append-history check reads. */
export function appendHistoryDigest(entries: readonly AppendEvidenceEntry[]): string {
	const rows = entries
		.map((entry) => ({
			id: entry.id,
			organizationId: entry.organizationId,
			employeeId: entry.employeeId,
			type: entry.type,
			timestamp: entry.timestamp.toISOString(),
			hash: entry.hash,
			previousHash: entry.previousHash,
			previousEntryId: entry.previousEntryId,
		}))
		.toSorted((left, right) => compareStrings(left.id, right.id));
	return digest(canonicalJson(rows));
}

/** Refusals no approval can waive. */
export type AppendContinuationRefusal =
	/** The employee already has an append position; continuation never resets one. */
	| "position_exists"
	/** Automatic admission already accepts this history. */
	| "history_admissible"
	/** No entry of this organization and employee has the anchor ID. */
	| "anchor_not_found"
	| "anchor_hash_missing"
	/** The reviewed anchor hash is not the stored one. */
	| "anchor_hash_mismatch"
	/** Another entry in scope carries the anchor's hash. */
	| "anchor_identity_ambiguous"
	/** Continuing would fork the anchor. */
	| "anchor_has_successor"
	/** Open work ends with a clock-out that must follow its own clock-in. */
	| "active_work"
	/** A pending correction's entries would be finalized around the new anchor. */
	| "correction_pending";

export interface AppendContinuationCandidate {
	entryId: string;
	hash: string;
	type: string;
	/** ISO instant of the stored event time; shown, never used to choose. */
	timestamp: string;
	hashStatus: AppendHashStatus;
	link: AppendLinkResolution["kind"];
}

export interface AppendLineageComponent {
	rootIds: string[];
	tipIds: string[];
	entryCount: number;
}

export type AppendContinuationLimitation =
	/** History before the anchor keeps its issues and is not verified. */
	| { code: "pre_anchor_history_unverified" }
	| { code: "anchor_hash_not_reproduced" }
	| { code: "anchor_hash_input_unavailable" };

export interface AppendContinuationProposal {
	version: typeof APPEND_CONTINUATION_PROPOSAL_VERSION;
	scope: AppendScope;
	anchor: AppendContinuationCandidate;
	/** Every entry nothing follows: the competing heads, the anchor among them. */
	candidates: AppendContinuationCandidate[];
	components: AppendLineageComponent[];
	issues: (AppendLineageIssue | { kind: "history_without_entries" })[];
	limitations: AppendContinuationLimitation[];
	/** Checks the anchor passed; the operator's reason says why it is the right one. */
	suitability: ("in_scope" | "hash_matches" | "unique_hash" | "no_successor" | "no_pending_work")[];
	guarantee: {
		scope: "post_anchor";
		anchorEntryId: string;
		historyBeforeAnchor: "unverified_disclosed";
	};
	consequences: {
		appends: "fresh_appends_follow_anchor";
		audit: "post_anchor_assurance_scope";
		replay: "committed_replay_unchanged";
		payroll: "payroll_readiness_unchanged";
		history: "no_rows_rewritten";
	};
	/** The state application re-reads; any difference makes the proposal stale. */
	expected: {
		entryCount: number;
		historyDigest: string;
		hasWork: boolean;
		position: null;
	};
}

export type AppendContinuationPlan =
	| { kind: "proposal"; proposal: AppendContinuationProposal; fingerprint: string }
	| { kind: "refused"; reasons: AppendContinuationRefusal[] };

export interface AppendContinuationInput {
	scope: AppendScope;
	/** Every retained entry of the scope, inactive ones included. */
	entries: readonly AppendEvidenceEntry[];
	positionExists: boolean;
	hasWork: boolean;
	/** Operations still pending for the employee, which a new anchor would strand. */
	pending: { activeWork: boolean; pendingCorrection: boolean };
	anchor: { entryId: string; hash: string };
}

export function planAppendContinuation(input: AppendContinuationInput): AppendContinuationPlan {
	const { scope } = input;
	const inScope = input.entries.filter(
		(entry) =>
			entry.organizationId === scope.organizationId && entry.employeeId === scope.employeeId,
	);
	const graph = resolveAppendLinks(scope, inScope);
	const lineage = classifyAppendLinkGraph(graph);
	const anchor = graph.entries.find((entry) => entry.id === input.anchor.entryId);

	const reasons: AppendContinuationRefusal[] = [];
	if (input.positionExists) reasons.push("position_exists");
	const admissible = lineage.kind === "lineage" || (lineage.kind === "empty" && !input.hasWork);
	if (admissible) reasons.push("history_admissible");
	if (input.pending.activeWork) reasons.push("active_work");
	if (input.pending.pendingCorrection) reasons.push("correction_pending");
	if (!anchor) {
		reasons.push("anchor_not_found");
	} else if (anchor.hash === "") {
		reasons.push("anchor_hash_missing");
	} else {
		if (anchor.hash !== input.anchor.hash) reasons.push("anchor_hash_mismatch");
		if (graph.entries.some((entry) => entry.id !== anchor.id && entry.hash === anchor.hash)) {
			reasons.push("anchor_identity_ambiguous");
		}
		if (hasSuccessor(anchor, graph.entries)) reasons.push("anchor_has_successor");
	}
	if (reasons.length > 0 || !anchor) return { kind: "refused", reasons };

	const candidateOf = (entry: AppendEvidenceEntry): AppendContinuationCandidate => ({
		entryId: entry.id,
		hash: entry.hash,
		type: entry.type,
		timestamp: entry.timestamp.toISOString(),
		hashStatus: graph.hashes.get(entry.id) ?? "input_unavailable",
		link: graph.links.get(entry.id)?.kind ?? "unresolved",
	});
	const anchorCandidate = candidateOf(anchor);
	const limitations: AppendContinuationLimitation[] = [{ code: "pre_anchor_history_unverified" }];
	if (anchorCandidate.hashStatus === "not_reproduced") {
		limitations.push({ code: "anchor_hash_not_reproduced" });
	} else if (anchorCandidate.hashStatus === "input_unavailable") {
		limitations.push({ code: "anchor_hash_input_unavailable" });
	}

	const proposal: AppendContinuationProposal = {
		version: APPEND_CONTINUATION_PROPOSAL_VERSION,
		scope: { organizationId: scope.organizationId, employeeId: scope.employeeId },
		anchor: anchorCandidate,
		candidates: graph.entries
			.filter((entry) => !hasSuccessor(entry, graph.entries))
			.map(candidateOf),
		components: componentsOf(graph.entries, graph.links),
		issues:
			lineage.kind === "review_required"
				? lineage.issues
				: [{ kind: "history_without_entries" as const }],
		limitations,
		suitability: ["in_scope", "hash_matches", "unique_hash", "no_successor", "no_pending_work"],
		guarantee: {
			scope: "post_anchor",
			anchorEntryId: anchor.id,
			historyBeforeAnchor: "unverified_disclosed",
		},
		consequences: {
			appends: "fresh_appends_follow_anchor",
			audit: "post_anchor_assurance_scope",
			replay: "committed_replay_unchanged",
			payroll: "payroll_readiness_unchanged",
			history: "no_rows_rewritten",
		},
		expected: {
			entryCount: inScope.length,
			historyDigest: appendHistoryDigest(inScope),
			hasWork: input.hasWork,
			position: null,
		},
	};
	return { kind: "proposal", proposal, fingerprint: digest(canonicalJson(proposal)) };
}

/**
 * Whether another entry follows `entry`: by stored ID, or by its hash when no ID
 * is stored. Unresolved references count, as for the append position's tip.
 */
function hasSuccessor(entry: AppendEvidenceEntry, entries: readonly AppendEvidenceEntry[]) {
	return entries.some(
		(other) =>
			other.id !== entry.id &&
			(other.previousEntryId === entry.id ||
				(other.previousEntryId === null && other.previousHash === entry.hash)),
	);
}

/** Connected components over resolved links; unresolved links separate components. */
function componentsOf(
	entries: readonly AppendEvidenceEntry[],
	links: ReadonlyMap<string, AppendLinkResolution>,
): AppendLineageComponent[] {
	const parent = new Map(entries.map((entry) => [entry.id, entry.id]));
	const find = (id: string): string => {
		let current = id;
		while (parent.get(current) !== current) current = parent.get(current) as string;
		return current;
	};
	for (const entry of entries) {
		const link = links.get(entry.id);
		const predecessorId = link ? predecessorIdOf(link) : null;
		if (predecessorId !== null && parent.has(predecessorId)) {
			const [left, right] = [find(entry.id), find(predecessorId)].toSorted(compareStrings);
			parent.set(right, left);
		}
	}
	const members = new Map<string, AppendEvidenceEntry[]>();
	for (const entry of entries) {
		const root = find(entry.id);
		members.set(root, [...(members.get(root) ?? []), entry]);
	}
	return [...members.values()]
		.map((component) => ({
			rootIds: component
				.filter((entry) => links.get(entry.id)?.kind === "root")
				.map((entry) => entry.id),
			tipIds: component.filter((entry) => !hasSuccessor(entry, entries)).map((entry) => entry.id),
			entryCount: component.length,
		}))
		.toSorted((left, right) =>
			compareStrings(
				left.rootIds[0] ?? left.tipIds[0] ?? "",
				right.rootIds[0] ?? right.tipIds[0] ?? "",
			),
		);
}

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
