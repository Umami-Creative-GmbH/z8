import { describe, expect, it, vi } from "vitest";
import { timeRecord, workPeriod } from "@/db/schema";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { ApprovalWorkflowSnapshot } from "../workflow/ports";
import {
	createOrdinaryWorkPeriodApprovalAdapter,
	type OrdinaryWorkPeriodApprovalAdapterDependencies,
} from "./work-period.adapter";
import {
	ORDINARY_WORK_PERIOD_APPROVAL_KINDS,
	type OrdinaryWorkPeriodApprovalKind,
} from "./work-period-contract";

const ids = {
	workflow: "10000000-0000-4000-8000-000000000001",
	period: "20000000-0000-4000-8000-000000000001",
	employee: "30000000-0000-4000-8000-000000000001",
	actor: "30000000-0000-4000-8000-000000000002",
	canonical: "40000000-0000-4000-8000-000000000001",
	stage: "50000000-0000-4000-8000-000000000001",
	request: "60000000-0000-4000-8000-000000000001",
} as const;
const organizationId = "org-1";
const actorUserId = "user-actor";
const submittedAt = parseInstant("2026-07-20T14:05:00Z");
const finalizedAt = parseInstant("2026-07-20T15:00:00Z");
const startTime = new Date("2026-07-20T06:00:00.000Z");
const endTime = new Date("2026-07-20T14:00:00.000Z");

function required<T>(value: T | null | undefined): T {
	if (value === null || value === undefined) {
		throw new Error("Invalid test fixture");
	}
	return value;
}

function workflow(
	kind: OrdinaryWorkPeriodApprovalKind,
	overrides: Partial<ApprovalWorkflowSnapshot> = {},
): ApprovalWorkflowSnapshot {
	return {
		id: ids.workflow,
		organizationId,
		workflowType: kind,
		sourceType: "time_entry",
		sourceId: ids.period,
		requesterEmployeeId: ids.employee,
		status: "pending",
		currentStageOrder: 1,
		version: 3,
		policySnapshot: {},
		contextSnapshot: {
			timeRequest: { kind },
			routing: { attackerPrivateValue: "must-not-be-trusted" },
		},
		displaySnapshot: {},
		submittedAt,
		completedAt: null,
		cancelledAt: null,
		decisionReason: null,
		stages: [
			{
				id: ids.stage,
				organizationId,
				workflowId: ids.workflow,
				sequence: 1,
				label: "Manager review",
				resolverSnapshot: {},
				activationMode: "immediate",
				status: "pending",
				activatedAt: submittedAt,
				decidedAt: null,
				decisionReason: null,
				legacyApprovalRequestId: ids.request,
				assignments: [],
			},
		],
		...overrides,
	};
}

function createFixture() {
	const value = {
		period: {
			id: ids.period,
			organizationId,
			employeeId: ids.employee,
			clockInId: "70000000-0000-4000-8000-000000000001",
			clockOutId: "70000000-0000-4000-8000-000000000002",
			canonicalRecordId: ids.canonical,
			approvalWorkflowId: ids.workflow,
			startTime,
			endTime,
			durationMinutes: 480,
			isActive: false,
			approvalStatus: "pending",
			pendingChanges: { privateNote: "do not project" },
			deletedAt: null,
		},
		canonical: {
			id: ids.canonical,
			organizationId,
			employeeId: ids.employee,
			recordKind: "work",
			startAt: startTime,
			endAt: endTime,
			durationMinutes: 480,
			approvalState: "pending",
		},
	};
	const whereInputs: unknown[] = [];
	const db = {
		select: vi.fn(() => {
			let table: unknown;
			const query = {
				from(input: unknown) {
					table = input;
					return query;
				},
				where(input: unknown) {
					whereInputs.push(input);
					return query;
				},
				for() {
					if (table === workPeriod) return Promise.resolve([value.period]);
					if (table === timeRecord) return Promise.resolve([value.canonical]);
					return Promise.resolve([]);
				},
			};
			return query;
		}),
	};
	return { value, whereInputs, db };
}

