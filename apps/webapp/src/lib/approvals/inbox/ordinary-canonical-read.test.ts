import { PgDialect, type SQL } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
	countOrdinaryCanonicalApprovals,
	loadOrdinaryCanonicalApprovals,
	type OrdinaryCanonicalReadRow,
	selectOrdinaryCanonicalApprovals,
} from "./ordinary-canonical-read";

const ids = {
	organization: "org-1",
	workflow: "10000000-0000-4000-8000-000000000001",
	stage: "20000000-0000-4000-8000-000000000001",
	assignment: "30000000-0000-4000-8000-000000000001",
	projection: "40000000-0000-4000-8000-000000000001",
	period: "50000000-0000-4000-8000-000000000001",
	record: "60000000-0000-4000-8000-000000000001",
	requester: "70000000-0000-4000-8000-000000000001",
	approver: "80000000-0000-4000-8000-000000000001",
	compatibility: "90000000-0000-4000-8000-000000000001",
};

const policySnapshot = {
	version: 1,
	evaluatedAt: "2026-07-20T14:00:00Z",
	resolution: "work_policy",
	teamId: null,
	assignment: {
		id: "91000000-0000-4000-8000-000000000001",
		type: "employee",
	},
	policy: {
		id: "92000000-0000-4000-8000-000000000001",
		name: "Private break policy",
	},
	regulationEnabled: false,
	regulation: {
		id: null,
		name: null,
		maxUninterruptedMinutes: null,
	},
	breakRules: [],
} as const;

function row(
	overrides: Partial<OrdinaryCanonicalReadRow> = {},
): OrdinaryCanonicalReadRow {
	return {
		projection: {
			id: ids.projection,
			organizationId: ids.organization,
			workflowId: ids.workflow,
			activeStageId: ids.stage,
			sourceType: "time_entry",
			sourceId: ids.period,
			status: "pending",
			displayPayload: {
				kind: "manual_time_submission",
				title: "Manual time submission",
				startTime: "2026-07-20T06:00:00Z",
				endTime: "2026-07-20T14:00:00Z",
				durationMinutes: 480,
				approvalStatus: "pending",
				stage: { name: "Manager review", order: 2 },
			},
			searchText:
				"manual time submission 2026-07-20t06:00:00z 2026-07-20t14:00:00z manager review",
			createdAt: new Date("2026-07-20T14:05:00Z"),
		},
		workflow: {
			id: ids.workflow,
			organizationId: ids.organization,
			workflowType: "manual_time_submission",
			sourceType: "time_entry",
			sourceId: ids.period,
			requesterEmployeeId: ids.requester,
			status: "pending",
			currentStageOrder: 2,
			contextSnapshot: { timeRequest: { kind: "manual_time_submission" } },
			submittedAt: new Date("2026-07-20T14:05:00Z"),
		},
		stage: {
			id: ids.stage,
			organizationId: ids.organization,
			workflowId: ids.workflow,
			sequence: 2,
			label: "Manager review",
			status: "pending",
			legacyApprovalRequestId: null,
		},
		assignment: {
			id: ids.assignment,
			organizationId: ids.organization,
			workflowId: ids.workflow,
			stageId: ids.stage,
			approverEmployeeId: ids.approver,
			status: "pending",
			assignedAt: new Date("2026-07-20T14:05:00Z"),
		},
		requester: {
			id: ids.requester,
			organizationId: ids.organization,
			userId: "user-requester",
			teamId: "team-1",
			user: {
				id: "user-requester",
				name: "Avery Employee",
				email: "avery@example.com",
				image: null,
			},
		},
		period: {
			id: ids.period,
			organizationId: ids.organization,
			employeeId: ids.requester,
			canonicalRecordId: ids.record,
			approvalWorkflowId: ids.workflow,
			approvalStatus: "pending",
			isActive: false,
			deletedAt: null,
			startTime: new Date("2026-07-20T06:00:00Z"),
			endTime: new Date("2026-07-20T14:00:00Z"),
			durationMinutes: 480,
			pendingChanges: { isManualEntry: true, privateNote: "do not expose" },
			employee: {
				id: ids.requester,
				organizationId: ids.organization,
				userId: "user-requester",
				user: {
					id: "user-requester",
					name: "Avery Employee",
					email: "avery@example.com",
					image: null,
				},
			},
			clockIn: {
				id: "a0000000-0000-4000-8000-000000000001",
				organizationId: ids.organization,
				employeeId: ids.requester,
				type: "clock_in",
				timestamp: new Date("2026-07-20T06:00:00Z"),
				utcOffsetMinutes: 120,
				isSuperseded: false,
				supersededById: null,
				replacesEntryId: null,
			},
			clockOut: {
				id: "a0000000-0000-4000-8000-000000000002",
				organizationId: ids.organization,
				employeeId: ids.requester,
				type: "clock_out",
				timestamp: new Date("2026-07-20T14:00:00Z"),
				utcOffsetMinutes: 120,
				isSuperseded: false,
				supersededById: null,
				replacesEntryId: null,
			},
		},
		canonicalRecord: {
			id: ids.record,
			organizationId: ids.organization,
			employeeId: ids.requester,
			recordKind: "work",
			startAt: new Date("2026-07-20T06:00:00Z"),
			endAt: new Date("2026-07-20T14:00:00Z"),
			durationMinutes: 480,
			approvalState: "pending",
		},
		compatibilityRequest: null,
		...overrides,
	};
}

