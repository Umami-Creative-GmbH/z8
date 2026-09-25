import { describe, expect, it } from "vitest";
import { appendHistoryDigest, planAppendContinuation } from "./append-continuation";
import type { AppendEvidenceEntry } from "./append-lineage";
import { calculateHash } from "./blockchain";

const scope = {
	organizationId: "org-1",
	employeeId: "a0000000-0000-4000-8000-000000000001",
};

let sequence = 0;
function entry(
	previous: Pick<AppendEvidenceEntry, "id" | "hash"> | null,
	options: { link?: "explicit" | "hash-only"; type?: string; tamper?: boolean } = {},
): AppendEvidenceEntry {
	sequence += 1;
	const timestamp = new Date(Date.UTC(2026, 6, 1, 8, sequence));
	const type = options.type ?? (sequence % 2 === 0 ? "clock_out" : "clock_in");
	const previousHash = previous?.hash ?? null;
	const hash = calculateHash({
		employeeId: scope.employeeId,
		type,
		timestamp: timestamp.toISOString(),
		previousHash,
	});
	return {
		id: `e0000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`,
		organizationId: scope.organizationId,
		employeeId: scope.employeeId,
		type,
		timestamp,
		previousHash,
		previousEntryId: previous && options.link !== "hash-only" ? previous.id : null,
		hash: options.tamper
			? calculateHash({ employeeId: "provider", type, timestamp: "raw", previousHash })
			: hash,
	};
}

/** A fork: root R with two successors A and B; B continues to C. Tips are A and C. */
function forkedHistory() {
	const root = entry(null);
	const a = entry(root);
	const b = entry(root);
	const c = entry(b);
	return { root, a, b, c, entries: [c, a, root, b] };
}

function plan(
	entries: readonly AppendEvidenceEntry[],
	anchor: Pick<AppendEvidenceEntry, "id" | "hash">,
	options: {
		positionExists?: boolean;
		hasWork?: boolean;
		activeWork?: boolean;
		pendingCorrection?: boolean;
	} = {},
) {
	return planAppendContinuation({
		scope,
		entries,
		positionExists: options.positionExists ?? false,
		hasWork: options.hasWork ?? true,
		pending: {
			activeWork: options.activeWork ?? false,
			pendingCorrection: options.pendingCorrection ?? false,
		},
		anchor: { entryId: anchor.id, hash: anchor.hash },
	});
}

