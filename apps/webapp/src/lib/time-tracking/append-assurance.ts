/**
 * Read-only append assurance for one employee's time entries (#262/#324).
 *
 * Verification and audit consumers report four separate claims instead of one
 * "valid" flag:
 *
 * - hash reproducibility: a stored hash reproduces under the standard serialization;
 * - predecessor identity: each entry's predecessor resolves from its stored ID or,
 *   read-only, from a unique hash match (labeled derived);
 * - lineage: the resolved links form one lineage;
 * - continuity: entries written after the append position's admission anchor
 *   still form the uninterrupted path the position recorded.
 *
 * The assurance scope says which history those claims cover. Post-anchor
 * continuity is never reported as verified whole history, and none of the claims
 * proves row identity, original actors or captures, or payroll readiness.
 */
import type { TimeEntryAppendAdmission } from "@/db/schema/time-entry-append";
import {
	type AppendEvidenceEntry,
	type AppendHashStatus,
	type AppendLineageIssue,
	type AppendLinkResolution,
	type AppendScope,
	classifyAppendLineage,
	resolveAppendLinks,
} from "./append-lineage";

/** The stored append position, as evidence of what the collaborator admitted. */
export interface AppendPositionEvidence {
	tipEntryId: string;
	tipHash: string;
	entryCount: number;
	admission: TimeEntryAppendAdmission;
	admittedTipEntryId: string | null;
	admittedTipHash: string | null;
	admittedEntryCount: number;
	admittedAt: Date;
}

export interface AppendAssuranceInput {
	scope: AppendScope;
	entries: readonly AppendEvidenceEntry[];
	position: AppendPositionEvidence | null;
	/** Whether scoped work exists; without entries it means earlier history is missing. */
	hasWork: boolean;
}

export interface AppendEntryAssessment {
	entryId: string;
	/** Original stored fields, never rewritten by derivation. */
	stored: { hash: string; previousHash: string | null; previousEntryId: string | null };
	hash: AppendHashStatus;
	link: AppendLinkResolution;
}

export type AppendLineageAssessment =
	| { status: "empty" }
	| { status: "single"; rootId: string; tip: { id: string; hash: string } }
	| {
			status: "review_required";
			issues: (AppendLineageIssue | { kind: "history_without_entries" })[];
	  };

export interface AppendContinuityProvenance {
	admission: TimeEntryAppendAdmission;
	/** Existing tip the position was admitted from; null when admitted from empty history. */
	anchor: { id: string; hash: string } | null;
	admittedEntryCount: number;
	admittedAt: Date;
	tip: { id: string; hash: string };
	entryCount: number;
}

export type AppendContinuityInterruption =
	| { kind: "position_tip_missing"; tipEntryId: string }
	| { kind: "position_tip_changed"; tipEntryId: string }
	| { kind: "unexpected_history_change"; expectedEntryCount: number; actualEntryCount: number }
	| { kind: "post_anchor_segment_broken"; entryId: string }
	| { kind: "unexpected_successor"; predecessorId: string; entryIds: string[] };

export type AppendContinuity =
	| { status: "not_adopted" }
	| {
			status: "established";
			provenance: AppendContinuityProvenance;
			postAnchorEntryIds: string[];
	  }
	| {
			status: "interrupted";
			provenance: AppendContinuityProvenance;
			reasons: AppendContinuityInterruption[];
	  };

/**
 * `whole_history`: every entry verified as one lineage, with no interruption of a
 * recorded position. `post_anchor`: only the path after the admission anchor is
 * assured. `none`: no append assurance can be claimed.
 */
export type AppendAssuranceScope = "whole_history" | "post_anchor" | "none";

export type AppendAssuranceLimitation =
	/** The standard hash commits employee, type, event time and predecessor hash only. */
	| { code: "hash_commits_event_fields_only" }
	/** Stored evidence cannot prove who originally recorded an entry or its captures. */
	| { code: "original_actor_and_capture_unproven" }
	/** Payroll readiness has its own evidence rules; append assurance does not decide it. */
	| { code: "payroll_readiness_not_assessed" }
	| { code: "derived_links"; entryIds: string[] }
	/** Unknown format or altered inputs; not verified, and the format is not guessed. */
	| { code: "hash_not_reproduced"; entryIds: string[] }
	| { code: "hash_input_unavailable"; entryIds: string[] }
	| { code: "duplicate_hashes"; entryIdGroups: string[][] }
	| { code: "no_continuity_position" }
	| { code: "continuity_interrupted" }
	| { code: "history_before_anchor_unverified"; anchorEntryId: string | null }
	| { code: "lineage_unresolved" };

export interface AppendAssuranceReport extends AppendScope {
	entryCount: number;
	entries: AppendEntryAssessment[];
	hashes: {
		reproduced: number;
		notReproduced: string[];
		inputUnavailable: string[];
		duplicates: string[][];
	};
	links: { stored: number; derived: number; roots: number; unresolved: number };
	lineage: AppendLineageAssessment;
	continuity: AppendContinuity;
	assurance: { scope: AppendAssuranceScope; limitations: AppendAssuranceLimitation[] };
}