function select(rows: OrdinaryCanonicalReadRow[], overrides = {}) {
	return selectOrdinaryCanonicalApprovals({
		rows,
		organizationId: ids.organization,
		approverId: ids.approver,
		now: new Date("2026-07-20T15:05:00Z"),
		...overrides,
	});
}

function policyRow(): OrdinaryCanonicalReadRow {
	const base = row();
	return row({
		projection: {
			...base.projection,
			displayPayload: {
				...(base.projection.displayPayload as Record<string, unknown>),
				kind: "policy_clock_out",
				title: "Policy clock-out",
			},
			searchText:
				"policy clock-out 2026-07-20t06:00:00z 2026-07-20t14:00:00z manager review",
		},
		workflow: {
			...base.workflow,
			workflowType: "policy_clock_out",
			contextSnapshot: {
				timeRequest: { kind: "policy_clock_out" },
				breakPolicySnapshot: policySnapshot,
			},
		},
		period: {
			...base.period,
			pendingChanges: {
				isNewClockOut: true,
				breakPolicySnapshot: policySnapshot,
			},
		},
	});
}

describe("ordinary canonical inbox reads", () => {
	it("loads N approvals with two bounded queries and SQL-side tenancy, kind, status, source, and visibility filters", async () => {
		const fixture = row();
		const candidate = {
			...fixture.projection,
			projectionId: fixture.projection.id,
			projectionOrganizationId: fixture.projection.organizationId,
			projectionWorkflowId: fixture.projection.workflowId,
			projectionStatus: fixture.projection.status,
			workflowId: fixture.workflow.id,
			workflowOrganizationId: fixture.workflow.organizationId,
			workflowType: fixture.workflow.workflowType,
			workflowSourceType: fixture.workflow.sourceType,
			workflowSourceId: fixture.workflow.sourceId,
			requesterEmployeeId: fixture.workflow.requesterEmployeeId,
			workflowStatus: fixture.workflow.status,
			currentStageOrder: fixture.workflow.currentStageOrder,
			contextSnapshot: fixture.workflow.contextSnapshot,
			submittedAt: fixture.workflow.submittedAt,
			stageId: fixture.stage.id,
			stageOrganizationId: fixture.stage.organizationId,
			stageWorkflowId: fixture.stage.workflowId,
			stageSequence: fixture.stage.sequence,
			stageLabel: fixture.stage.label,
			stageStatus: fixture.stage.status,
			legacyApprovalRequestId: ids.compatibility,
			assignmentId: fixture.assignment.id,
			assignmentOrganizationId: fixture.assignment.organizationId,
			assignmentWorkflowId: fixture.assignment.workflowId,
			assignmentStageId: fixture.assignment.stageId,
			approverEmployeeId: fixture.assignment.approverEmployeeId,
			assignmentStatus: fixture.assignment.status,
			assignedAt: fixture.assignment.assignedAt,
			requesterId: fixture.requester.id,
			requesterOrganizationId: fixture.requester.organizationId,
			requesterUserId: fixture.requester.userId,
			requesterTeamId: fixture.requester.teamId,
			userId: fixture.requester.user.id,
			userName: fixture.requester.user.name,
			userEmail: fixture.requester.user.email,
			userImage: fixture.requester.user.image,
			totalCount: 3,
		};
		const evidence = {
			...fixture.period,
			periodId: fixture.period.id,
			periodOrganizationId: fixture.period.organizationId,
			periodEmployeeId: fixture.period.employeeId,
			periodApprovalStatus: fixture.period.approvalStatus,
			periodStartTime: fixture.period.startTime,
			periodEndTime: fixture.period.endTime,
			periodDurationMinutes: fixture.period.durationMinutes,
			periodIsActive: fixture.period.isActive,
			periodDeletedAt: fixture.period.deletedAt,
			periodPendingChanges: fixture.period.pendingChanges,
			periodCanonicalRecordId: fixture.period.canonicalRecordId,
			periodApprovalWorkflowId: fixture.period.approvalWorkflowId,
			clockInId: fixture.period.clockIn?.id,
			clockInOrganizationId: fixture.period.clockIn?.organizationId,
			clockInEmployeeId: fixture.period.clockIn?.employeeId,
			clockInType: fixture.period.clockIn?.type,
			clockInTimestamp: fixture.period.clockIn?.timestamp,
			clockInUtcOffsetMinutes: fixture.period.clockIn?.utcOffsetMinutes,
			clockInIsSuperseded: fixture.period.clockIn?.isSuperseded,
			clockInSupersededById: fixture.period.clockIn?.supersededById,
			clockInReplacesEntryId: fixture.period.clockIn?.replacesEntryId,
			clockOutId: fixture.period.clockOut?.id,
			clockOutOrganizationId: fixture.period.clockOut?.organizationId,
			clockOutEmployeeId: fixture.period.clockOut?.employeeId,
			clockOutType: fixture.period.clockOut?.type,
			clockOutTimestamp: fixture.period.clockOut?.timestamp,
			clockOutUtcOffsetMinutes: fixture.period.clockOut?.utcOffsetMinutes,
			clockOutIsSuperseded: fixture.period.clockOut?.isSuperseded,
			clockOutSupersededById: fixture.period.clockOut?.supersededById,
			clockOutReplacesEntryId: fixture.period.clockOut?.replacesEntryId,
			canonicalId: fixture.canonicalRecord?.id,
			canonicalOrganizationId: fixture.canonicalRecord?.organizationId,
			canonicalEmployeeId: fixture.canonicalRecord?.employeeId,
			canonicalRecordKind: fixture.canonicalRecord?.recordKind,
			canonicalStartAt: fixture.canonicalRecord?.startAt,
			canonicalEndAt: fixture.canonicalRecord?.endAt,
			canonicalDurationMinutes: fixture.canonicalRecord?.durationMinutes,
			canonicalApprovalState: fixture.canonicalRecord?.approvalState,
		};
		const calls: SQL[] = [];
		const database = {
			execute: async (statement: SQL) => {
				calls.push(statement);
				return {
					rows:
						calls.length === 1
							? [candidate, candidate, candidate]
							: calls.length === 2
								? [evidence]
								: [],
				};
			},
		};

		const approvals = await loadOrdinaryCanonicalApprovals({
			database,
			organizationId: ids.organization,
			approverId: ids.approver,
			limit: 20,
		});

		expect(approvals).toHaveLength(3);
		expect(approvals.totalCount).toBe(3);
		expect(calls).toHaveLength(3);
		const [candidateQuery, evidenceQuery, compatibilityQuery] = calls.map(
			(statement) => new PgDialect().sqlToQuery(statement),
		);
		expect(candidateQuery?.sql).toMatch(
			/approval_inbox_projection[\s\S]+approval_workflow[\s\S]+approval_workflow_stage[\s\S]+approval_stage_assignment[\s\S]+employee[\s\S]+"user"/,
		);
		expect(candidateQuery?.sql).toContain("source_type = 'time_entry'");
		expect(candidateQuery?.sql).toContain(
			"workflow_type in ('manual_time_submission', 'policy_clock_out')",
		);
		for (const table of [
			"projection",
			"workflow",
			"stage",
			"assignment",
		] as const) {
			expect(candidateQuery?.sql).toContain(`${table}.status = 'pending'`);
		}
		expect(candidateQuery?.sql).toContain(
			"compatibility.approver_id = assignment.approver_employee_id",
		);
		expect(candidateQuery?.sql).not.toContain("jsonb_object_length");
		expect(candidateQuery?.sql).toContain("jsonb_typeof");
		expect(candidateQuery?.sql).toContain("jsonb_object_keys");
		expect(candidateQuery?.sql).toContain("breakPolicySnapshot");
		expect(candidateQuery?.sql).toContain("'version'");
		expect(candidateQuery?.sql).toContain("'resolution'");
		expect(candidateQuery?.params).toEqual(
			expect.arrayContaining([ids.organization, ids.approver, 20]),
		);
		expect(evidenceQuery?.sql).toContain("and period.id in (");
		expect(evidenceQuery?.params).toContain(ids.period);
		expect(compatibilityQuery?.sql).toContain("from approval_request");
		expect(compatibilityQuery?.sql).toContain("and id in (");
		expect(compatibilityQuery?.params).toContain(ids.compatibility);
	});

	it("discovers policy clock-out context while redacting immutable policy evidence", () => {
		const approvals = select([policyRow()]);

		expect(approvals).toHaveLength(1);
		expect(approvals[0]).toMatchObject({
			item: {
				summary: { title: "Clock-out Approval" },
			},
			decisionTarget: { workflowKind: "policy_clock_out" },
		});
		const serialized = JSON.stringify(approvals[0]);
		expect(serialized).not.toContain("breakPolicySnapshot");
		expect(serialized).not.toContain("Private break policy");
		expect(serialized).not.toContain(policySnapshot.policy.id);
	});

	it("suppresses policy canonical output only for exact snapshot-bearing compatibility ownership", () => {
		const fixture = policyRow();
		const compatibilityRequest = {
			id: ids.compatibility,
			organizationId: ids.organization,
			entityType: "time_entry",
			entityId: ids.period,
			requestedBy: ids.requester,
			approverId: ids.approver,
			status: "pending",
			metadata: {
				workflow: { id: ids.workflow, organizationId: ids.organization },
				stage: { id: ids.stage, sequence: 2 },
				timeRequest: { kind: "policy_clock_out" },
				breakPolicySnapshot: policySnapshot,
			},
		};
		const owned = policyRow();
		owned.stage = {
			...fixture.stage,
			legacyApprovalRequestId: ids.compatibility,
		};
		owned.compatibilityRequest = compatibilityRequest;
		expect(select([owned])).toEqual([]);

		owned.compatibilityRequest = {
			...compatibilityRequest,
			metadata: { ...compatibilityRequest.metadata, private: true },
		};
		expect(select([owned])).toHaveLength(1);

		owned.compatibilityRequest = {
			...compatibilityRequest,
			metadata: {
				...compatibilityRequest.metadata,
				breakPolicySnapshot: {
					version: 1,
					evaluatedAt: policySnapshot.evaluatedAt,
					resolution: "none",
				},
			},
		};
		expect(select([owned])).toHaveLength(1);
	});

	it("uses identical validity predicates for bounded list and aggregate count", async () => {
		const calls: SQL[] = [];
		const database = {
			execute: async (statement: SQL) => {
				calls.push(statement);
				return { rows: [] };
			},
		};
		const input = {
			database,
			organizationId: ids.organization,
			approverId: ids.approver,
		};

		await loadOrdinaryCanonicalApprovals(input);
		await countOrdinaryCanonicalApprovals(input);

		const [listSql, countSql] = calls.map(
			(statement) => new PgDialect().sqlToQuery(statement).sql,
		);
		const predicates = (value: string | undefined) =>
			value
				?.slice(
					value.indexOf("from approval_inbox_projection"),
					value.indexOf("order by"),
				)
				.trim();
		expect(predicates(listSql)).toBe(predicates(`${countSql} order by`));
		expect(countSql).toContain("pending_changes");
		expect(countSql).toContain("isManualEntry");
		expect(countSql).toContain("isNewClockOut");
		expect(countSql).not.toContain("jsonb_object_length");
	});

	it("applies every normalized list filter before cursor and limit in list and count SQL", async () => {
		const calls: SQL[] = [];
		const input = {
			database: {
				execute: async (statement: SQL) => {
					calls.push(statement);
					return { rows: [] };
				},
			},
			organizationId: ids.organization,
			approverId: ids.approver,
			now: new Date("2026-07-24T14:05:00Z"),
			filters: {
				teamId: "a0000000-0000-4000-8000-000000000001",
				priority: "high",
				minAgeDays: 2,
				dateRange: {
					from: new Date("2026-07-01T00:00:00Z"),
					to: new Date("2026-07-23T23:59:59Z"),
				},
				search: "avery 100%_safe",
			},
			cursor: {
				riskLevel: "high",
				priority: "high",
				createdAt: "2026-07-20T14:05:00.000Z",
				id: ids.assignment,
			},
			limit: 3,
		};

		await loadOrdinaryCanonicalApprovals(
			input as unknown as Parameters<typeof loadOrdinaryCanonicalApprovals>[0],
		);
		const { cursor: _cursor, limit: _limit, ...countInput } = input;
		await countOrdinaryCanonicalApprovals(
			countInput as unknown as Parameters<
				typeof countOrdinaryCanonicalApprovals
			>[0],
		);

		const [list, count] = calls.map((statement) =>
			new PgDialect().sqlToQuery(statement),
		);
		for (const fragment of [
			"requester.team_id",
			"strpos(lower(requester_user.name)",
			"interval '1 day'",
			"workflow.submitted_at >=",
			"workflow.submitted_at <=",
		]) {
			expect(list?.sql.indexOf(fragment)).toBeGreaterThan(0);
			expect(list?.sql.indexOf(fragment)).toBeLessThan(
				list?.sql.indexOf("order by") ?? -1,
			);
			expect(count?.sql).toContain(fragment);
		}
		expect(list?.sql).toContain("case\n\t\twhen workflow.submitted_at");
		expect(list?.params).toEqual(
			expect.arrayContaining([
				"a0000000-0000-4000-8000-000000000001",
				"avery 100%_safe",
				2,
				new Date("2026-07-01T00:00:00Z"),
				new Date("2026-07-23T23:59:59Z"),
			]),
		);
	});

	it("seeks and orders bounded rows by the public risk and priority tuple", async () => {
		const calls: SQL[] = [];
		await loadOrdinaryCanonicalApprovals({
			database: {
				execute: async (statement: SQL) => {
					calls.push(statement);
					return { rows: [] };
				},
			},
			organizationId: ids.organization,
			approverId: ids.approver,
			now: new Date("2026-07-24T14:05:00Z"),
			cursor: {
				riskLevel: "high",
				priority: "urgent",
				createdAt: "2026-07-20T14:05:00.000Z",
				id: ids.assignment,
			},
		});

		const query = new PgDialect().sqlToQuery(calls[0] as SQL);
		expect(query.sql).toContain("interval '3 days'");
		expect(query.sql).toContain("interval '72 hours'");
		expect(query.sql).toMatch(
			/order by case when workflow\.submitted_at.*case\s+when workflow\.submitted_at.*workflow\.submitted_at, assignment\.id limit/s,
		);
		expect(query.params).toEqual(
			expect.arrayContaining([
				0,
				new Date("2026-07-20T14:05:00.000Z"),
				ids.assignment,
			]),
		);
	});

	it("derives canonical priority from the same age thresholds used by ordinary compatibility rows", () => {
		const [approval] = select([row()], {
			now: new Date("2026-07-23T15:05:01Z"),
		});

		expect(approval?.item.triage).toMatchObject({
			priority: "urgent",
			riskLevel: "high",
		});
	});

	it("constrains exact target reads by assignment id with a one-row bound", async () => {
		const calls: SQL[] = [];
		const database = {
			execute: async (statement: SQL) => {
				calls.push(statement);
				return { rows: [] };
			},
		};

		await loadOrdinaryCanonicalApprovals({
			database,
			organizationId: ids.organization,
			approverId: ids.approver,
			assignmentId: ids.assignment,
		});

		expect(calls).toHaveLength(1);
		const query = new PgDialect().sqlToQuery(calls[0] as SQL);
		expect(query.sql).toContain("assignment.id =");
		expect(query.params).toEqual(expect.arrayContaining([ids.assignment, 1]));
	});

	it("uses the active assignment as the stable public target", () => {
		const [approval] = select([row()]);

		expect(approval?.item).toMatchObject({
			id: ids.assignment,
			type: "time_entry",
			entityId: ids.assignment,
			status: "pending",
			requester: { id: ids.requester, name: "Avery Employee" },
			summary: {
				title: "Manual Time Submission",
				detail: "8h on Jul 20, 2026",
				stage: { name: "Manager review", order: 2 },
			},
		});
		expect(approval?.decisionTarget).toEqual({
			id: ids.assignment,
			targetType: "canonical_assignment",
			entityType: "time_entry",
			entityId: ids.period,
			organizationId: ids.organization,
			approverId: ids.approver,
			requesterEmployeeId: ids.requester,
			status: "pending",
			workflowKind: "manual_time_submission",
		});
	});

	it("allows only assigned, organization-wide, or exact eligible-scope visibility", () => {
		expect(select([row()], { approverId: "other" })).toEqual([]);
		expect(
			select([row()], {
				approverId: "eligible-manager",
				eligibleApprovalScopes: [
					{
						requesterEmployeeId: ids.requester,
						eligibleApproverIds: [ids.approver, "eligible-manager"],
					},
				],
			}),
		).toHaveLength(1);
		expect(
			select([row()], {
				approverId: "eligible-manager",
				eligibleApprovalScopes: [
					{
						requesterEmployeeId: "other-requester",
						eligibleApproverIds: [ids.approver, "eligible-manager"],
					},
				],
			}),
		).toEqual([]);
		expect(
			select([row()], { approverId: "admin", includeAllApprovers: true }),
		).toHaveLength(1);
	});

	it("suppresses fallback only for exact active-stage compatibility ownership", () => {
		const compatibilityRequest = {
			id: ids.compatibility,
			organizationId: ids.organization,
			entityType: "time_entry",
			entityId: ids.period,
			requestedBy: ids.requester,
			approverId: ids.approver,
			status: "pending",
			metadata: {
				workflow: { id: ids.workflow, organizationId: ids.organization },
				stage: { id: ids.stage, sequence: 2 },
				timeRequest: { kind: "manual_time_submission" },
			},
		};
		expect(
			select([
				row({
					stage: { ...row().stage, legacyApprovalRequestId: ids.compatibility },
					compatibilityRequest,
				}),
			]),
		).toEqual([]);
		expect(
			select([
				row({
					stage: { ...row().stage, legacyApprovalRequestId: ids.compatibility },
					compatibilityRequest: {
						...compatibilityRequest,
						metadata: {
							...compatibilityRequest.metadata,
							stage: { id: "moved-stage", sequence: 2 },
						},
					},
				}),
			]),
		).toHaveLength(1);
	});

	it.each([
		["foreign", "80000000-0000-4000-8000-000000000099"],
		["wrong", ids.requester],
		["null", null],
	] as const)("does not suppress the canonical item for a %s compatibility approver", (_name, compatibilityApproverId) => {
		const compatibilityRequest = {
			id: ids.compatibility,
			organizationId: ids.organization,
			entityType: "time_entry",
			entityId: ids.period,
			requestedBy: ids.requester,
			approverId: compatibilityApproverId,
			status: "pending",
			metadata: {
				workflow: { id: ids.workflow, organizationId: ids.organization },
				stage: { id: ids.stage, sequence: 2 },
				timeRequest: { kind: "manual_time_submission" },
			},
		};

		expect(
			select([
				row({
					stage: {
						...row().stage,
						legacyApprovalRequestId: ids.compatibility,
					},
					compatibilityRequest,
				}),
			]),
		).toHaveLength(1);
	});

	it.each([
		[
			"foreign projection",
			() =>
				row({ projection: { ...row().projection, organizationId: "foreign" } }),
		],
		[
			"waiting stage",
			() => row({ stage: { ...row().stage, status: "waiting" } }),
		],
		[
			"terminal workflow",
			() => row({ workflow: { ...row().workflow, status: "approved" } }),
		],
		[
			"moved source",
			() => row({ period: { ...row().period, approvalWorkflowId: "moved" } }),
		],
		[
			"projection parity",
			() =>
				row({ projection: { ...row().projection, activeStageId: "moved" } }),
		],
		[
			"assignment parity",
			() => row({ assignment: { ...row().assignment, stageId: "moved" } }),
		],
		[
			"wrong kind",
			() =>
				row({
					workflow: { ...row().workflow, workflowType: "time_correction" },
				}),
		],
		[
			"malformed context",
			() =>
				row({
					workflow: {
						...row().workflow,
						contextSnapshot: {
							timeRequest: { kind: "manual_time_submission", private: true },
						},
					},
				}),
		],
		[
			"requester mismatch",
			() => row({ requester: { ...row().requester, id: "other" } }),
		],
		[
			"canonical parity",
			() =>
				row({
					canonicalRecord: { ...row().canonicalRecord, durationMinutes: 479 },
				}),
		],
		[
			"malformed projected title",
			() =>
				row({
					projection: {
						...row().projection,
						displayPayload: {
							...(row().projection.displayPayload as Record<string, unknown>),
							title: "Private payroll investigation",
						},
					},
				}),
		],
		[
			"private projected search injection",
			() =>
				row({
					projection: {
						...row().projection,
						searchText: `${row().projection.searchText} private policy evidence`,
					},
				}),
		],
		[
			"stale projected range",
			() =>
				row({
					projection: {
						...row().projection,
						displayPayload: {
							...(row().projection.displayPayload as Record<string, unknown>),
							endTime: "2026-07-20T13:00:00Z",
						},
					},
				}),
		],
		[
			"stale projected duration",
			() =>
				row({
					projection: {
						...row().projection,
						displayPayload: {
							...(row().projection.displayPayload as Record<string, unknown>),
							durationMinutes: 479,
						},
					},
				}),
		],
		[
			"stale projected status",
			() =>
				row({
					projection: {
						...row().projection,
						displayPayload: {
							...(row().projection.displayPayload as Record<string, unknown>),
							approvalStatus: "approved",
						},
					},
				}),
		],
		[
			"stale projected stage",
			() =>
				row({
					projection: {
						...row().projection,
						displayPayload: {
							...(row().projection.displayPayload as Record<string, unknown>),
							stage: { name: "Previous review", order: 1 },
						},
					},
				}),
		],
	] as const)("fails closed for %s", (_name, makeRow) => {
		expect(select([makeRow()])).toEqual([]);
	});

	it("returns only allowlisted display and timeline data", () => {
		const [approval] = select([row()]);
		const payload = JSON.stringify({
			item: approval?.item,
			detail: approval?.detail,
		});

		expect(payload).not.toContain("privateNote");
		expect(payload).not.toContain("do not expose");
		expect(payload).not.toContain(ids.workflow);
		expect(payload).not.toContain(ids.projection);
		expect(payload).not.toContain(ids.period);
		expect(payload).not.toContain(ids.record);
		expect(approval?.detail.sections).toEqual([
			{
				type: "key_value",
				title: "Request",
				rows: [
					{ label: "Type", value: "Manual Time Submission" },
					{ label: "Range", value: "Jul 20, 2026 - 08:00 to 16:00" },
					{ label: "Duration", value: "8h" },
					{ label: "Status", value: "pending" },
					{ label: "Stage", value: "Manager review (2)" },
				],
			},
			{
				type: "timeline",
				title: "Timeline",
				events: [
					{
						id: "timeline-created-1",
						label: "Avery Employee requested manual time submission",
						at: "2026-07-20T14:05:00.000Z",
						actorName: "Avery Employee",
					},
				],
			},
		]);
	});

	it("does not search private context, source evidence, or internal identifiers", () => {
		expect(select([row()], { search: "do not expose" })).toEqual([]);
		expect(select([row()], { search: ids.workflow })).toEqual([]);
		expect(select([row()], { search: "avery" })).toHaveLength(1);
		expect(select([row()], { search: "manager review" })).toHaveLength(1);
	});
});
