import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	absenceCategory,
	absenceEntry,
	approvalInboxProjection,
	approvalRequest,
	approvalStageAssignment,
	approvalWorkflow,
	approvalWorkflowRollout,
	approvalWorkflowStage,
	timeEntry,
	timeRecord,
	timeRecordAbsence,
	workPeriod,
} from "@/db/schema";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	DatabaseService,
	makeDatabaseService,
} from "@/lib/effect/services/database.service";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { buildAbsenceSubmittedFacts } from "../evidence/absence-facts";
import {
	captureAbsenceSubmittedRevision,
	captureTimeCorrectionSubmittedRevision,
} from "../evidence/store";
import { buildTimeCorrectionSubmittedFacts } from "../evidence/time-correction-facts";
import { AbsenceRequestHandler } from "../handlers/absence-request.handler";
import { TimeCorrectionHandler } from "../handlers/time-correction.handler";
import type { CanonicalInboxLoadInput } from "./canonical-inbox-read";
import { absenceInboxRead, timeCorrectionInboxRead } from "./v1-canonical-read";

function required<T>(value: T | undefined | null): T {
	if (value == null) throw new Error("Missing fixture value");
	return value;
}
let fixture: LifecycleDatabaseFixture;
const now = new Date("2026-10-18T09:00:00Z");
beforeEach(async () => {
	fixture = await createLifecycleDatabaseFixture();
});
afterEach(async () => {
	await fixture?.close();
});
function input(
	overrides: Partial<CanonicalInboxLoadInput> = {},
): CanonicalInboxLoadInput {
	return {
		organizationId: fixture.organizationId,
		approverId: fixture.ownerEmployeeId,
		database: fixture.db,
		now,
		...overrides,
	};
}
async function workflow(
	kind: "absence" | "time_correction",
	sourceId: string,
	contextSnapshot: Record<string, unknown> = {},
) {
	const organizationId = fixture.organizationId;
	const sourceType = kind === "absence" ? "absence_entry" : "time_entry";
	await fixture.db
		.insert(approvalWorkflowRollout)
		.values({ organizationId, workflowType: kind, lifecycleMode: "canonical" });
	const approval = required(
		(
			await fixture.db
				.insert(approvalWorkflow)
				.values({
					organizationId,
					workflowType: kind,
					sourceType,
					sourceId,
					requesterEmployeeId: fixture.employeeId,
					currentStageOrder: 1,
					policySnapshot: {},
					contextSnapshot,
					displaySnapshot: {},
					submittedAt: new Date("2026-10-18T08:00:00Z"),
				})
				.returning()
		)[0],
	);
	const stage = required(
		(
			await fixture.db
				.insert(approvalWorkflowStage)
				.values({
					organizationId,
					workflowId: approval.id,
					sequence: 1,
					label: "Manager review",
					resolverSnapshot: {},
					activationMode: "all",
					status: "pending",
				})
				.returning()
		)[0],
	);
	const assignment = required(
		(
			await fixture.db
				.insert(approvalStageAssignment)
				.values({
					organizationId,
					workflowId: approval.id,
					stageId: stage.id,
					sequence: 1,
					approverEmployeeId: fixture.ownerEmployeeId,
				})
				.returning()
		)[0],
	);
	await fixture.db.insert(approvalInboxProjection).values({
		organizationId,
		workflowId: approval.id,
		activeStageId: stage.id,
		sourceType,
		sourceId,
		status: "pending",
		displayPayload: {},
		searchText: "Lifecycle Leave correction",
	});
	return { approval, stage, assignment };
}
async function absence() {
	const category = required(
		(
			await fixture.db
				.insert(absenceCategory)
				.values({
					organizationId: fixture.organizationId,
					type: "vacation",
					name: "Leave",
				})
				.returning()
		)[0],
	);
	const record = required(
		(
			await fixture.db
				.insert(timeRecord)
				.values({
					organizationId: fixture.organizationId,
					employeeId: fixture.employeeId,
					recordKind: "absence",
					startAt: new Date("2026-10-19T00:00:00Z"),
					endAt: new Date("2026-10-20T11:59:59.999Z"),
					approvalState: "pending",
					createdBy: fixture.ownerUserId,
				})
				.returning()
		)[0],
	);
	await fixture.db.insert(timeRecordAbsence).values({
		recordId: record.id,
		organizationId: fixture.organizationId,
		absenceCategoryId: category.id,
		startPeriod: "full_day",
		endPeriod: "am",
	});
	const source = required(
		(
			await fixture.db
				.insert(absenceEntry)
				.values({
					organizationId: fixture.organizationId,
					employeeId: fixture.employeeId,
					categoryId: category.id,
					canonicalRecordId: record.id,
					startDate: "2026-10-19",
					endDate: "2026-10-20",
					startPeriod: "full_day",
					endPeriod: "am",
				})
				.returning()
		)[0],
	);
	const target = await workflow("absence", source.id);
	await fixture.db
		.update(absenceEntry)
		.set({ approvalWorkflowId: target.approval.id })
		.where(eq(absenceEntry.id, source.id));
	const entry = {
		startDate: source.startDate,
		endDate: source.endDate,
		startPeriod: source.startPeriod,
		endPeriod: source.endPeriod,
	};
	const facts = buildAbsenceSubmittedFacts({
		organizationId: fixture.organizationId,
		absenceId: source.id,
		subjectEmployeeId: fixture.employeeId,
		requesterEmployeeId: fixture.employeeId,
		categoryId: category.id,
		raw: entry,
		normalized: { ...entry, durationKind: "partial_day" },
		entry,
		canonicalRecord: {
			id: record.id,
			startAt: record.startAt,
			endAt: required(record.endAt),
		},
	});
	await captureAbsenceSubmittedRevision(fixture.db, {
		organizationId: fixture.organizationId,
		workflowId: target.approval.id,
		requestCycleKey: randomUUID(),
		submittedAt: parseInstant("2026-10-18T08:00:00Z"),
		facts,
		labels: {
			subjectName: "Subject",
			requesterName: "Subject",
			submitterName: "Subject",
			categoryName: "Leave",
		},
		submitter: {
			kind: "employee",
			employeeId: fixture.employeeId,
			userId: fixture.ownerUserId,
		},
	});
	return { ...target, source };
}
async function correction() {
	const organizationId = fixture.organizationId;
	const employeeId = fixture.employeeId;
	const originals = await fixture.db
		.insert(timeEntry)
		.values([
			{
				organizationId,
				employeeId,
				type: "clock_in" as const,
				timestamp: new Date("2026-10-15T07:00:00Z"),
				utcOffsetMinutes: 120,
				timezone: "Europe/Berlin",
				timezoneSource: "browser",
				hash: randomUUID(),
				createdBy: fixture.ownerUserId,
			},
			{
				organizationId,
				employeeId,
				type: "clock_out" as const,
				timestamp: new Date("2026-10-15T15:00:00Z"),
				utcOffsetMinutes: 120,
				timezone: "Europe/Berlin",
				timezoneSource: "browser",
				hash: randomUUID(),
				createdBy: fixture.ownerUserId,
			},
		])
		.returning();
	const clockIn = required(originals[0]);
	const clockOut = required(originals[1]);
	const changed = required(
		(
			await fixture.db
				.insert(timeEntry)
				.values({
					organizationId,
					employeeId,
					type: "correction",
					timestamp: new Date("2026-10-15T07:15:00Z"),
					utcOffsetMinutes: 120,
					timezone: "Europe/Berlin",
					timezoneSource: "browser",
					replacesEntryId: clockIn.id,
					hash: randomUUID(),
					createdBy: fixture.ownerUserId,
				})
				.returning()
		)[0],
	);
	const record = required(
		(
			await fixture.db
				.insert(timeRecord)
				.values({
					organizationId,
					employeeId,
					recordKind: "work",
					startAt: clockIn.timestamp,
					endAt: clockOut.timestamp,
					durationMinutes: 480,
					approvalState: "approved",
					createdBy: fixture.ownerUserId,
				})
				.returning()
		)[0],
	);
	const source = required(
		(
			await fixture.db
				.insert(workPeriod)
				.values({
					organizationId,
					employeeId,
					clockInId: clockIn.id,
					clockOutId: clockOut.id,
					canonicalRecordId: record.id,
					startTime: clockIn.timestamp,
					endTime: clockOut.timestamp,
					durationMinutes: 480,
					isActive: false,
					approvalStatus: "approved",
					workLocationType: "office",
				})
				.returning()
		)[0],
	);
	const proposal = {
		action: "edit" as const,
		workLocationType: "office" as const,
		workCategoryId: null,
		clockInCorrectionId: changed.id,
	};
	const target = await workflow("time_correction", source.id, {
		timeCorrection: proposal,
		timeCorrectionOriginalWorkMetadata: {
			workLocationType: "office",
			workCategoryId: null,
		},
	});
	await fixture.db
		.update(workPeriod)
		.set({ approvalWorkflowId: target.approval.id })
		.where(eq(workPeriod.id, source.id));
	const facts = buildTimeCorrectionSubmittedFacts({
		requesterEmployeeId: employeeId,
		period: source,
		clockIn,
		clockOut,
		correction: proposal,
		corrections: { clockIn: changed, clockOut: null },
	});
	await captureTimeCorrectionSubmittedRevision(fixture.db, {
		organizationId,
		lifecycle: { authority: "canonical", workflowId: target.approval.id },
		requestCycleKey: randomUUID(),
		submittedAt: parseInstant("2026-10-18T08:00:00Z"),
		facts,
		labels: {
			subjectName: "Subject",
			requesterName: "Subject",
			submitterName: "Subject",
		},
		submitter: { kind: "employee", employeeId, userId: fixture.ownerUserId },
	});
	return { ...target, source, changed, proposal };
}
describe("v1 canonical inbox readers against PostgreSQL", () => {
	it("lists and opens canonical absence assignments and their logical coverage", async () => {
		const target = await absence();
		const rows = await absenceInboxRead.load(input());
		expect(rows).toHaveLength(1);
		expect(rows[0]?.item).toMatchObject({
			id: target.assignment.id,
			type: "absence_entry",
			entityId: target.source.id,
			status: "pending",
		});
		expect(rows[0]?.decisionTarget).toMatchObject({
			targetType: "canonical_assignment",
			workflowKind: "absence",
			approverId: fixture.ownerEmployeeId,
		});
		expect(JSON.stringify(rows[0]?.detail.sections)).toContain("2026-10-19");
		expect(JSON.stringify(rows[0]?.detail.sections)).toContain("Morning");
		expect(await absenceInboxRead.count(input())).toBe(1);
		expect(
			await absenceInboxRead.load(input({ assignmentId: randomUUID() })),
		).toHaveLength(0);
	});
	it("lists an approved work period's pending correction and opens its actual proposal", async () => {
		const target = await correction();
		expect(target.source).toMatchObject({
			approvalStatus: "approved",
			pendingChanges: null,
		});
		const rows = await timeCorrectionInboxRead.load(
			input({ assignmentId: target.assignment.id }),
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.item).toMatchObject({
			id: target.assignment.id,
			type: "time_entry",
			entityId: target.source.id,
		});
		expect(rows[0]?.decisionTarget).toMatchObject({
			targetType: "canonical_assignment",
			workflowKind: "time_correction",
		});
		const detail = JSON.stringify(rows[0]?.detail.sections);
		expect(detail).toContain("07:00:00");
		expect(detail).toContain("07:15:00");
		expect(await timeCorrectionInboxRead.count(input())).toBe(1);
	});

	it("isolates canonical authority, organization and assignment visibility for both kinds", async () => {
		const absenceTarget = await absence();
		const correctionTarget = await correction();
		const outsider = await fixture.seedEmployee();
		const foreign = await fixture.createOrganization();
		for (const reader of [absenceInboxRead, timeCorrectionInboxRead]) {
			expect(
				await reader.load(input({ approverId: outsider.employeeId })),
			).toHaveLength(0);
			expect(
				await reader.count(input({ approverId: outsider.employeeId })),
			).toBe(0);
			expect(
				await reader.load(
					input({ organizationId: foreign, includeAllApprovers: true }),
				),
			).toHaveLength(0);
			expect(
				await reader.count(
					input({ organizationId: foreign, includeAllApprovers: true }),
				),
			).toBe(0);
			expect(
				await reader.load(
					input({
						approverId: outsider.employeeId,
						coveredApproverIds: [fixture.ownerEmployeeId],
					}),
				),
			).toHaveLength(1);
			expect(
				await reader.load(
					input({
						approverId: outsider.employeeId,
						eligibleApprovalScopes: [
							{
								requesterEmployeeId: fixture.employeeId,
								eligibleApproverIds: [
									fixture.ownerEmployeeId,
									outsider.employeeId,
								],
							},
						],
					}),
				),
			).toHaveLength(1);
		}
		await fixture.db
			.update(approvalWorkflowRollout)
			.set({ lifecycleMode: "legacy" })
			.where(
				eq(approvalWorkflowRollout.organizationId, fixture.organizationId),
			);
		for (const [reader, target] of [
			[absenceInboxRead, absenceTarget],
			[timeCorrectionInboxRead, correctionTarget],
		] as const) {
			expect(
				await reader.load(input({ assignmentId: target.assignment.id })),
			).toHaveLength(0);
			expect(await reader.count(input())).toBe(0);
		}
	});
});
it("excludes retired assignments and projections that name a different source", async () => {
	const absenceTarget = await absence();
	const correctionTarget = await correction();
	for (const [reader, target] of [
		[absenceInboxRead, absenceTarget],
		[timeCorrectionInboxRead, correctionTarget],
	] as const) {
		await fixture.db
			.update(approvalInboxProjection)
			.set({ sourceId: randomUUID() })
			.where(eq(approvalInboxProjection.workflowId, target.approval.id));
		expect(
			await reader.load(input({ assignmentId: target.assignment.id })),
		).toHaveLength(0);
		await fixture.db
			.update(approvalInboxProjection)
			.set({ sourceId: target.source.id })
			.where(eq(approvalInboxProjection.workflowId, target.approval.id));
		await fixture.db
			.update(approvalStageAssignment)
			.set({ status: "approved" })
			.where(eq(approvalStageAssignment.id, target.assignment.id));
		expect(
			await reader.load(input({ assignmentId: target.assignment.id })),
		).toHaveLength(0);
		expect(await reader.count(input())).toBe(0);
	}
});