export function assessAppendAssurance(input: AppendAssuranceInput): AppendAssuranceReport {
	const { scope, position } = input;
	const graph = resolveAppendLinks(scope, input.entries);
	const entries: AppendEntryAssessment[] = graph.entries.flatMap((entry) => {
		const hash = graph.hashes.get(entry.id);
		const link = graph.links.get(entry.id);
		// Foreign rows are reported as lineage issues, not assessed as scoped entries.
		if (!hash || !link) return [];
		return [
			{
				entryId: entry.id,
				stored: {
					hash: entry.hash,
					previousHash: entry.previousHash,
					previousEntryId: entry.previousEntryId,
				},
				hash,
				link,
			},
		];
	});

	const idsWith = (predicate: (entry: AppendEntryAssessment) => boolean) =>
		entries.filter(predicate).map((entry) => entry.entryId);
	const entryIdsByHash = new Map<string, string[]>();
	for (const entry of entries) {
		entryIdsByHash.set(entry.stored.hash, [
			...(entryIdsByHash.get(entry.stored.hash) ?? []),
			entry.entryId,
		]);
	}
	const hashes = {
		reproduced: idsWith((entry) => entry.hash === "reproduced").length,
		notReproduced: idsWith((entry) => entry.hash === "not_reproduced"),
		inputUnavailable: idsWith((entry) => entry.hash === "input_unavailable"),
		duplicates: [...entryIdsByHash.values()]
			.filter((ids) => ids.length > 1)
			.toSorted((left, right) => (left[0] < right[0] ? -1 : 1)),
	};
	const links = {
		stored: idsWith((entry) => entry.link.kind === "stored").length,
		derived: idsWith((entry) => entry.link.kind === "derived").length,
		roots: idsWith((entry) => entry.link.kind === "root").length,
		unresolved: idsWith((entry) => entry.link.kind === "unresolved").length,
	};

	const lineage = assessLineage(input, entries);
	const continuity = position ? assessContinuity(position, graph.entries, entries) : null;

	const scopeClaim: AppendAssuranceScope =
		(lineage.status === "single" || lineage.status === "empty") &&
		continuity?.status !== "interrupted"
			? "whole_history"
			: continuity?.status === "established"
				? "post_anchor"
				: "none";

	const limitations: AppendAssuranceLimitation[] = [];
	if (entries.length > 0) {
		limitations.push(
			{ code: "hash_commits_event_fields_only" },
			{ code: "original_actor_and_capture_unproven" },
			{ code: "payroll_readiness_not_assessed" },
		);
		if (!continuity) limitations.push({ code: "no_continuity_position" });
	}
	const derivedIds = idsWith((entry) => entry.link.kind === "derived");
	if (derivedIds.length > 0) limitations.push({ code: "derived_links", entryIds: derivedIds });
	if (hashes.notReproduced.length > 0) {
		limitations.push({ code: "hash_not_reproduced", entryIds: hashes.notReproduced });
	}
	if (hashes.inputUnavailable.length > 0) {
		limitations.push({ code: "hash_input_unavailable", entryIds: hashes.inputUnavailable });
	}
	if (hashes.duplicates.length > 0) {
		limitations.push({ code: "duplicate_hashes", entryIdGroups: hashes.duplicates });
	}
	if (continuity?.status === "interrupted") limitations.push({ code: "continuity_interrupted" });
	if (scopeClaim === "post_anchor") {
		limitations.push({
			code: "history_before_anchor_unverified",
			anchorEntryId: position?.admittedTipEntryId ?? null,
		});
	}
	if (scopeClaim === "none" && lineage.status === "review_required") {
		limitations.push({ code: "lineage_unresolved" });
	}

	return {
		...scope,
		entryCount: entries.length,
		entries,
		hashes,
		links,
		lineage,
		continuity: continuity ?? { status: "not_adopted" },
		assurance: { scope: scopeClaim, limitations },
	};
}

function assessLineage(
	input: AppendAssuranceInput,
	entries: readonly AppendEntryAssessment[],
): AppendLineageAssessment {
	const classified = classifyAppendLineage(input.scope, input.entries);
	if (classified.kind === "empty") {
		// Work without any entries means earlier history is missing, not empty.
		return input.hasWork
			? { status: "review_required", issues: [{ kind: "history_without_entries" }] }
			: { status: "empty" };
	}
	if (classified.kind === "review_required") {
		return { status: "review_required", issues: classified.issues };
	}
	const root = entries.find((entry) => entry.link.kind === "root");
	if (!root) throw new Error("Verified append lineage has no root");
	return { status: "single", rootId: root.entryId, tip: classified.tip };
}

/**
 * Continuity holds when the recorded tip is unchanged, nothing was added after it
 * or elsewhere, and walking back exactly the entries appended since admission
 * reaches the admission anchor (or, for empty history, a root) through
 * reproducible entries, with nothing else branching from that path.
 */