function collectBoundValues(value: unknown): unknown[] {
	if (!value || typeof value !== "object") return [];
	const candidate = value as { value?: unknown; queryChunks?: unknown[] };
	return [
		...(Object.hasOwn(candidate, "value") ? [candidate.value] : []),
		...(candidate.queryChunks?.flatMap(collectBoundValues) ?? []),
	];
}

function createAdapter(kind: OrdinaryWorkPeriodApprovalKind) {
	const finalizeTerminal = vi
		.fn<OrdinaryWorkPeriodApprovalAdapterDependencies["finalizeTerminal"]>()
		.mockResolvedValue({
			kind,
			action: "approve",
			reason: null,
			period: {
				id: ids.period,
				organizationId,
				employeeId: ids.employee,
				canonicalRecordId: ids.canonical,
				startTime,
				endTime,
			},
		});
	return {
		adapter: createOrdinaryWorkPeriodApprovalAdapter(kind, {
			finalizeTerminal,
		}),
		finalizeTerminal,
	};
}

async function loadedContext(kind: OrdinaryWorkPeriodApprovalKind) {
	const fixture = createFixture();
	const dependencies = createAdapter(kind);
	const source = await dependencies.adapter.loadSource({
		dbService: { db: fixture.db } as never,
		organizationId,
		workflow: workflow(kind),
		sourceIdentity: {
			organizationId,
			workflowType: kind,
			sourceType: "time_entry",
			sourceId: ids.period,
		},
		actor: { kind: "employee", employeeId: ids.actor, userId: actorUserId },
	});
	return {
		...dependencies,
		fixture,
		context: {
			organizationId,
			workflow: workflow(kind),
			sourceIdentity: {
				organizationId,
				workflowType: kind,
				sourceType: "time_entry",
				sourceId: ids.period,
			},
			source,
			actor: {
				kind: "employee" as const,
				employeeId: ids.actor,
				userId: actorUserId,
			},
		},
	};
}

