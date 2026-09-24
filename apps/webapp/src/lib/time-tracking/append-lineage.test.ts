import { describe, expect, it } from "vitest";
import { type AppendEvidenceEntry, classifyAppendLineage } from "./append-lineage";
import { calculateHash } from "./blockchain";

const scope = {
	organizationId: "org-1",
	employeeId: "a0000000-0000-4000-8000-000000000001",
};

let sequence = 0;
function nextId() {
	sequence += 1;
	return `e0000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

function entry(
	previous: Pick<AppendEvidenceEntry, "id" | "hash"> | null,
	options: {
		id?: string;
		type?: string;
		timestamp?: string;
		link?: "explicit" | "hash-only";
		employeeId?: string;
		organizationId?: string;
	} = {},
): AppendEvidenceEntry {
	const timestamp = new Date(options.timestamp ?? "2026-07-01T08:00:00.000Z");
	const type = options.type ?? "clock_in";
	const employeeId = options.employeeId ?? scope.employeeId;
	const previousHash = previous?.hash ?? null;
	return {
		id: options.id ?? nextId(),
		organizationId: options.organizationId ?? scope.organizationId,
		employeeId,
		type,
		timestamp,
		previousHash,
		previousEntryId: previous && options.link !== "hash-only" ? previous.id : null,
		hash: calculateHash({
			employeeId,
			type,
			timestamp: timestamp.toISOString(),
			previousHash,
		}),
	};
}

/** Builds a linear lineage with each entry's event time an hour after the last. */
function lineage(length: number, link: "explicit" | "hash-only" = "explicit") {
	const entries: AppendEvidenceEntry[] = [];
	for (let index = 0; index < length; index += 1) {
		entries.push(
			entry(entries.at(-1) ?? null, {
				type: index % 2 === 0 ? "clock_in" : "clock_out",
				timestamp: new Date(Date.UTC(2026, 6, 1, 8 + index)).toISOString(),
				link,
			}),
		);
	}
	return entries;
}

function reasons(result: ReturnType<typeof classifyAppendLineage>) {
	return result.kind === "review_required"
		? result.issues.map((issue) => issue.kind).toSorted()
		: [];
}

describe("classifyAppendLineage", () => {
	it("classifies no entries as genuinely empty history", () => {
		expect(classifyAppendLineage(scope, [])).toEqual({ kind: "empty" });
	});

	it("admits one explicit lineage and names its exact tip", () => {
		const entries = lineage(4);
		const tip = entries[3];

		expect(classifyAppendLineage(scope, entries)).toEqual({
			kind: "lineage",
			tip: { id: tip.id, hash: tip.hash },
			entryCount: 4,
			derivedLinks: 0,
		});
	});

	it("derives hash-only links read-only when exactly one row agrees", () => {
		const entries = lineage(3, "hash-only");

		expect(classifyAppendLineage(scope, entries)).toMatchObject({
			kind: "lineage",
			tip: { id: entries[2].id },
			derivedLinks: 2,
		});
	});

	it("does not depend on input order, creation ties or backdated event times", () => {
		const root = entry(null, { timestamp: "2026-07-01T16:00:00.000Z" });
		// A backdated pair written after the root: event times precede it.
		const backdatedIn = entry(root, { timestamp: "2026-06-30T08:00:00.000Z" });
		const backdatedOut = entry(backdatedIn, {
			type: "clock_out",
			timestamp: "2026-06-30T12:00:00.000Z",
		});
		const expected = {
			kind: "lineage",
			tip: { id: backdatedOut.id, hash: backdatedOut.hash },
			entryCount: 3,
			derivedLinks: 0,
		};

		expect(classifyAppendLineage(scope, [backdatedOut, root, backdatedIn])).toEqual(expected);
		expect(classifyAppendLineage(scope, [backdatedIn, backdatedOut, root])).toEqual(expected);
	});

	it("keeps a hash-only edge ambiguous when several rows carry the hash", () => {
		const root = entry(null);
		const first = entry(root, { type: "clock_out" });
		const clone = { ...first, id: nextId(), previousEntryId: root.id };
		const hashOnly = entry(first, { timestamp: "2026-07-01T09:00:00.000Z", link: "hash-only" });

		const result = classifyAppendLineage(scope, [root, first, clone, hashOnly]);

		expect(result).toEqual({
			kind: "review_required",
			issues: expect.arrayContaining([
				{
					kind: "ambiguous_predecessor",
					entryId: hashOnly.id,
					candidateIds: [first.id, clone.id].toSorted(),
				},
			]),
		});
	});

	it("does not treat duplicate hashes as ambiguous when explicit IDs disambiguate them", () => {
		// Distinct rows with identical hash inputs legitimately share a hash. The
		// standard hash commits previousHash, so duplicates always sit on separate
		// branches or components; only that structure, not the duplicate, blocks.
		const leftRoot = entry(null);
		const rightRoot = { ...leftRoot, id: nextId() };
		const leftNext = entry(leftRoot, { type: "clock_out" });
		const rightNext = { ...leftNext, id: nextId(), previousEntryId: rightRoot.id };

		expect(classifyAppendLineage(scope, [leftRoot, rightRoot, leftNext, rightNext])).toEqual({
			kind: "review_required",
			issues: [{ kind: "multiple_roots", rootIds: [leftRoot.id, rightRoot.id].toSorted() }],
		});
	});

	it("returns review for competing heads instead of choosing one", () => {
		const root = entry(null);
		const left = entry(root, { type: "clock_out", timestamp: "2026-07-01T10:00:00.000Z" });
		const right = entry(root, { type: "clock_out", timestamp: "2026-07-01T11:00:00.000Z" });

		expect(classifyAppendLineage(scope, [root, left, right])).toEqual({
			kind: "review_required",
			issues: [
				{ kind: "fork", predecessorId: root.id, successorIds: [left.id, right.id].toSorted() },
			],
		});
	});

	it("returns review for disconnected roots such as imported islands", () => {
		const island = lineage(2);
		const other = entry(null, { timestamp: "2026-07-02T08:00:00.000Z" });

		expect(reasons(classifyAppendLineage(scope, [...island, other]))).toEqual(["multiple_roots"]);
	});

	it("returns review for a hole left by a removed predecessor", () => {
		const [root, removed, survivor] = lineage(3, "hash-only");
		void removed;

		expect(classifyAppendLineage(scope, [root, survivor])).toEqual({
			kind: "review_required",
			issues: [{ kind: "missing_predecessor", entryId: survivor.id }],
		});
	});

	it("never replaces a dangling or contradictory explicit ID with a hash match", () => {
		const [root, next] = lineage(2);
		const dangling = { ...next, previousEntryId: nextId() };
		expect(reasons(classifyAppendLineage(scope, [root, dangling]))).toEqual([
			"predecessor_outside_scope",
		]);

		const other = entry(null, { timestamp: "2026-07-03T08:00:00.000Z" });
		const contradictory = { ...next, previousEntryId: other.id };
		expect(reasons(classifyAppendLineage(scope, [root, other, contradictory]))).toEqual([
			"multiple_roots",
			"predecessor_hash_mismatch",
		]);

		const hashless = entry(null, { timestamp: "2026-07-04T08:00:00.000Z" });
		expect(
			reasons(classifyAppendLineage(scope, [root, { ...hashless, previousEntryId: root.id }])),
		).toEqual(["predecessor_hash_missing"]);
	});

	it("rejects predecessors and entries outside the organization/employee scope", () => {
		const foreignRoot = entry(null, { employeeId: "a0000000-0000-4000-8000-000000000002" });
		const local = entry(null);

		expect(reasons(classifyAppendLineage(scope, [local, foreignRoot]))).toEqual(["foreign_entry"]);

		const otherOrganization = entry(null, { organizationId: "org-2" });
		const linked = { ...entry(otherOrganization), organizationId: scope.organizationId };
		expect(reasons(classifyAppendLineage(scope, [otherOrganization, linked]))).toEqual([
			"foreign_entry",
			"predecessor_outside_scope",
		]);
	});

	it("rejects self-reference and cycles", () => {
		const root = entry(null);
		const self = entry(root, { type: "clock_out" });
		expect(
			reasons(classifyAppendLineage(scope, [root, { ...self, previousEntryId: self.id }])),
		).toEqual(["self_reference"]);

		// A and B each point at the other. The standard hash commits previousHash,
		// so such a cycle cannot also reproduce its hashes; both are reported.
		const a = entry(null, { timestamp: "2026-07-05T08:00:00.000Z" });
		const b = entry(a, { type: "clock_out" });
		const cyclicA = { ...a, previousEntryId: b.id, previousHash: b.hash };
		expect(classifyAppendLineage(scope, [root, cyclicA, b])).toEqual({
			kind: "review_required",
			issues: [
				{ kind: "unverified_hash", entryId: a.id },
				{ kind: "cycle", entryIds: [a.id, b.id].toSorted() },
			],
		});
	});

	it("requires every hash to reproduce under the standard serialization", () => {
		const [root, next] = lineage(2);
		const tampered = { ...next, timestamp: new Date("2026-07-01T09:00:00.001Z") };

		expect(classifyAppendLineage(scope, [root, tampered])).toEqual({
			kind: "review_required",
			issues: [{ kind: "unverified_hash", entryId: next.id }],
		});
	});

	it("does not treat empty or literal genesis predecessor hashes as roots", () => {
		for (const previousHash of ["", "genesis"]) {
			const root = entry(null);
			const disguised = { ...root, id: nextId(), previousHash };

			expect(reasons(classifyAppendLineage(scope, [disguised]))).toEqual(["nonstandard_genesis"]);
		}
	});
});