function assessContinuity(
	position: AppendPositionEvidence,
	evidence: readonly AppendEvidenceEntry[],
	entries: readonly AppendEntryAssessment[],
): AppendContinuity {
	const anchor =
		position.admittedTipEntryId !== null && position.admittedTipHash !== null
			? { id: position.admittedTipEntryId, hash: position.admittedTipHash }
			: null;
	const provenance: AppendContinuityProvenance = {
		admission: position.admission,
		anchor,
		admittedEntryCount: position.admittedEntryCount,
		admittedAt: position.admittedAt,
		tip: { id: position.tipEntryId, hash: position.tipHash },
		entryCount: position.entryCount,
	};
	const reasons: AppendContinuityInterruption[] = [];
	const assessed = new Map(entries.map((entry) => [entry.entryId, entry]));

	const tip = assessed.get(position.tipEntryId);
	if (!tip) {
		reasons.push({ kind: "position_tip_missing", tipEntryId: position.tipEntryId });
	} else if (tip.stored.hash !== position.tipHash) {
		reasons.push({ kind: "position_tip_changed", tipEntryId: tip.entryId });
	}
	if (evidence.length !== position.entryCount) {
		reasons.push({
			kind: "unexpected_history_change",
			expectedEntryCount: position.entryCount,
			actualEntryCount: evidence.length,
		});
	}

	const walk = tip
		? walkPostAnchorSegment(
				tip,
				anchor,
				position.entryCount - position.admittedEntryCount,
				assessed,
			)
		: { segment: [] };
	if (walk.brokenAt) {
		reasons.push({ kind: "post_anchor_segment_broken", entryId: walk.brokenAt });
	}
	const segment = walk.segment;

	// Anything else following the anchor or a post-anchor entry bypassed the position.
	const segmentIds = new Set(segment.map((entry) => entry.entryId));
	const guardedIds = new Set(segmentIds);
	const guardedByHash = new Map(segment.map((entry) => [entry.stored.hash, entry.entryId]));
	if (anchor) {
		guardedIds.add(anchor.id);
		guardedByHash.set(anchor.hash, anchor.id);
	}
	const successors = new Map<string, string[]>();
	for (const entry of entries) {
		if (segmentIds.has(entry.entryId)) continue;
		// Unresolved references still count: a contradictory link to the path is not harmless.
		const predecessorId =
			entry.link.kind === "stored" || entry.link.kind === "derived"
				? entry.link.predecessorId
				: (entry.stored.previousEntryId ??
					(entry.stored.previousHash === null
						? undefined
						: guardedByHash.get(entry.stored.previousHash)));
		if (predecessorId !== undefined && guardedIds.has(predecessorId)) {
			successors.set(predecessorId, [...(successors.get(predecessorId) ?? []), entry.entryId]);
		}
	}
	for (const predecessorId of [...successors.keys()].toSorted()) {
		reasons.push({
			kind: "unexpected_successor",
			predecessorId,
			entryIds: successors.get(predecessorId) ?? [],
		});
	}

	return reasons.length > 0
		? { status: "interrupted", provenance, reasons }
		: {
				status: "established",
				provenance,
				postAnchorEntryIds: segment.map((entry) => entry.entryId).toSorted(),
			};
}

/**
 * Walks back from the recorded tip over the entries appended since admission.
 * Each must reproduce its hash and resolve its predecessor; the last must follow
 * the admission anchor, or be a root when admitted from empty history.
 */
function walkPostAnchorSegment(
	tip: AppendEntryAssessment,
	anchor: { id: string; hash: string } | null,
	length: number,
	assessed: ReadonlyMap<string, AppendEntryAssessment>,
): { segment: AppendEntryAssessment[]; brokenAt?: string } {
	const segment: AppendEntryAssessment[] = [];
	let current: AppendEntryAssessment | undefined = tip;
	while (segment.length < length) {
		if (current?.hash !== "reproduced") {
			return { segment, brokenAt: current?.entryId ?? segment.at(-1)?.entryId ?? tip.entryId };
		}
		segment.push(current);
		const link: AppendLinkResolution = current.link;
		const predecessorId =
			link.kind === "stored" || link.kind === "derived" ? link.predecessorId : null;
		if (segment.length === length) {
			const reachesStart =
				anchor === null
					? link.kind === "root"
					: predecessorId === anchor.id && assessed.get(anchor.id)?.stored.hash === anchor.hash;
			return reachesStart ? { segment } : { segment, brokenAt: current.entryId };
		}
		if (predecessorId === null) return { segment, brokenAt: current.entryId };
		current = assessed.get(predecessorId);
	}
	return { segment, brokenAt: tip.entryId };
}

/** Status and limitation codes without entry identities, for callers without diagnostic access. */
export function summarizeAppendAssurance(report: AppendAssuranceReport) {
	return {
		entryCount: report.entryCount,
		lineage: report.lineage.status,
		continuity: report.continuity.status,
		assurance: {
			scope: report.assurance.scope,
			limitations: report.assurance.limitations.map((limitation) => limitation.code).toSorted(),
		},
		hashes: {
			reproduced: report.hashes.reproduced,
			notReproduced: report.hashes.notReproduced.length,
			inputUnavailable: report.hashes.inputUnavailable.length,
			duplicates: report.hashes.duplicates.length,
		},
	};
}

export type AppendAssuranceSummary = ReturnType<typeof summarizeAppendAssurance>;
