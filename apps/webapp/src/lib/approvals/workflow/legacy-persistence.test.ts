import { PgDialect, type SQL } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as compatibilityApi from "./compatibility-writer";
import {
	createTransactionBoundLegacyApprovalPersistence,
	type LegacyApprovalRowWriter,
} from "./compatibility-writer";
import type { ApprovalCommandResult, ApprovalDbService } from "./ports";

const organizationId = "org-1";
const workflowId = "10000000-0000-4000-8000-000000000001";
const stageOne = "40000000-0000-4000-8000-000000000001";
const stageTwo = "40000000-0000-4000-8000-000000000002";

interface StoredStage {
	id: string;
	organizationId: string;
	workflowId: string;
	legacyApprovalRequestId: string | null;
}

function transactionHarness(
	initial: StoredStage[],
	options: {
		ignoreUpdates?: boolean;
		conflictRows?: StoredStage[];
		approvalRequests?: Array<{ id: string; organizationId: string }>;
	} = {},
) {
	const stages = new Map(initial.map((stage) => [stage.id, { ...stage }]));
	const calls: SQL[] = [];
	const timeline: string[] = [];
	const dialect = new PgDialect();
	const service = {
		db: {
			execute: async (query: SQL) => {
				calls.push(query);
				const rendered = dialect.sqlToQuery(query);
				if (rendered.sql.includes("from approval_request")) {
					timeline.push("approval-request-lock");
					const [org, ...candidateIds] = rendered.params as string[];
					return {
						rows: (options.approvalRequests ?? [])
							.filter(
								(request) =>
									request.organizationId === org &&
									candidateIds.includes(request.id),
							)
							.map((request) => ({
								id: request.id,
								organization_id: request.organizationId,
							})),
					};
				}
				if (
					rendered.sql.includes("select") &&
					rendered.sql.includes("approval_workflow_stage")
				) {
					if (
						rendered.sql.includes("legacy_approval_request_id in") &&
						!rendered.sql.includes("workflow_id =")
					) {
						timeline.push("conflict-select");
						const [org, ...legacyIds] = rendered.params as string[];
						const conflictRows =
							options.conflictRows ??
							[...stages.values()].filter(
								(stage) =>
									stage.organizationId === org &&
									stage.legacyApprovalRequestId !== null &&
									legacyIds.includes(stage.legacyApprovalRequestId),
							);
						return {
							rows: conflictRows.map((stage) => ({
								id: stage.id,
								organization_id: stage.organizationId,
								workflow_id: stage.workflowId,
								legacy_approval_request_id: stage.legacyApprovalRequestId,
							})),
						};
					}
					timeline.push("select");
					const [org, workflow, ...stageIds] = rendered.params as string[];
					return {
						rows: stageIds.flatMap((stageId) => {
							const stage = stages.get(stageId);
							return stage &&
								stage.organizationId === org &&
								stage.workflowId === workflow
								? [
										{
											id: stage.id,
											organization_id: stage.organizationId,
											workflow_id: stage.workflowId,
											legacy_approval_request_id: stage.legacyApprovalRequestId,
										},
									]
								: [];
						}),
					};
				}
				if (rendered.sql.includes("update approval_workflow_stage")) {
					timeline.push("update");
					const [legacyId, org, workflow, stageId] =
						rendered.params as string[];
					const stage = stages.get(stageId);
					if (
						!options.ignoreUpdates &&
						stage &&
						stage.organizationId === org &&
						stage.workflowId === workflow &&
						stage.legacyApprovalRequestId === null
					) {
						stage.legacyApprovalRequestId = legacyId;
					}
					return { rows: [] };
				}
				throw new Error(`Unexpected SQL: ${rendered.sql}`);
			},
		},
	} as ApprovalDbService;
	return { service, stages, calls, timeline, dialect };
}

function stage(
	id: string,
	legacyApprovalRequestId: string | null,
	overrides: Partial<StoredStage> = {},
): StoredStage {
	return {
		id,
		organizationId,
		workflowId,
		legacyApprovalRequestId,
		...overrides,
	};
}