describe.each(
	ORDINARY_WORK_PERIOD_APPROVAL_KINDS,
)("%s ordinary work-period approval adapter", (kind) => {
	it("loads the exact organization-scoped period and linked canonical work evidence", async () => {
		const { adapter } = createAdapter(kind);
		const fixture = createFixture();
		const source = await adapter.loadSource({
			dbService: { db: fixture.db } as never,
			organizationId,
			workflow: workflow(kind),
			sourceIdentity: {
				organizationId,
				workflowType: kind,
				sourceType: "time_entry",
				sourceId: ids.period,
			},
			actor: { kind: "system", employeeId: null, userId: null },
		});

		expect(adapter).toMatchObject({
			workflowType: kind,
			sourceType: "time_entry",
		});
		expect(source).toEqual({
			id: ids.period,
			organizationId,
			employeeId: ids.employee,
			canonicalRecordId: ids.canonical,
			approvalWorkflowId: ids.workflow,
			approvalStatus: "pending",
			startTime: "2026-07-20T06:00:00Z",
			endTime: "2026-07-20T14:00:00Z",
			durationMinutes: 480,
			payload: { timeRequest: { kind } },
		});
		expect(fixture.whereInputs).toHaveLength(2);
		for (const where of fixture.whereInputs) {
			expect(collectBoundValues(where)).toContain(organizationId);
			expect(collectBoundValues(where)).toContain(ids.employee);
		}
		expect(collectBoundValues(fixture.whereInputs[0])).toContain(ids.period);
		expect(collectBoundValues(fixture.whereInputs[1])).toContain(ids.canonical);
	});

	it.each([
		["workflow kind", { workflowType: "time_correction" }],
		["source alias", { sourceType: "work_period" }],
		["source ID", { sourceId: "20000000-0000-4000-8000-000000000099" }],
		["organization", { organizationId: "org-2" }],
	])("rejects mismatched %s before loading", async (_label, override) => {
		const { adapter } = createAdapter(kind);
		const fixture = createFixture();
		const currentWorkflow = workflow(kind, override as never);
		await expect(
			adapter.loadSource({
				dbService: { db: fixture.db } as never,
				organizationId,
				workflow: currentWorkflow,
				sourceIdentity: {
					organizationId,
					workflowType: currentWorkflow.workflowType,
					sourceType: currentWorkflow.sourceType,
					sourceId: currentWorkflow.sourceId,
				},
				actor: { kind: "system", employeeId: null, userId: null },
			}),
		).rejects.toThrow(/invalid/i);
		if (_label === "source ID") {
			expect(fixture.db.select).toHaveBeenCalledOnce();
		} else {
			expect(fixture.db.select).not.toHaveBeenCalled();
		}
	});

	it("rejects workflow, source, and immutable payload kind mismatches", async () => {
		const loaded = await loadedContext(kind);
		const otherKind =
			kind === "manual_time_submission"
				? "policy_clock_out"
				: "manual_time_submission";
		for (const context of [
			{ ...loaded.context, workflow: workflow(otherKind) },
			{
				...loaded.context,
				sourceIdentity: {
					...loaded.context.sourceIdentity,
					workflowType: otherKind,
				},
			},
			{
				...loaded.context,
				source: {
					...loaded.context.source,
					payload: { timeRequest: { kind: otherKind } },
				},
			},
		]) {
			await expect(
				adapterCall(loaded.adapter, context as never),
			).rejects.toThrow(/invalid/i);
		}
	});

	it("routes using requester and safe work-period facts and cannot cancel after approval", async () => {
		const { adapter, context } = await loadedContext(kind);
		await expect(adapter.getTrustedCapabilities(context)).resolves.toEqual({
			canCancelAfterApproval: false,
		});
		await expect(adapter.produceRoutingContext(context)).resolves.toEqual({
			organizationId,
			workflowType: kind,
			source: { type: "time_entry", id: ids.period },
			requesterEmployeeId: ids.employee,
			teamIds: [],
			locationId: null,
			absenceCategoryId: null,
			travelExpenseAmount: null,
			overtimeRisk: null,
			employeeGroupIds: [],
			workPeriod: { durationMinutes: 480 },
		});
	});

	it.each([
		["submit", "pending"],
		["approve", "approved"],
		["reject", "rejected"],
	] as const)("permits %s command preflight", async (command, proposedStatus) => {
		const { adapter, context } = await loadedContext(kind);
		await expect(
			adapter.preflightCommand({
				...context,
				command:
					command === "submit"
						? { kind: command, payload: {} }
						: command === "approve"
							? { kind: command, reason: null }
							: { kind: command, reason: "No" },
				proposedStatus,
			}),
		).resolves.toBeUndefined();
	});

	it("rejects cancellation command and unsupported terminal transitions", async () => {
		const { adapter, context } = await loadedContext(kind);
		await expect(
			adapter.preflightCommand({
				...context,
				command: { kind: "cancel", reason: null },
				proposedStatus: "cancelled",
			}),
		).rejects.toThrow(/incompatible/i);
		for (const transition of [
			{
				kind: "cancel_pending",
				from: "pending",
				to: "cancelled",
				reason: null,
			},
			{
				kind: "cancel_approved",
				from: "approved",
				to: "cancelled",
				reason: null,
				authorization: {},
			},
			{ kind: "expire", from: "pending", to: "expired", reason: null },
		]) {
			await expect(
				adapter.preflightTerminal({
					...context,
					dbService: { db: {} } as never,
					finalizationCause: "command",
					transition,
					finalizedAt,
				} as never),
			).rejects.toThrow(/incompatible/i);
		}
	});

	it.each([
		["approve", "approved", null],
		["reject", "rejected", "Insufficient evidence"],
	] as const)("finalizes %s through the injected callback", async (action, status, reason) => {
		const { adapter, context, finalizeTerminal } = await loadedContext(kind);
		const terminalWorkflow = workflow(kind, {
			status,
			currentStageOrder: null,
			completedAt: finalizedAt,
			decisionReason: reason,
			stages: [
				{
					...required(workflow(kind).stages[0]),
					status,
					decidedAt: finalizedAt,
					decisionReason: reason,
				},
			],
		});
		const result = await adapter.finalizeTerminal({
			...context,
			workflow: terminalWorkflow,
			dbService: { db: { marker: "caller transaction" } } as never,
			finalizationCause: "command",
			transition:
				action === "approve"
					? { kind: "approve", from: "pending", to: "approved", reason }
					: {
							kind: "reject",
							from: "pending",
							to: "rejected",
							reason: required(reason),
						},
			finalizedAt,
		});

		expect(finalizeTerminal).toHaveBeenCalledOnce();
		expect(finalizeTerminal).toHaveBeenCalledWith({
			dbService: expect.objectContaining({
				db: { marker: "caller transaction" },
			}),
			organizationId,
			workPeriodId: ids.period,
			approvalRequestId: ids.request,
			expectedApprovalWorkflowId: ids.workflow,
			requesterEmployeeId: ids.employee,
			actorEmployeeId: ids.actor,
			actorUserId,
			kind,
			transition: { kind: action, reason },
			finalizedAt,
			allowUnlinkedLegacySource: false,
		});
		expect(result).toMatchObject({
			organizationId,
			workflowId: ids.workflow,
			sourceIdentity: {
				organizationId,
				workflowType: kind,
				sourceType: "time_entry",
				sourceId: ids.period,
			},
			transitionKind: action,
			terminalStatus: status,
		});
		expect(JSON.stringify(result)).not.toContain(ids.request);
		expect(JSON.stringify(result)).not.toContain("privateNote");
	});

	it.each([
		null,
		"ambiguous",
	] as const)("rejects %s terminal compatibility request evidence without calling the finalizer", async (failure) => {
		const { adapter, context, finalizeTerminal } = await loadedContext(kind);
		const terminalStage = {
			...required(workflow(kind).stages[0]),
			status: "approved" as const,
			decidedAt: finalizedAt,
			legacyApprovalRequestId: failure === null ? null : ids.request,
		};
		const stages =
			failure === "ambiguous"
				? [
						terminalStage,
						{ ...terminalStage, id: "50000000-0000-4000-8000-000000000002" },
					]
				: [terminalStage];
		await expect(
			adapter.finalizeTerminal({
				...context,
				workflow: workflow(kind, {
					status: "approved",
					currentStageOrder: null,
					completedAt: finalizedAt,
					stages,
				}),
				dbService: { db: {} } as never,
				finalizationCause: "command",
				transition: {
					kind: "approve",
					from: "pending",
					to: "approved",
					reason: null,
				},
				finalizedAt,
			}),
		).rejects.toThrow(/compatibility/i);
		expect(finalizeTerminal).not.toHaveBeenCalled();
	});

	it("projects only sanitized work-period display fields and search text", async () => {
		const { adapter, context } = await loadedContext(kind);
		const projection = await adapter.projectDisplay(context);
		expect(projection.displayPayload).toEqual({
			kind,
			title:
				kind === "manual_time_submission"
					? "Manual time submission"
					: "Policy clock-out",
			startTime: "2026-07-20T06:00:00Z",
			endTime: "2026-07-20T14:00:00Z",
			durationMinutes: 480,
			approvalStatus: "pending",
		});
		expect(projection.searchText).not.toMatch(/private|org-1|[0-9a-f]{8}-/i);
	});
});

async function adapterCall(
	adapter: ReturnType<typeof createOrdinaryWorkPeriodApprovalAdapter>,
	context: Parameters<typeof adapter.getTrustedCapabilities>[0],
) {
	await adapter.getTrustedCapabilities(context);
}