it("excludes canonical compatibility aliases from legacy handler lists and counts while keeping legacy authority visible", async () => {
	const absenceTarget = await absence();
	const correctionTarget = await correction();
	await fixture.db.insert(approvalRequest).values([
		{
			organizationId: fixture.organizationId,
			entityType: "absence_entry",
			entityId: absenceTarget.source.id,
			requestedBy: fixture.employeeId,
			approverId: fixture.ownerEmployeeId,
		},
		{
			organizationId: fixture.organizationId,
			entityType: "time_entry",
			entityId: correctionTarget.source.id,
			canonicalRecordId: correctionTarget.source.canonicalRecordId,
			requestedBy: fixture.employeeId,
			approverId: fixture.ownerEmployeeId,
			metadata: {
				timeCorrection: correctionTarget.proposal,
				timeCorrectionOriginalWorkMetadata: {
					workLocationType: "office",
					workCategoryId: null,
				},
			},
		},
	]);
	const params = {
		organizationId: fixture.organizationId,
		approverId: fixture.ownerEmployeeId,
		status: "pending" as const,
		limit: 50,
	};
	const databaseService = makeDatabaseService(fixture.db);
	for (const handler of [AbsenceRequestHandler, TimeCorrectionHandler]) {
		const listed = await Effect.runPromise(
			handler
				.getApprovals(params)
				.pipe(Effect.provideService(DatabaseService, databaseService)),
		);
		const count = await Effect.runPromise(
			handler
				.getCount(fixture.ownerEmployeeId, fixture.organizationId)
				.pipe(Effect.provideService(DatabaseService, databaseService)),
		);
		expect(listed).toHaveLength(0);
		expect(count).toBe(0);
	}
	await fixture.db
		.update(approvalWorkflowRollout)
		.set({ lifecycleMode: "legacy" })
		.where(eq(approvalWorkflowRollout.organizationId, fixture.organizationId));
	for (const handler of [AbsenceRequestHandler, TimeCorrectionHandler]) {
		const listed = await Effect.runPromise(
			handler
				.getApprovals(params)
				.pipe(Effect.provideService(DatabaseService, databaseService)),
		);
		const count = await Effect.runPromise(
			handler
				.getCount(fixture.ownerEmployeeId, fixture.organizationId)
				.pipe(Effect.provideService(DatabaseService, databaseService)),
		);
		expect(listed).toHaveLength(1);
		expect(count).toBe(1);
	}
});