describe("transaction-bound legacy approval persistence", () => {
	it("reuses existing IDs under an organization/workflow row lock", async () => {
		const existingId = "50000000-0000-4000-8000-000000000001";
		const fake = transactionHarness([stage(stageOne, existingId)]);
		const persistence = createTransactionBoundLegacyApprovalPersistence({
			dbService: fake.service,
			rowWriter: { writeLegacyRows: async () => undefined },
		});

		await expect(
			persistence.resolveOrCreateStableIds({
				organizationId,
				workflowId,
				stageIds: [stageOne],
			}),
		).resolves.toEqual([
			{
				organizationId,
				workflowId,
				stageId: stageOne,
				legacyApprovalRequestId: existingId,
			},
		]);
		expect(fake.timeline).toEqual(["select", "conflict-select"]);
		const query = fake.dialect.sqlToQuery(fake.calls[0] as SQL);
		expect(query.sql).toContain("for update");
		expect(query.params).toEqual([organizationId, workflowId, stageOne]);
		const conflictQuery = fake.dialect.sqlToQuery(fake.calls[1] as SQL);
		expect(conflictQuery.sql).toContain("legacy_approval_request_id in");
		expect(conflictQuery.sql).toContain("organization_id =");
		expect(conflictQuery.sql).not.toContain("workflow_id =");
		expect(conflictQuery.sql).toContain("for update");
		expect(conflictQuery.params).toEqual([organizationId, existingId]);
	});

	it("persists deterministic stage UUID IDs and reloads before returning", async () => {
		const fake = transactionHarness([
			stage(stageOne, null),
			stage(stageTwo, null),
		]);
		const persistence = createTransactionBoundLegacyApprovalPersistence({
			dbService: fake.service,
			rowWriter: { writeLegacyRows: async () => undefined },
		});

		const input = {
			organizationId,
			workflowId,
			stageIds: [stageOne, stageTwo],
		};
		const first = await persistence.resolveOrCreateStableIds(input);
		const second = await persistence.resolveOrCreateStableIds(input);

		expect(first).toEqual([
			{
				organizationId,
				workflowId,
				stageId: stageOne,
				legacyApprovalRequestId: stageOne,
			},
			{
				organizationId,
				workflowId,
				stageId: stageTwo,
				legacyApprovalRequestId: stageTwo,
			},
		]);
		expect(second).toEqual(first);
		expect(fake.timeline).toEqual([
			"select",
			"approval-request-lock",
			"conflict-select",
			"update",
			"update",
			"select",
			"conflict-select",
			"select",
			"conflict-select",
		]);
		for (const query of fake.calls.map((call) =>
			fake.dialect.sqlToQuery(call),
		)) {
			expect(query.params).toContain(organizationId);
			if (
				!query.sql.includes("legacy_approval_request_id in") &&
				!query.sql.includes("from approval_request")
			) {
				expect(query.params).toContain(workflowId);
			}
		}
	});

	it("sorts stage and legacy-ID lock sets while preserving caller output order", async () => {
		const existingOne = "50000000-0000-4000-8000-000000000002";
		const existingTwo = "50000000-0000-4000-8000-000000000001";
		const fake = transactionHarness([
			stage(stageOne, existingOne),
			stage(stageTwo, existingTwo),
		]);
		const persistence = createTransactionBoundLegacyApprovalPersistence({
			dbService: fake.service,
			rowWriter: { writeLegacyRows: async () => undefined },
		});

		const result = await persistence.resolveOrCreateStableIds({
			organizationId,
			workflowId,
			stageIds: [stageTwo, stageOne],
		});
		expect(result.map((mapping) => mapping.stageId)).toEqual([
			stageTwo,
			stageOne,
		]);
		const stageLock = fake.dialect.sqlToQuery(fake.calls[0] as SQL);
		expect(stageLock.params).toEqual([
			organizationId,
			workflowId,
			stageOne,
			stageTwo,
		]);
		expect(stageLock.sql).toContain("order by id");
		const mappingLock = fake.dialect.sqlToQuery(fake.calls[1] as SQL);
		expect(mappingLock.params).toEqual([
			organizationId,
			existingTwo,
			existingOne,
		]);
		expect(mappingLock.sql).toContain(
			"order by legacy_approval_request_id, id",
		);
	});

	it("converges overlapping stage sets regardless of caller input order", async () => {
		const first = transactionHarness([
			stage(stageOne, null),
			stage(stageTwo, null),
		]);
		const second = transactionHarness([
			stage(stageOne, null),
			stage(stageTwo, null),
		]);
		const firstPersistence = createTransactionBoundLegacyApprovalPersistence({
			dbService: first.service,
			rowWriter: { writeLegacyRows: async () => undefined },
		});
		const secondPersistence = createTransactionBoundLegacyApprovalPersistence({
			dbService: second.service,
			rowWriter: { writeLegacyRows: async () => undefined },
		});

		const [forward, reverse] = await Promise.all([
			firstPersistence.resolveOrCreateStableIds({
				organizationId,
				workflowId,
				stageIds: [stageOne, stageTwo],
			}),
			secondPersistence.resolveOrCreateStableIds({
				organizationId,
				workflowId,
				stageIds: [stageTwo, stageOne],
			}),
		]);
		const byStage = (mappings: typeof forward) =>
			Object.fromEntries(
				mappings.map((mapping) => [
					mapping.stageId,
					mapping.legacyApprovalRequestId,
				]),
			);
		expect(byStage(reverse)).toEqual(byStage(forward));
	});

	it("chooses and reuses a deterministic alternative when candidate zero is a current-org legacy request", async () => {
		const fake = transactionHarness([stage(stageOne, null)], {
			approvalRequests: [{ id: stageOne, organizationId }],
		});
		const persistence = createTransactionBoundLegacyApprovalPersistence({
			dbService: fake.service,
			rowWriter: { writeLegacyRows: async () => undefined },
		});
		const request = { organizationId, workflowId, stageIds: [stageOne] };

		const first = await persistence.resolveOrCreateStableIds(request);
		const second = await persistence.resolveOrCreateStableIds(request);
		expect(first[0]?.legacyApprovalRequestId).not.toBe(stageOne);
		expect(second).toEqual(first);
		const legacyQuery = fake.calls
			.map((query) => fake.dialect.sqlToQuery(query))
			.find((query) => query.sql.includes("from approval_request"));
		expect(legacyQuery?.sql).toContain("organization_id =");
		expect(legacyQuery?.sql).toContain("order by id");
		expect(legacyQuery?.sql).toContain("for update");
		expect(legacyQuery?.params[0]).toBe(organizationId);
		expect(legacyQuery?.params).not.toContain("org-2");
	});

	it("chooses an alternative before CAS when candidate zero is another canonical mapping", async () => {
		const conflictingStage = "40000000-0000-4000-8000-000000000099";
		const fake = transactionHarness([
			stage(stageOne, null),
			stage(conflictingStage, stageOne, {
				workflowId: "10000000-0000-4000-8000-000000000099",
			}),
		]);
		const persistence = createTransactionBoundLegacyApprovalPersistence({
			dbService: fake.service,
			rowWriter: { writeLegacyRows: async () => undefined },
		});

		await expect(
			persistence.resolveOrCreateStableIds({
				organizationId,
				workflowId,
				stageIds: [stageOne],
			}),
		).resolves.toEqual([
			expect.objectContaining({
				stageId: stageOne,
				legacyApprovalRequestId: expect.not.stringContaining(stageOne),
			}),
		]);
	});

	it("fails after the bounded deterministic candidate set is exhausted", async () => {
		const candidateFor = (
			compatibilityApi as typeof compatibilityApi & {
				deterministicLegacyApprovalRequestId?: (
					stageId: string,
					attempt: number,
				) => string;
			}
		).deterministicLegacyApprovalRequestId;
		const maxCandidates = (
			compatibilityApi as typeof compatibilityApi & {
				LEGACY_ID_CANDIDATE_LIMIT?: number;
			}
		).LEGACY_ID_CANDIDATE_LIMIT;
		expect(candidateFor).toBeTypeOf("function");
		expect(maxCandidates).toBeTypeOf("number");
		if (!candidateFor || !maxCandidates) return;

		const fake = transactionHarness([stage(stageOne, null)], {
			approvalRequests: Array.from({ length: maxCandidates }, (_, attempt) => ({
				id: candidateFor(stageOne, attempt),
				organizationId,
			})),
		});
		const persistence = createTransactionBoundLegacyApprovalPersistence({
			dbService: fake.service,
			rowWriter: { writeLegacyRows: async () => undefined },
		});
		await expect(
			persistence.resolveOrCreateStableIds({
				organizationId,
				workflowId,
				stageIds: [stageOne],
			}),
		).rejects.toThrow(/candidate|exhausted/i);
	});

	it("propagates the legacy writer's global approval-request PK failure", async () => {
		const fake = transactionHarness([stage(stageOne, stageOne)]);
		const persistence = createTransactionBoundLegacyApprovalPersistence({
			dbService: fake.service,
			rowWriter: {
				writeLegacyRows: async () => {
					throw new Error(
						'duplicate key value violates unique constraint "approval_request_pkey"',
					);
				},
			},
		});
		const legacyIds = await persistence.resolveOrCreateStableIds({
			organizationId,
			workflowId,
			stageIds: [stageOne],
		});
		await expect(
			persistence.writeLegacyRows({
				organizationId,
				result: {} as ApprovalCommandResult,
				legacyIds,
			}),
		).rejects.toThrow(/approval_request_pkey/i);
	});

	it.each([
		["unknown", [stage(stageOne, null)], "org-1", [stageOne, stageTwo]],
		[
			"cross-organization",
			[stage(stageOne, null, { organizationId: "org-2" })],
			"org-1",
			[stageOne],
		],
	] as const)("rejects a %s stage", async (_name, stored, requestedOrg, stageIds) => {
		const fake = transactionHarness([...stored]);
		const persistence = createTransactionBoundLegacyApprovalPersistence({
			dbService: fake.service,
			rowWriter: { writeLegacyRows: async () => undefined },
		});
		await expect(
			persistence.resolveOrCreateStableIds({
				organizationId: requestedOrg,
				workflowId,
				stageIds: [...stageIds],
			}),
		).rejects.toThrow(/missing|foreign|scope/i);
	});

	it("rejects duplicate requested stages before querying", async () => {
		const fake = transactionHarness([stage(stageOne, null)]);
		const persistence = createTransactionBoundLegacyApprovalPersistence({
			dbService: fake.service,
			rowWriter: { writeLegacyRows: async () => undefined },
		});
		await expect(
			persistence.resolveOrCreateStableIds({
				organizationId,
				workflowId,
				stageIds: [stageOne, stageOne],
			}),
		).rejects.toThrow(/duplicate stage/i);
		expect(fake.calls).toHaveLength(0);
	});

	it("rejects one existing legacy ID mapped to multiple stages", async () => {
		const duplicateId = "50000000-0000-4000-8000-000000000001";
		const fake = transactionHarness([
			stage(stageOne, duplicateId),
			stage(stageTwo, duplicateId),
		]);
		const persistence = createTransactionBoundLegacyApprovalPersistence({
			dbService: fake.service,
			rowWriter: { writeLegacyRows: async () => undefined },
		});
		await expect(
			persistence.resolveOrCreateStableIds({
				organizationId,
				workflowId,
				stageIds: [stageOne, stageTwo],
			}),
		).rejects.toThrow(/duplicate legacy/i);
	});

	it("rejects compare-and-set reload mismatches", async () => {
		const fake = transactionHarness([stage(stageOne, null)], {
			ignoreUpdates: true,
		});
		const persistence = createTransactionBoundLegacyApprovalPersistence({
			dbService: fake.service,
			rowWriter: { writeLegacyRows: async () => undefined },
		});
		await expect(
			persistence.resolveOrCreateStableIds({
				organizationId,
				workflowId,
				stageIds: [stageOne],
			}),
		).rejects.toThrow(/reload|persist|mismatch/i);
	});

	it("rejects a legacy ID owned by another workflow in the same organization", async () => {
		const duplicateId = "50000000-0000-4000-8000-000000000001";
		const fake = transactionHarness([
			stage(stageOne, duplicateId),
			stage("40000000-0000-4000-8000-000000000099", duplicateId, {
				workflowId: "10000000-0000-4000-8000-000000000099",
			}),
		]);
		const persistence = createTransactionBoundLegacyApprovalPersistence({
			dbService: fake.service,
			rowWriter: { writeLegacyRows: async () => undefined },
		});

		await expect(
			persistence.resolveOrCreateStableIds({
				organizationId,
				workflowId,
				stageIds: [stageOne],
			}),
		).rejects.toThrow(/conflict|legacy|mapping/i);
		expect(fake.timeline).toEqual(["select", "conflict-select"]);
	});

	it("locks exact mappings organization-wide without accessing another organization", async () => {
		const existingId = "50000000-0000-4000-8000-000000000001";
		const fake = transactionHarness([
			stage(stageOne, existingId),
			stage("40000000-0000-4000-8000-000000000099", existingId, {
				organizationId: "org-2",
				workflowId: "10000000-0000-4000-8000-000000000099",
			}),
		]);
		const persistence = createTransactionBoundLegacyApprovalPersistence({
			dbService: fake.service,
			rowWriter: { writeLegacyRows: async () => undefined },
		});

		await expect(
			persistence.resolveOrCreateStableIds({
				organizationId,
				workflowId,
				stageIds: [stageOne],
			}),
		).resolves.toHaveLength(1);
		const conflictQuery = fake.dialect.sqlToQuery(fake.calls[1] as SQL);
		expect(conflictQuery.params).toEqual([organizationId, existingId]);
		expect(conflictQuery.params).not.toContain("org-2");
	});

	it("rejects malformed cross-organization conflict evidence", async () => {
		const existingId = "50000000-0000-4000-8000-000000000001";
		const fake = transactionHarness([stage(stageOne, existingId)], {
			conflictRows: [
				stage(stageOne, existingId, {
					organizationId: "org-2",
				}),
			],
		});
		const persistence = createTransactionBoundLegacyApprovalPersistence({
			dbService: fake.service,
			rowWriter: { writeLegacyRows: async () => undefined },
		});

		await expect(
			persistence.resolveOrCreateStableIds({
				organizationId,
				workflowId,
				stageIds: [stageOne],
			}),
		).rejects.toThrow(/conflict|scope|mapping/i);
	});

	it("persists missing IDs before delegating legacy row writes", async () => {
		const fake = transactionHarness([stage(stageOne, null)]);
		const rowWriter: LegacyApprovalRowWriter = {
			writeLegacyRows: async () => {
				fake.timeline.push("writeLegacyRows");
			},
		};
		const persistence = createTransactionBoundLegacyApprovalPersistence({
			dbService: fake.service,
			rowWriter,
		});
		const legacyIds = await persistence.resolveOrCreateStableIds({
			organizationId,
			workflowId,
			stageIds: [stageOne],
		});
		await persistence.writeLegacyRows({
			organizationId,
			result: {} as ApprovalCommandResult,
			legacyIds,
		});

		expect(fake.timeline).toEqual([
			"select",
			"approval-request-lock",
			"conflict-select",
			"update",
			"select",
			"conflict-select",
			"writeLegacyRows",
		]);
		expect(fake.stages.get(stageOne)?.legacyApprovalRequestId).toBe(stageOne);
	});
});