describe("planAppendContinuation", () => {
	it("proposes a forward anchor over a forked history and discloses the competing tips", () => {
		const { root, a, c, entries } = forkedHistory();
		const result = plan(entries, c);

		expect(result.kind).toBe("proposal");
		if (result.kind !== "proposal") return;
		const { proposal } = result;
		expect(proposal.anchor).toMatchObject({
			entryId: c.id,
			hash: c.hash,
			hashStatus: "reproduced",
		});
		expect(proposal.candidates.map((candidate) => candidate.entryId)).toEqual([a.id, c.id]);
		expect(proposal.issues).toEqual([
			{ kind: "fork", predecessorId: root.id, successorIds: [a.id, entries[3].id].toSorted() },
		]);
		expect(proposal.components).toEqual([
			{ rootIds: [root.id], tipIds: [a.id, c.id], entryCount: 4 },
		]);
		expect(proposal.guarantee).toEqual({
			scope: "post_anchor",
			anchorEntryId: c.id,
			historyBeforeAnchor: "unverified_disclosed",
		});
		expect(proposal.limitations.map((limitation) => limitation.code)).toEqual([
			"pre_anchor_history_unverified",
		]);
		expect(proposal.expected).toEqual({
			entryCount: 4,
			historyDigest: appendHistoryDigest(entries),
			hasWork: true,
			position: null,
		});
		expect(proposal.consequences).toEqual({
			appends: "fresh_appends_follow_anchor",
			audit: "post_anchor_assurance_scope",
			replay: "committed_replay_unchanged",
			payroll: "payroll_readiness_unchanged",
			history: "no_rows_rewritten",
		});
		expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/);
	});

	it("keeps disconnected import islands as separate components", () => {
		const first = entry(null);
		const firstOut = entry(first);
		const island = entry(null);
		const islandOut = entry(island);
		const result = plan([islandOut, first, island, firstOut], islandOut);

		expect(result.kind).toBe("proposal");
		if (result.kind !== "proposal") return;
		expect(result.proposal.components).toEqual([
			{ rootIds: [first.id], tipIds: [firstOut.id], entryCount: 2 },
			{ rootIds: [island.id], tipIds: [islandOut.id], entryCount: 2 },
		]);
		expect(result.proposal.issues).toEqual([
			{ kind: "multiple_roots", rootIds: [first.id, island.id] },
		]);
	});

	it("accepts an anchor whose hash does not reproduce as a disclosed limitation", () => {
		const root = entry(null);
		const provider = entry(null, { tamper: true });
		const result = plan([root, provider], provider);

		expect(result.kind).toBe("proposal");
		if (result.kind !== "proposal") return;
		expect(result.proposal.anchor.hashStatus).toBe("not_reproduced");
		expect(result.proposal.limitations.map((limitation) => limitation.code)).toEqual([
			"pre_anchor_history_unverified",
			"anchor_hash_not_reproduced",
		]);
	});

	it("is independent of input order", () => {
		const { c, entries } = forkedHistory();
		const forward = plan(entries, c);
		const backward = plan(entries.toReversed(), c);
		expect(forward).toEqual(backward);
	});

	it("changes its fingerprint when any history evidence changes", () => {
		const { c, entries } = forkedHistory();
		const before = plan(entries, c);
		const changed = entries.map((row) =>
			row.id === entries[1].id ? { ...row, type: "break_start" } : row,
		);
		const after = plan(changed, c);
		expect(before.kind === "proposal" && after.kind === "proposal").toBe(true);
		if (before.kind !== "proposal" || after.kind !== "proposal") return;
		expect(after.fingerprint).not.toBe(before.fingerprint);
	});

	it.each([
		["an existing position", { positionExists: true }, "position_exists"],
		[
			"open work, whose clock-out must follow its own clock-in",
			{ activeWork: true },
			"active_work",
		],
		["a pending correction", { pendingCorrection: true }, "correction_pending"],
	] as const)("refuses %s", (_name, options, reason) => {
		const { c, entries } = forkedHistory();
		expect(plan(entries, c, options)).toEqual({ kind: "refused", reasons: [reason] });
	});

	it("refuses history that automatic admission accepts", () => {
		const root = entry(null);
		const tip = entry(root);
		expect(plan([root, tip], tip)).toEqual({ kind: "refused", reasons: ["history_admissible"] });
	});

	it("refuses a missing or foreign anchor and never invents a genesis", () => {
		const { entries } = forkedHistory();
		const foreign = { ...entry(null), employeeId: "a0000000-0000-4000-8000-000000000002" };
		expect(plan(entries, { id: "e0000000-0000-4000-8000-999999999999", hash: "x" })).toEqual({
			kind: "refused",
			reasons: ["anchor_not_found"],
		});
		expect(plan([...entries, foreign], foreign)).toEqual({
			kind: "refused",
			reasons: ["anchor_not_found"],
		});
		expect(plan([], { id: foreign.id, hash: foreign.hash }, { hasWork: true })).toEqual({
			kind: "refused",
			reasons: ["anchor_not_found"],
		});
	});

	it("refuses an anchor whose expected hash differs from the stored row", () => {
		const { c, entries } = forkedHistory();
		expect(plan(entries, { id: c.id, hash: "0".repeat(64) })).toEqual({
			kind: "refused",
			reasons: ["anchor_hash_mismatch"],
		});
	});

	it("refuses an anchor that already has a successor, which would fork it", () => {
		const { b, entries } = forkedHistory();
		expect(plan(entries, b)).toEqual({ kind: "refused", reasons: ["anchor_has_successor"] });
		// A hash-only successor counts too.
		const { root, a } = forkedHistory();
		const hashOnly = entry(a, { link: "hash-only" });
		const other = entry(root);
		expect(plan([root, a, hashOnly, other], a)).toEqual({
			kind: "refused",
			reasons: ["anchor_has_successor"],
		});
	});

	it("refuses an anchor whose identity is ambiguous because another row carries its hash", () => {
		const root = entry(null);
		const tip = entry(root);
		const twin = { ...tip, id: "e0000000-0000-4000-8000-888888888888", previousEntryId: null };
		const island = entry(null);
		expect(plan([root, tip, twin, island], tip)).toEqual({
			kind: "refused",
			reasons: ["anchor_identity_ambiguous"],
		});
	});

	it("refuses an anchor without a stored hash", () => {
		const root = entry(null);
		const empty = { ...entry(null), hash: "" };
		expect(plan([root, empty], empty)).toEqual({
			kind: "refused",
			reasons: ["anchor_hash_missing"],
		});
	});
});

describe("appendHistoryDigest", () => {
	it("is independent of order and sensitive to every stored field", () => {
		const { entries } = forkedHistory();
		const digest = appendHistoryDigest(entries);
		expect(appendHistoryDigest(entries.toReversed())).toBe(digest);
		for (const field of ["hash", "previousHash", "previousEntryId", "type"] as const) {
			const changed = entries.map((row, index) => (index === 0 ? { ...row, [field]: "x" } : row));
			expect(appendHistoryDigest(changed)).not.toBe(digest);
		}
		const moved = entries.map((row, index) =>
			index === 0 ? { ...row, timestamp: new Date(row.timestamp.getTime() + 1) } : row,
		);
		expect(appendHistoryDigest(moved)).not.toBe(digest);
	});
});
