import { describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type {
	ApprovalEventActorIdentity,
	ApprovalWorkflowSnapshot,
} from "../workflow/ports";
import {
	AbsenceApprovalAdapterError,
	type AbsenceApprovalSource,
	createAbsenceApprovalAdapter,
} from "./absence.adapter";
import { createProductionApprovalDomainAdapterRegistry } from "./production-registry";

const organizationId = "org-1";
const workflowId = "10000000-0000-4000-8000-000000000001";
const absenceId = "20000000-0000-4000-8000-000000000001";
const employeeId = "30000000-0000-4000-8000-000000000001";
const categoryId = "40000000-0000-4000-8000-000000000001";
const canonicalRecordId = "50000000-0000-4000-8000-000000000001";
const teamId = "60000000-0000-4000-8000-000000000001";
const now = parseInstant("2026-07-18T22:30:00Z");

const actor: ApprovalEventActorIdentity = {
	kind: "employee",
	employeeId,
	userId: "user-1",
};

function workflow(
	status: "pending" | "approved" | "rejected" | "cancelled" = "pending",
) {
	return {
		id: workflowId,
		organizationId,
		workflowType: "absence",
		sourceType: "absence_entry",
		sourceId: absenceId,
		requesterEmployeeId: employeeId,
		status,
	} as ApprovalWorkflowSnapshot;
}

function rows() {
	return {
		absence: {
			id: absenceId,
			organizationId,
			employeeId,
			categoryId,
			canonicalRecordId,
			approvalWorkflowId: workflowId,
			startDate: "2026-07-20",
			startPeriod: "full_day" as const,
			endDate: "2026-07-21",
			endPeriod: "full_day" as const,
			status: "pending" as "pending" | "approved" | "rejected",
			notes: "Family trip",
			sickDetail: "with_certificate",
			approvedBy: null as string | null,
			approvedAt: null,
			rejectionReason: null,
		},
		employee: {
			id: employeeId,
			organizationId,
			userId: "user-1",
			teamId,
			user: { id: "user-1", name: "Avery Example" },
		},
		category: {
			id: categoryId,
			organizationId,
			name: "Vacation",
			type: "vacation",
			color: "#123456",
		},
		teamMembership: { organizationId, employeeId, teamId },
		canonicalRecord: {
			id: canonicalRecordId,
			organizationId,
			employeeId,
			recordKind: "absence",
		},
		canonicalAbsence: {
			recordId: canonicalRecordId,
			organizationId,
			recordKind: "absence",
			absenceCategoryId: categoryId,
		},
		organization: { id: organizationId, timezone: "Europe/Berlin" },
	};
}

function dbService(fixture = rows()) {
	const transaction = vi.fn();
	return {
		db: {
			transaction,
			query: {
				absenceEntry: { findFirst: vi.fn().mockResolvedValue(fixture.absence) },
				employee: { findFirst: vi.fn().mockResolvedValue(fixture.employee) },
				absenceCategory: {
					findFirst: vi.fn().mockResolvedValue(fixture.category),
				},
				teamMembership: {
					findFirst: vi.fn().mockResolvedValue(fixture.teamMembership),
				},
				timeRecord: {
					findFirst: vi.fn().mockResolvedValue(fixture.canonicalRecord),
				},
				timeRecordAbsence: {
					findFirst: vi.fn().mockResolvedValue(fixture.canonicalAbsence),
				},
				organization: {
					findFirst: vi.fn().mockResolvedValue(fixture.organization),
				},
			},
		},
		transaction,
	} as never;
}

function dependencies() {
	return {
		clock: { nowInstant: () => now },
		finalizeAbsenceTerminal: vi
			.fn()
			.mockResolvedValue({ absence: { status: "approved" } }),
		deleteCancelledAbsence: vi.fn().mockResolvedValue(undefined),
	};
}

async function load(fixture = rows()) {
	const adapter = createAbsenceApprovalAdapter(dependencies());
	const service = dbService(fixture);
	const source = await adapter.loadSource({
		dbService: service,
		organizationId,
		workflow: workflow(),
		sourceIdentity: {
			organizationId,
			workflowType: "absence",
			sourceType: "absence_entry",
			sourceId: absenceId,
		},
		actor,
	});
	return { adapter, service, source: source as AbsenceApprovalSource };
}

describe("absence approval adapter", () => {
	it("loads the exact scoped source without opening a transaction and returns exact routing", async () => {
		const { adapter, service, source } = await load();

		expect(adapter.workflowType).toBe("absence");
		expect(adapter.sourceType).toBe("absence_entry");
		expect(source.requesterUserId).toBe("user-1");
		expect(service.transaction).not.toHaveBeenCalled();
		expect(
			await adapter.produceRoutingContext({
				organizationId,
				workflow: workflow(),
				sourceIdentity: workflow(),
				source,
				actor,
			}),
		).toEqual({
			organizationId,
			workflowType: "absence",
			sourceType: "absence_entry",
			sourceId: absenceId,
			requesterEmployeeId: employeeId,
			teamIds: [teamId],
			locationId: null,
			absenceCategoryId: categoryId,
			travelExpenseAmount: null,
			overtimeRisk: null,
			employeeGroupIds: [],
		});
	});

	it.each([
		[
			"source",
			(value: ReturnType<typeof rows>) =>
				(value.absence.organizationId = "org-2"),
		],
		[
			"requester",
			(value: ReturnType<typeof rows>) =>
				(value.employee.organizationId = "org-2"),
		],
		[
			"requester link",
			(value: ReturnType<typeof rows>) => (value.employee.id = "employee-2"),
		],
		[
			"requester user link",
			(value: ReturnType<typeof rows>) =>
				(value.employee.user.id = "foreign-user"),
		],
		[
			"missing requester user identity",
			(value: ReturnType<typeof rows>) => (value.employee.userId = ""),
		],
		[
			"category",
			(value: ReturnType<typeof rows>) =>
				(value.category.organizationId = "org-2"),
		],
		[
			"category link",
			(value: ReturnType<typeof rows>) => (value.category.id = "category-2"),
		],
		[
			"team membership",
			(value: ReturnType<typeof rows>) =>
				(value.teamMembership.organizationId = "org-2"),
		],
		[
			"team membership link",
			(value: ReturnType<typeof rows>) =>
				(value.teamMembership.teamId = "team-2"),
		],
		[
			"team employee link",
			(value: ReturnType<typeof rows>) =>
				(value.teamMembership.employeeId = "employee-2"),
		],
		[
			"canonical record",
			(value: ReturnType<typeof rows>) =>
				(value.canonicalRecord.organizationId = "org-2"),
		],
		[
			"canonical record link",
			(value: ReturnType<typeof rows>) =>
				(value.canonicalRecord.id = "canonical-2"),
		],
		[
			"canonical employee link",
			(value: ReturnType<typeof rows>) =>
				(value.canonicalRecord.employeeId = "employee-2"),
		],
		[
			"canonical absence",
			(value: ReturnType<typeof rows>) =>
				(value.canonicalAbsence.organizationId = "org-2"),
		],
		[
			"canonical absence record link",
			(value: ReturnType<typeof rows>) =>
				(value.canonicalAbsence.recordId = "canonical-2"),
		],
		[
			"canonical category link",
			(value: ReturnType<typeof rows>) =>
				(value.canonicalAbsence.absenceCategoryId = "category-2"),
		],
		[
			"organization timezone",
			(value: ReturnType<typeof rows>) => (value.organization.id = "org-2"),
		],
		[
			"invalid organization timezone",
			(value: ReturnType<typeof rows>) =>
				(value.organization.timezone = "Not/A_Timezone"),
		],
		[
			"workflow link",
			(value: ReturnType<typeof rows>) =>
				(value.absence.approvalWorkflowId = "workflow-2"),
		],
	])("rejects a foreign or mismatched %s identity", async (_label, mutate) => {
		const fixture = rows();
		mutate(fixture);
		await expect(load(fixture)).rejects.toBeInstanceOf(
			AbsenceApprovalAdapterError,
		);
	});

	it("delegates approve and reject terminal mutations exactly once with the supplied transaction", async () => {
		const deps = dependencies();
		const adapter = createAbsenceApprovalAdapter(deps);
		const { source, service } = await load();
		const managerActor = {
			kind: "employee" as const,
			employeeId: "manager-employee",
			userId: "manager-user",
		};
		const base = {
			dbService: service,
			organizationId,
			source,
			actor: managerActor,
			finalizationCause: "command" as const,
			finalizedAt: now,
		};

		const approved = await adapter.finalizeTerminal({
			...base,
			workflow: workflow("approved"),
			sourceIdentity: workflow("approved"),
			transition: {
				kind: "approve",
				from: "pending",
				to: "approved",
				reason: null,
			},
		});
		const rejected = await adapter.finalizeTerminal({
			...base,
			workflow: workflow("rejected"),
			sourceIdentity: workflow("rejected"),
			transition: {
				kind: "reject",
				from: "pending",
				to: "rejected",
				reason: "No balance",
			},
		});

		expect(deps.finalizeAbsenceTerminal).toHaveBeenCalledTimes(2);
		expect(deps.finalizeAbsenceTerminal).toHaveBeenNthCalledWith(1, {
			dbService: service,
			organizationId,
			absenceId,
			expectedApprovalWorkflowId: workflowId,
			expectedCanonicalRecordId: canonicalRecordId,
			actorEmployeeId: managerActor.employeeId,
			actorUserId: managerActor.userId,
			finalizedAt: now,
			transition: { kind: "approve" },
		});
		expect(deps.finalizeAbsenceTerminal).toHaveBeenNthCalledWith(2, {
			dbService: service,
			organizationId,
			absenceId,
			expectedApprovalWorkflowId: workflowId,
			expectedCanonicalRecordId: canonicalRecordId,
			actorEmployeeId: managerActor.employeeId,
			actorUserId: managerActor.userId,
			finalizedAt: now,
			transition: { kind: "reject", reason: "No balance" },
		});
		expect(approved).toEqual({
			organizationId,
			workflowId,
			sourceIdentity: {
				organizationId,
				workflowType: "absence",
				sourceType: "absence_entry",
				sourceId: absenceId,
			},
			transitionKind: "approve",
			terminalStatus: "approved",
			sourceSnapshot: expect.objectContaining({
				id: absenceId,
				status: "approved",
			}),
			eventPayload: { absenceId, status: "approved" },
			compatibilityPayload: {
				entityId: absenceId,
				entityType: "absence_entry",
				status: "approved",
			},
			finalizedAt: now,
		});
		expect(rejected).toEqual({
			organizationId,
			workflowId,
			sourceIdentity: {
				organizationId,
				workflowType: "absence",
				sourceType: "absence_entry",
				sourceId: absenceId,
			},
			transitionKind: "reject",
			terminalStatus: "rejected",
			sourceSnapshot: expect.objectContaining({
				id: absenceId,
				status: "rejected",
			}),
			eventPayload: { absenceId, status: "rejected" },
			compatibilityPayload: {
				entityId: absenceId,
				entityType: "absence_entry",
				status: "rejected",
			},
			finalizedAt: now,
		});
		expect(service.transaction).not.toHaveBeenCalled();
	});

	it("documents the terminal-only adapter contract by rejecting incompatible source state in preflight", async () => {
		const deps = dependencies();
		const adapter = createAbsenceApprovalAdapter(deps);
		const { source, service } = await load();
		const input = {
			dbService: service,
			organizationId,
			workflow: workflow(),
			sourceIdentity: workflow(),
			source: { ...source, status: "approved" as const },
			actor,
			finalizationCause: "command",
			transition: {
				kind: "approve",
				from: "pending",
				to: "approved",
				reason: null,
			} as const,
			finalizedAt: now,
		};

		await expect(adapter.preflightTerminal(input)).rejects.toThrow(/state/i);
		expect(deps.finalizeAbsenceTerminal).not.toHaveBeenCalled();
	});

	it("finalizes requester-auto approval from a pending source with the resulting approved workflow", async () => {
		const deps = dependencies();
		const adapter = createAbsenceApprovalAdapter(deps);
		const { source, service } = await load();
		const resultingWorkflow = workflow("approved");

		const result = await adapter.finalizeTerminal({
			dbService: service,
			organizationId,
			workflow: resultingWorkflow,
			sourceIdentity: resultingWorkflow,
			source,
			actor: { kind: "system", employeeId: null, userId: null },
			finalizationCause: "activation",
			transition: {
				kind: "approve",
				from: "pending",
				to: "approved",
				reason: null,
			},
			finalizedAt: now,
		});

		expect(deps.finalizeAbsenceTerminal).toHaveBeenCalledOnce();
		expect(deps.finalizeAbsenceTerminal).toHaveBeenCalledWith(
			expect.objectContaining({
				actorEmployeeId: employeeId,
				actorUserId: "user-1",
				transition: { kind: "approve" },
			}),
		);
		expect(result).toEqual(
			expect.objectContaining({
				transitionKind: "approve",
				terminalStatus: "approved",
			}),
		);
	});

	it.each([
		{
			description: "reject",
			transition: {
				kind: "reject",
				from: "pending",
				to: "rejected",
				reason: "not allowed",
			},
			resultingStatus: "rejected" as const,
		},
		{
			description: "cancel",
			transition: {
				kind: "cancel_pending",
				from: "pending",
				to: "cancelled",
				reason: "not allowed",
			},
			resultingStatus: "cancelled" as const,
		},
	])("rejects activation system actor delegation for $description", async ({
		transition,
		resultingStatus,
	}) => {
		const deps = dependencies();
		const adapter = createAbsenceApprovalAdapter(deps);
		const { source, service } = await load();

		await expect(
			adapter.finalizeTerminal({
				dbService: service,
				organizationId,
				workflow: workflow(resultingStatus),
				sourceIdentity: workflow(resultingStatus),
				source,
				actor: { kind: "system", employeeId: null, userId: null },
				finalizationCause: "activation",
				transition,
				finalizedAt: now,
			} as never),
		).rejects.toThrow(/employee actor/i);
		expect(deps.finalizeAbsenceTerminal).not.toHaveBeenCalled();
		expect(deps.deleteCancelledAbsence).not.toHaveBeenCalled();
	});

	it("rejects an arbitrary system terminal approval outside activation", async () => {
		const deps = dependencies();
		const adapter = createAbsenceApprovalAdapter(deps);
		const { source, service } = await load();

		await expect(
			adapter.finalizeTerminal({
				dbService: service,
				organizationId,
				workflow: workflow("approved"),
				sourceIdentity: workflow("approved"),
				source,
				actor: { kind: "system", employeeId: null, userId: null },
				finalizationCause: "command",
				transition: {
					kind: "approve",
					from: "pending",
					to: "approved",
					reason: null,
				},
				finalizedAt: now,
			} as never),
		).rejects.toThrow(/employee actor/i);
		expect(deps.finalizeAbsenceTerminal).not.toHaveBeenCalled();
	});

	it("delegates pending and approved cancellation to the scoped delete callback", async () => {
		const deps = dependencies();
		const adapter = createAbsenceApprovalAdapter(deps);
		const { source, service } = await load();
		const cancelledWorkflow = workflow("cancelled");
		const pendingCancellation = await adapter.finalizeTerminal({
			dbService: service,
			organizationId,
			workflow: cancelledWorkflow,
			sourceIdentity: cancelledWorkflow,
			source,
			actor,
			finalizationCause: "command",
			transition: {
				kind: "cancel_pending",
				from: "pending",
				to: "cancelled",
				reason: null,
			},
			finalizedAt: now,
		});

		expect(deps.deleteCancelledAbsence).toHaveBeenCalledWith({
			dbService: service,
			organizationId,
			absenceId,
			expectedApprovalWorkflowId: workflowId,
			expectedCanonicalRecordId: canonicalRecordId,
			expectedEmployeeId: employeeId,
			expectedStatus: "pending",
			actorEmployeeId: employeeId,
			actorUserId: "user-1",
			finalizedAt: now,
		});
		expect(pendingCancellation).toEqual(
			expect.objectContaining({
				transitionKind: "cancel_pending",
				terminalStatus: "cancelled",
				eventPayload: { absenceId, status: "cancelled" },
				compatibilityPayload: {
					entityId: absenceId,
					entityType: "absence_entry",
					status: "cancelled",
				},
			}),
		);

		const approvedSource = {
			...source,
			status: "approved" as const,
			approvedBy: employeeId,
		};
		const approvedWorkflow = workflow("approved");
		const approvedContext = {
			organizationId,
			workflow: approvedWorkflow,
			sourceIdentity: approvedWorkflow,
			source: approvedSource,
			actor,
			finalizationCause: "command",
		};
		const registry = createProductionApprovalDomainAdapterRegistry({
			absence: adapter,
			timeCorrection: {
				workflowType: "time_correction",
				sourceType: "time_entry",
			} as never,
			manualTimeSubmission: {
				workflowType: "manual_time_submission",
				sourceType: "time_entry",
			} as never,
			policyClockOut: {
				workflowType: "policy_clock_out",
				sourceType: "time_entry",
			} as never,
		});
		const authorization =
			await registry.authorizeApprovedCancellation(approvedContext);
		const approvedCancellation = await adapter.finalizeTerminal({
			...approvedContext,
			workflow: cancelledWorkflow,
			sourceIdentity: cancelledWorkflow,
			dbService: service,
			transition: {
				kind: "cancel_approved",
				from: "approved",
				to: "cancelled",
				reason: null,
				authorization,
			},
			finalizedAt: now,
		});
		expect(deps.deleteCancelledAbsence).toHaveBeenLastCalledWith({
			dbService: service,
			organizationId,
			absenceId,
			expectedApprovalWorkflowId: workflowId,
			expectedCanonicalRecordId: canonicalRecordId,
			expectedEmployeeId: employeeId,
			expectedStatus: "approved",
			actorEmployeeId: employeeId,
			actorUserId: "user-1",
			finalizedAt: now,
		});
		expect(approvedCancellation).toEqual(
			expect.objectContaining({
				transitionKind: "cancel_approved",
				terminalStatus: "cancelled",
				sourceIdentity: {
					organizationId,
					workflowType: "absence",
					sourceType: "absence_entry",
					sourceId: absenceId,
				},
			}),
		);
	});

	it("authorizes approved cancellation only for the owner before the organization-local start date", async () => {
		const { adapter, source } = await load();
		const approved = {
			...source,
			status: "approved" as const,
			approvedBy: employeeId,
		};
		const context = {
			organizationId,
			workflow: workflow("approved"),
			sourceIdentity: workflow("approved"),
			source: approved,
			actor,
		};

		await expect(adapter.getTrustedCapabilities(context)).resolves.toEqual({
			canCancelAfterApproval: true,
		});
		await expect(
			adapter.getTrustedCapabilities({
				...context,
				source: { ...approved, startDate: "2026-07-19" },
			}),
		).resolves.toEqual({ canCancelAfterApproval: false });
		await expect(
			adapter.getTrustedCapabilities({
				...context,
				actor: {
					kind: "employee",
					employeeId: "manager-1",
					userId: "manager-user",
				},
			}),
		).resolves.toEqual({ canCancelAfterApproval: false });
		await expect(
			adapter.getTrustedCapabilities({
				...context,
				actor: { kind: "system", employeeId: null, userId: null },
			}),
		).resolves.toEqual({ canCancelAfterApproval: false });
	});

	it("produces stable non-sensitive display data without aliases", async () => {
		const { adapter, source } = await load();
		const context = {
			organizationId,
			workflow: workflow(),
			sourceIdentity: workflow(),
			source,
			actor,
		};
		const first = await adapter.projectDisplay(context);
		const second = await adapter.projectDisplay(context);

		expect(first).toEqual(second);
		expect(first).toEqual({
			displayPayload: {
				requesterEmployeeId: employeeId,
				requesterName: "Avery Example",
				categoryId,
				categoryName: "Vacation",
				categoryColor: "#123456",
				startDate: "2026-07-20",
				startPeriod: "full_day",
				endDate: "2026-07-21",
				endPeriod: "full_day",
				status: "pending",
			},
			searchText: "avery example vacation 2026-07-20 2026-07-21",
		});
		expect(JSON.stringify(first)).not.toContain("sickDetail");
		expect(first.displayPayload).not.toBe(source);
	});
});
