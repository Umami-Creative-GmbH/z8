import { describe, expect, it, vi } from "vitest";
import { employee, timeEntry, timeRecord, workPeriod } from "@/db/schema";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { ApprovalWorkflowSnapshot } from "../workflow/ports";
import {
	createTimeCorrectionApprovalAdapter,
	type TimeCorrectionApprovalSource,
} from "./time-correction.adapter";
import type { ApprovalTerminalAdapterInput } from "./types";

const ids = {
	workflow: "10000000-0000-4000-8000-000000000001",
	period: "20000000-0000-4000-8000-000000000001",
	employee: "30000000-0000-4000-8000-000000000001",
	canonical: "40000000-0000-4000-8000-000000000001",
	originalIn: "50000000-0000-4000-8000-000000000001",
	originalOut: "50000000-0000-4000-8000-000000000002",
	correctionIn: "60000000-0000-4000-8000-000000000001",
	correctionOut: "60000000-0000-4000-8000-000000000002",
	priorIn: "60000000-0000-4000-8000-000000000003",
	priorOut: "60000000-0000-4000-8000-000000000004",
	team: "70000000-0000-4000-8000-000000000001",
	group: "80000000-0000-4000-8000-000000000001",
} as const;
const organizationId = "org-1";
const requesterUserId = "user-requester";
const actorEmployeeId = "90000000-0000-4000-8000-000000000001";
const finalizedAt = parseInstant("2026-07-20T09:00:00Z");
const correction = {
	action: "edit" as const,
	clockInCorrectionId: ids.correctionIn,
	clockOutCorrectionId: ids.correctionOut,
};

function workflow(
	overrides: Partial<ApprovalWorkflowSnapshot> = {},
): ApprovalWorkflowSnapshot {
	return {
		id: ids.workflow,
		organizationId,
		workflowType: "time_correction",
		sourceType: "time_entry",
		sourceId: ids.period,
		requesterEmployeeId: ids.employee,
		status: "pending",
		currentStageOrder: 1,
		version: 4,
		policySnapshot: {},
		contextSnapshot: {
			routing: { overtimeRisk: "warning" },
			timeCorrection: correction,
		},
		displaySnapshot: {},
		submittedAt: parseInstant("2026-07-19T09:00:00Z"),
		completedAt: null,
		cancelledAt: null,
		decisionReason: null,
		stages: [],
		...overrides,
	};
}

function createFixture() {
	const originalIn = {
		id: ids.originalIn,
		organizationId,
		employeeId: ids.employee,
		type: "clock_in",
		timestamp: new Date("2026-07-19T06:00:00.000Z"),
		utcOffsetMinutes: 120,
		timezone: "Europe/Berlin",
		timezoneSource: "browser",
		replacesEntryId: null,
		isSuperseded: false,
		supersededById: null,
		notes: "private original note",
	};
	const originalOut = {
		...originalIn,
		id: ids.originalOut,
		type: "clock_out",
		timestamp: new Date("2026-07-19T14:00:00.000Z"),
	};
	const correctionIn = {
		...originalIn,
		id: ids.correctionIn,
		type: "correction",
		timestamp: new Date("2026-07-19T07:00:00.000Z"),
		replacesEntryId: ids.originalIn,
		isSuperseded: true,
		notes: "private correction note",
	};
	const correctionOut = {
		...originalOut,
		id: ids.correctionOut,
		type: "correction",
		timestamp: new Date("2026-07-19T13:00:00.000Z"),
		utcOffsetMinutes: -240,
		timezone: "America/New_York",
		timezoneSource: "user_setting",
		replacesEntryId: ids.originalOut,
		isSuperseded: true,
		notes: "private correction note",
	};
	const value = {
		period: {
			id: ids.period,
			organizationId,
			employeeId: ids.employee,
			clockInId: ids.originalIn,
			clockOutId: ids.originalOut,
			canonicalRecordId: ids.canonical,
			approvalWorkflowId: ids.workflow,
			startTime: originalIn.timestamp,
			endTime: originalOut.timestamp,
			durationMinutes: 480,
			isActive: false,
			approvalStatus: "approved",
			pendingChanges: null,
			deletedAt: null,
		},
		requester: {
			id: ids.employee,
			organizationId,
			userId: requesterUserId,
			teamId: ids.team,
			isActive: true,
			user: { id: requesterUserId, name: "Avery Requester" },
		},
		membership: {
			id: "member-1",
			organizationId,
			userId: requesterUserId,
			status: "approved",
		},
		memberships: null as null | Array<{
			id: string;
			organizationId: string;
			userId: string;
			status: string | null;
		}>,
		canonical: {
			id: ids.canonical,
			organizationId,
			employeeId: ids.employee,
			recordKind: "work",
			startAt: originalIn.timestamp,
			endAt: originalOut.timestamp,
			durationMinutes: 480,
			approvalState: "approved",
		},
		entries: [originalIn, originalOut, correctionIn, correctionOut],
		historicalEntries: [] as (typeof originalIn)[],
		teamMemberships: [
			{ organizationId, employeeId: ids.employee, teamId: ids.team },
		],
		groupMemberships: [
			{ organizationId, employeeId: ids.employee, groupId: ids.group },
		],
	};
	const whereInputs: unknown[] = [];
	let timeEntryQueryCount = 0;
	const captureWhere = <T extends { where?: unknown }>(input: T): T => {
		whereInputs.push(input.where);
		return input;
	};
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
				orderBy() {
					return query;
				},
				for() {
					if (table === employee) {
						return Promise.resolve(
							[
								value.requester,
								...(actorEmployeeId === value.requester.id
									? []
									: [
											{
												id: actorEmployeeId,
												organizationId,
												isActive: true,
											},
										]),
							].sort((left, right) => left.id.localeCompare(right.id)),
						);
					}
					if (table === workPeriod) return Promise.resolve([value.period]);
					if (table === timeRecord) return Promise.resolve([value.canonical]);
					if (table === timeEntry) {
						const rows =
							timeEntryQueryCount === 0
								? value.entries
								: value.historicalEntries;
						timeEntryQueryCount += 1;
						return Promise.resolve(rows);
					}
					return Promise.resolve([]);
				},
			};
			return query;
		}),
		query: {
			workPeriod: {
				findFirst: vi.fn((input) => {
					captureWhere(input);
					return value.period;
				}),
			},
			employee: {
				findFirst: vi.fn((input) => {
					captureWhere(input);
					return value.requester;
				}),
			},
			member: {
				findFirst: vi.fn((input) => {
					captureWhere(input);
					return value.membership;
				}),
				findMany: vi.fn((input) => {
					captureWhere(input);
					return (
						value.memberships ?? (value.membership ? [value.membership] : [])
					);
				}),
			},
			timeRecord: {
				findFirst: vi.fn((input) => {
					captureWhere(input);
					return value.canonical;
				}),
			},
			timeEntry: {
				findMany: vi.fn((input) => {
					captureWhere(input);
					const rows =
						timeEntryQueryCount === 0 ? value.entries : value.historicalEntries;
					timeEntryQueryCount += 1;
					return rows;
				}),
			},
			teamMembership: {
				findMany: vi.fn((input) => {
					captureWhere(input);
					return value.teamMemberships;
				}),
			},
			employeeGroupMember: {
				findMany: vi.fn((input) => {
					captureWhere(input);
					return value.groupMemberships;
				}),
			},
		},
	};
	return { value, db, whereInputs };
}

function createLaterCycleFixture(
	endpoints: readonly ("clock_in" | "clock_out")[],
) {
	const fixture = createFixture();
	const baseIn = required(fixture.value.entries[0]);
	const baseOut = required(fixture.value.entries[1]);
	const pendingIn = required(fixture.value.entries[2]);
	const pendingOut = required(fixture.value.entries[3]);
	const priorIn = {
		...baseIn,
		id: ids.priorIn,
		type: "correction",
		timestamp: new Date("2026-07-19T06:30:00.000Z"),
		replacesEntryId: ids.originalIn,
		isSuperseded: false,
		supersededById: null,
	};
	const priorOut = {
		...baseOut,
		id: ids.priorOut,
		type: "correction",
		timestamp: new Date("2026-07-19T13:30:00.000Z"),
		utcOffsetMinutes: -240,
		timezone: "America/New_York",
		timezoneSource: "user_setting",
		replacesEntryId: ids.originalOut,
		isSuperseded: false,
		supersededById: null,
	};
	Object.assign(baseIn, {
		isSuperseded: true,
		supersededById: ids.priorIn,
	});
	Object.assign(baseOut, {
		isSuperseded: true,
		supersededById: ids.priorOut,
	});
	Object.assign(pendingIn, { replacesEntryId: ids.priorIn });
	Object.assign(pendingOut, { replacesEntryId: ids.priorOut });
	const laterCorrection = {
		action: "edit" as const,
		...(endpoints.includes("clock_in")
			? { clockInCorrectionId: ids.correctionIn }
			: {}),
		...(endpoints.includes("clock_out")
			? { clockOutCorrectionId: ids.correctionOut }
			: {}),
	};
	Object.assign(fixture.value.period, {
		clockInId: ids.priorIn,
		clockOutId: ids.priorOut,
		startTime: priorIn.timestamp,
		endTime: priorOut.timestamp,
		durationMinutes: 420,
	});
	Object.assign(fixture.value.canonical, {
		startAt: priorIn.timestamp,
		endAt: priorOut.timestamp,
		durationMinutes: 420,
	});
	fixture.value.entries = [
		priorIn,
		priorOut,
		...(endpoints.includes("clock_in") ? [pendingIn] : []),
		...(endpoints.includes("clock_out") ? [pendingOut] : []),
	];
	fixture.value.historicalEntries = [baseIn, baseOut];
	return { fixture, laterCorrection, baseIn, baseOut, priorIn, priorOut };
}

function collectBoundValues(value: unknown): unknown[] {
	if (!value || typeof value !== "object") return [];
	const candidate = value as { value?: unknown; queryChunks?: unknown[] };
	return [
		...(Object.hasOwn(candidate, "value") ? [candidate.value] : []),
		...(candidate.queryChunks?.flatMap(collectBoundValues) ?? []),
	];
}

function required<T>(value: T | undefined): T {
	if (!value) throw new Error("Invalid test fixture");
	return value;
}

function createAdapter() {
	const finalizeTimeCorrectionTerminal = vi.fn().mockResolvedValue({
		transition: "approved",
		requesterEmployeeId: ids.employee,
		dirtyFromDate: "2026-07-19",
	});
	const deleteCancelledCorrections = vi.fn().mockResolvedValue(undefined);
	return {
		adapter: createTimeCorrectionApprovalAdapter({
			clock: { nowInstant: () => finalizedAt },
			finalizeTimeCorrectionTerminal,
			deleteCancelledCorrections,
		}),
		finalizeTimeCorrectionTerminal,
		deleteCancelledCorrections,
	};
}

async function loadSource(
	fixture = createFixture(),
	workflowOverrides: Partial<ApprovalWorkflowSnapshot> = {},
) {
	const dependencies = createAdapter();
	const source = await dependencies.adapter.loadSource({
		dbService: { db: fixture.db } as never,
		organizationId,
		workflow: workflow(workflowOverrides),
		sourceIdentity: {
			organizationId,
			workflowType: "time_correction",
			sourceType: "time_entry",
			sourceId: ids.period,
		},
		actor: {
			kind: "employee",
			employeeId: actorEmployeeId,
			userId: "user-manager",
		},
	});
	return { ...dependencies, fixture, source };
}

function context(
	source: TimeCorrectionApprovalSource,
	overrides: Partial<ApprovalWorkflowSnapshot> = {},
) {
	return {
		organizationId,
		workflow: workflow(overrides),
		sourceIdentity: {
			organizationId,
			workflowType: "time_correction" as const,
			sourceType: "time_entry",
			sourceId: ids.period,
		},
		source,
		actor: {
			kind: "employee" as const,
			employeeId: actorEmployeeId,
			userId: "user-manager",
		},
	};
}

describe("time correction approval adapter", () => {
	it("loads exact immutable correction evidence through caller transaction scope", async () => {
		const { adapter, fixture, source } = await loadSource();

		expect(adapter).toMatchObject({
			workflowType: "time_correction",
			sourceType: "time_entry",
		});
		expect(source).toMatchObject({
			id: ids.period,
			organizationId,
			employeeId: ids.employee,
			requesterUserId,
			approvalWorkflowId: ids.workflow,
			canonicalRecordId: ids.canonical,
			correction,
			clockIn: {
				endpointType: "clock_in",
				originalEntryId: ids.originalIn,
				correctionEntryId: ids.correctionIn,
				instant: parseInstant("2026-07-19T07:00:00Z"),
				utcOffsetMinutes: 120,
				timezone: "Europe/Berlin",
				timezoneSource: "browser",
			},
			clockOut: {
				endpointType: "clock_out",
				originalEntryId: ids.originalOut,
				correctionEntryId: ids.correctionOut,
				instant: parseInstant("2026-07-19T13:00:00Z"),
				utcOffsetMinutes: -240,
				timezone: "America/New_York",
				timezoneSource: "user_setting",
			},
			workPeriod: {
				clockInId: ids.originalIn,
				clockOutId: ids.originalOut,
				startTime: parseInstant("2026-07-19T06:00:00Z"),
				endTime: parseInstant("2026-07-19T14:00:00Z"),
				durationMinutes: 480,
				isActive: false,
				approvalStatus: "approved",
				pendingChanges: null,
			},
			canonicalRecord: {
				id: ids.canonical,
				employeeId: ids.employee,
				recordKind: "work",
				startAt: parseInstant("2026-07-19T06:00:00Z"),
				endAt: parseInstant("2026-07-19T14:00:00Z"),
				durationMinutes: 480,
				approvalState: "approved",
			},
			currentEndpoints: {
				clockIn: {
					id: ids.originalIn,
					organizationId,
					employeeId: ids.employee,
					logicalRole: "clock_in",
					type: "clock_in",
					replacesEntryId: null,
					timestamp: parseInstant("2026-07-19T06:00:00Z"),
					utcOffsetMinutes: 120,
					timezone: "Europe/Berlin",
					timezoneSource: "browser",
					isSuperseded: false,
					supersededById: null,
				},
				clockOut: {
					id: ids.originalOut,
					organizationId,
					employeeId: ids.employee,
					logicalRole: "clock_out",
					type: "clock_out",
					replacesEntryId: null,
					timestamp: parseInstant("2026-07-19T14:00:00Z"),
					utcOffsetMinutes: 120,
					timezone: "Europe/Berlin",
					timezoneSource: "browser",
					isSuperseded: false,
					supersededById: null,
				},
			},
			pendingCorrections: {
				clockIn: {
					id: ids.correctionIn,
					organizationId,
					employeeId: ids.employee,
					logicalRole: "clock_in",
					type: "correction",
					replacesEntryId: ids.originalIn,
					timestamp: parseInstant("2026-07-19T07:00:00Z"),
					utcOffsetMinutes: 120,
					timezone: "Europe/Berlin",
					timezoneSource: "browser",
					isSuperseded: true,
					supersededById: null,
				},
				clockOut: {
					id: ids.correctionOut,
					organizationId,
					employeeId: ids.employee,
					logicalRole: "clock_out",
					type: "correction",
					replacesEntryId: ids.originalOut,
					timestamp: parseInstant("2026-07-19T13:00:00Z"),
					utcOffsetMinutes: -240,
					timezone: "America/New_York",
					timezoneSource: "user_setting",
					isSuperseded: true,
					supersededById: null,
				},
			},
		});
		expect(Object.isFrozen(source)).toBe(true);
		expect(fixture.whereInputs).toHaveLength(8);
		expect(fixture.db.select).toHaveBeenCalledTimes(4);
		for (const where of fixture.whereInputs) {
			expect(collectBoundValues(where)).toContain(organizationId);
		}
	});

	it("requires an exact approved organization membership independently of the employee", async () => {
		const { fixture, source } = await loadSource();

		expect(source.requesterUserId).toBe(requesterUserId);
		expect(fixture.db.query.member.findMany).toHaveBeenCalledOnce();
		const membershipWhere =
			fixture.db.query.member.findMany.mock.calls[0]?.[0]?.where;
		expect(collectBoundValues(membershipWhere)).toEqual(
			expect.arrayContaining([organizationId, requesterUserId]),
		);
		expect(collectBoundValues(membershipWhere)).not.toContain("approved");
		expect(fixture.db.query.member.findMany.mock.calls[0]?.[0]).toMatchObject({
			limit: 2,
		});
	});

	it("rejects duplicate approved organization memberships", async () => {
		const fixture = createFixture();
		fixture.value.memberships = [
			fixture.value.membership,
			{ ...fixture.value.membership, id: "member-2" },
		];
		await expect(loadSource(fixture)).rejects.toMatchObject({
			name: "TimeCorrectionApprovalAdapterError",
		});
	});

	it.each([
		"suspended",
		"pending",
	])("rejects approved plus %s duplicate organization memberships", async (status) => {
		const fixture = createFixture();
		fixture.value.memberships = [
			fixture.value.membership,
			{ ...fixture.value.membership, id: "member-2", status },
		];
		await expect(loadSource(fixture)).rejects.toMatchObject({
			name: "TimeCorrectionApprovalAdapterError",
		});
	});

	it.each([
		["clock-in", ["clock_in"]],
		["clock-out", ["clock_out"]],
		["two-endpoint", ["clock_in", "clock_out"]],
	] as const)("loads a later %s cycle from active correction endpoints", async (_label, endpoints) => {
		const { fixture, laterCorrection } = createLaterCycleFixture(endpoints);
		const { source } = await loadSource(fixture, {
			contextSnapshot: { timeCorrection: laterCorrection },
		});

		expect(source).toMatchObject({
			correction: laterCorrection,
			clockIn: endpoints.includes("clock_in")
				? { originalEntryId: ids.priorIn }
				: null,
			clockOut: endpoints.includes("clock_out")
				? { originalEntryId: ids.priorOut }
				: null,
		});
	});

	it.each([
		[
			"inactive current correction",
			({ priorIn }: ReturnType<typeof createLaterCycleFixture>) =>
				(priorIn.isSuperseded = true),
		],
		[
			"superseded current correction",
			({ priorIn }: ReturnType<typeof createLaterCycleFixture>) =>
				(priorIn.supersededById = ids.correctionIn),
		],
		[
			"missing current correction",
			({ fixture }: ReturnType<typeof createLaterCycleFixture>) =>
				(fixture.value.entries = fixture.value.entries.filter(
					(entry) => entry.id !== ids.priorIn,
				)),
		],
		[
			"foreign current correction",
			({ priorIn }: ReturnType<typeof createLaterCycleFixture>) =>
				(priorIn.organizationId = "org-2"),
		],
		[
			"wrong current employee",
			({ priorIn }: ReturnType<typeof createLaterCycleFixture>) =>
				(priorIn.employeeId = actorEmployeeId),
		],
		[
			"self-replacing current correction",
			({ priorIn }: ReturnType<typeof createLaterCycleFixture>) =>
				(priorIn.replacesEntryId = ids.priorIn),
		],
		[
			"missing current predecessor",
			({ fixture }: ReturnType<typeof createLaterCycleFixture>) =>
				(fixture.value.historicalEntries =
					fixture.value.historicalEntries.filter(
						(entry) => entry.id !== ids.originalIn,
					)),
		],
		[
			"broken predecessor link",
			({ baseIn }: ReturnType<typeof createLaterCycleFixture>) =>
				(baseIn.supersededById = ids.correctionIn),
		],
		[
			"cyclic predecessor link",
			({ baseIn }: ReturnType<typeof createLaterCycleFixture>) =>
				(baseIn.replacesEntryId = ids.priorIn),
		],
		[
			"pending correction replacing historical row",
			({ fixture }: ReturnType<typeof createLaterCycleFixture>) =>
				(required(
					fixture.value.entries.find((entry) => entry.id === ids.correctionIn),
				).replacesEntryId = ids.originalIn),
		],
	] as const)("rejects later-cycle %s", async (_label, mutate) => {
		const later = createLaterCycleFixture(["clock_in", "clock_out"]);
		mutate(later);
		await expect(
			loadSource(later.fixture, {
				contextSnapshot: { timeCorrection: later.laterCorrection },
			}),
		).rejects.toMatchObject({ name: "TimeCorrectionApprovalAdapterError" });
	});

	it.each([
		null,
		"pending",
		"suspended",
		"rejected",
		"removed",
	])("rejects requester membership status %s", async (status) => {
		const fixture = createFixture();
		fixture.value.membership.status = status;
		await expect(loadSource(fixture)).rejects.toMatchObject({
			name: "TimeCorrectionApprovalAdapterError",
		});
	});

	it.each([
		[
			"missing",
			(value: ReturnType<typeof createFixture>["value"]) =>
				(value.membership = null as never),
		],
		[
			"foreign organization",
			(value: ReturnType<typeof createFixture>["value"]) =>
				(value.membership.organizationId = "org-2"),
		],
		[
			"different user",
			(value: ReturnType<typeof createFixture>["value"]) =>
				(value.membership.userId = "user-other"),
		],
	] as const)("rejects %s organization membership", async (_label, mutate) => {
		const fixture = createFixture();
		mutate(fixture.value);
		await expect(loadSource(fixture)).rejects.toMatchObject({
			name: "TimeCorrectionApprovalAdapterError",
		});
	});

	it("returns only trusted routing evidence and tolerates no manager row", async () => {
		const { adapter, source } = await loadSource();

		await expect(
			adapter.produceRoutingContext(context(source)),
		).resolves.toEqual({
			organizationId,
			workflowType: "time_correction",
			source: { type: "time_entry", id: ids.period },
			requesterEmployeeId: ids.employee,
			teamIds: [ids.team],
			locationId: null,
			absenceCategoryId: null,
			travelExpenseAmount: null,
			overtimeRisk: null,
			employeeGroupIds: [ids.group],
		});
		await expect(
			adapter.getTrustedCapabilities(context(source)),
		).resolves.toEqual({ canCancelAfterApproval: false });
	});

	it.each([
		[
			"foreign work period",
			(value: ReturnType<typeof createFixture>["value"]) =>
				(value.period.organizationId = "org-2"),
		],
		[
			"different workflow link",
			(value: ReturnType<typeof createFixture>["value"]) =>
				(value.period.approvalWorkflowId =
					"10000000-0000-4000-8000-000000000099"),
		],
		[
			"ineligible source status",
			(value: ReturnType<typeof createFixture>["value"]) =>
				(value.period.approvalStatus = "rejected"),
		],
		[
			"deleted source",
			(value: ReturnType<typeof createFixture>["value"]) =>
				(value.period.deletedAt = new Date()),
		],
		[
			"inactive requester",
			(value: ReturnType<typeof createFixture>["value"]) =>
				(value.requester.isActive = false),
		],
		[
			"foreign requester",
			(value: ReturnType<typeof createFixture>["value"]) =>
				(value.requester.organizationId = "org-2"),
		],
		[
			"wrong requester user",
			(value: ReturnType<typeof createFixture>["value"]) =>
				(value.requester.user.id = "user-other"),
		],
		[
			"foreign canonical record",
			(value: ReturnType<typeof createFixture>["value"]) =>
				(value.canonical.organizationId = "org-2"),
		],
		[
			"wrong canonical employee",
			(value: ReturnType<typeof createFixture>["value"]) =>
				(value.canonical.employeeId = actorEmployeeId),
		],
		[
			"wrong canonical kind",
			(value: ReturnType<typeof createFixture>["value"]) =>
				(value.canonical.recordKind = "absence"),
		],
		[
			"active correction",
			(value: ReturnType<typeof createFixture>["value"]) =>
				(required(value.entries[2]).isSuperseded = false),
		],
		[
			"already superseding correction",
			(value: ReturnType<typeof createFixture>["value"]) =>
				(required(value.entries[2]).supersededById = ids.originalOut),
		],
		[
			"foreign correction",
			(value: ReturnType<typeof createFixture>["value"]) =>
				(required(value.entries[2]).organizationId = "org-2"),
		],
		[
			"wrong correction lineage",
			(value: ReturnType<typeof createFixture>["value"]) =>
				(required(value.entries[2]).replacesEntryId = ids.originalOut),
		],
		[
			"superseded original",
			(value: ReturnType<typeof createFixture>["value"]) =>
				(required(value.entries[0]).isSuperseded = true),
		],
		[
			"wrong original endpoint",
			(value: ReturnType<typeof createFixture>["value"]) =>
				(required(value.entries[0]).type = "clock_out"),
		],
		[
			"invalid timezone",
			(value: ReturnType<typeof createFixture>["value"]) =>
				(required(value.entries[2]).timezone = "Not/AZone"),
		],
		[
			"offset mismatch",
			(value: ReturnType<typeof createFixture>["value"]) =>
				(required(value.entries[2]).utcOffsetMinutes = 0),
		],
		[
			"unknown timezone source",
			(value: ReturnType<typeof createFixture>["value"]) =>
				(required(value.entries[2]).timezoneSource = "viewer"),
		],
		[
			"foreign team membership",
			(value: ReturnType<typeof createFixture>["value"]) =>
				(required(value.teamMemberships[0]).organizationId = "org-2"),
		],
		[
			"foreign employee group",
			(value: ReturnType<typeof createFixture>["value"]) =>
				(required(value.groupMemberships[0]).organizationId = "org-2"),
		],
	] as const)("rejects %s evidence", async (_label, mutate) => {
		const fixture = createFixture();
		mutate(fixture.value);
		await expect(loadSource(fixture)).rejects.toMatchObject({
			name: "TimeCorrectionApprovalAdapterError",
		});
	});

	it.each([
		{},
		{ timeCorrection: { ...correction, unexpected: true } },
		{ timeCorrection: { ...correction, clockInCorrectionId: "not-a-uuid" } },
	])("rejects malformed immutable context %#", async (contextSnapshot) => {
		const fixture = createFixture();
		const dependencies = createAdapter();
		await expect(
			dependencies.adapter.loadSource({
				dbService: { db: fixture.db } as never,
				organizationId,
				workflow: workflow({ contextSnapshot }),
				sourceIdentity: {
					organizationId,
					workflowType: "time_correction",
					sourceType: "time_entry",
					sourceId: ids.period,
				},
				actor: { kind: "system", employeeId: null, userId: null },
			}),
		).rejects.toMatchObject({ name: "TimeCorrectionApprovalAdapterError" });
	});

	it("allows intermediate decisions without source mutation", async () => {
		const {
			adapter,
			source,
			finalizeTimeCorrectionTerminal,
			deleteCancelledCorrections,
		} = await loadSource();
		await adapter.preflightCommand({
			...context(source),
			command: { kind: "approve", reason: null },
			proposedStatus: "approved",
		});
		expect(finalizeTimeCorrectionTerminal).not.toHaveBeenCalled();
		expect(deleteCancelledCorrections).not.toHaveBeenCalled();
	});

	it.each([
		[
			"approve",
			{ kind: "approve", from: "pending", to: "approved", reason: "verified" },
		],
		[
			"reject",
			{ kind: "reject", from: "pending", to: "rejected", reason: "invalid" },
		],
	] as const)("delegates terminal %s once with exact engine evidence", async (_label, transition) => {
		const { adapter, source, finalizeTimeCorrectionTerminal } =
			await loadSource();
		const dbService = { db: {} } as never;
		const input = {
			...context(source, {
				status: transition.to,
				version: 5,
				completedAt: finalizedAt,
			}),
			dbService,
			finalizationCause: "command" as const,
			transition,
			finalizedAt,
		} as ApprovalTerminalAdapterInput<TimeCorrectionApprovalSource>;

		const result = await adapter.finalizeTerminal(input);

		expect(finalizeTimeCorrectionTerminal).toHaveBeenCalledOnce();
		expect(finalizeTimeCorrectionTerminal).toHaveBeenCalledWith({
			dbService,
			organizationId,
			workPeriodId: ids.period,
			expectedApprovalWorkflowId: ids.workflow,
			expectedApprovalWorkflowVersion: 5,
			expectedRequesterEmployeeId: ids.employee,
			actorEmployeeId,
			actorUserId: "user-manager",
			correction,
			legacyApprovalRequestId: null,
			transition:
				transition.kind === "approve"
					? { kind: "approve", reason: "verified" }
					: { kind: "reject", reason: "invalid" },
			finalizedAt,
			allowMetadataLessLegacyFallback: false,
		});
		expect(result).toMatchObject({
			organizationId,
			workflowId: ids.workflow,
			transitionKind: transition.kind,
			terminalStatus: transition.to,
		});
	});

	it("deletes only requester-cancelled pending corrections through its dependency", async () => {
		const {
			adapter,
			source,
			deleteCancelledCorrections,
			finalizeTimeCorrectionTerminal,
		} = await loadSource();
		const dbService = { db: {} } as never;
		const cancellation = {
			...context(source, {
				status: "cancelled",
				version: 5,
				cancelledAt: finalizedAt,
			}),
			actor: {
				kind: "employee" as const,
				employeeId: ids.employee,
				userId: requesterUserId,
			},
			dbService,
			finalizationCause: "command" as const,
			transition: {
				kind: "cancel_pending" as const,
				from: "pending" as const,
				to: "cancelled" as const,
				reason: "withdrawn",
			},
			finalizedAt,
		};

		await adapter.finalizeTerminal(cancellation);

		expect(deleteCancelledCorrections).toHaveBeenCalledOnce();
		expect(deleteCancelledCorrections).toHaveBeenCalledWith({
			dbService,
			organizationId,
			workPeriodId: ids.period,
			expectedSource: {
				employeeId: ids.employee,
				approvalWorkflowId: ids.workflow,
				canonicalRecordId: ids.canonical,
				clockInId: ids.originalIn,
				clockOutId: ids.originalOut,
				startTime: parseInstant("2026-07-19T06:00:00Z"),
				endTime: parseInstant("2026-07-19T14:00:00Z"),
				durationMinutes: 480,
				isActive: false,
				approvalStatus: "approved",
				pendingChanges: null,
				canonicalRecord: {
					id: ids.canonical,
					employeeId: ids.employee,
					recordKind: "work",
					startAt: parseInstant("2026-07-19T06:00:00Z"),
					endAt: parseInstant("2026-07-19T14:00:00Z"),
					durationMinutes: 480,
					approvalState: "approved",
				},
				currentEndpoints: source.currentEndpoints,
				pendingCorrections: source.pendingCorrections,
			},
			correction,
		});
		expect(finalizeTimeCorrectionTerminal).not.toHaveBeenCalled();
	});

	it.each([
		["manager cancellation", { actor: undefined }],
		[
			"system cancellation",
			{ actor: { kind: "system", employeeId: null, userId: null } },
		],
		[
			"expiration",
			{
				transition: {
					kind: "expire",
					from: "pending",
					to: "expired",
					reason: null,
				},
			},
		],
		[
			"approved cancellation",
			{
				transition: {
					kind: "cancel_approved",
					from: "approved",
					to: "cancelled",
					reason: null,
					authorization: {},
				},
			},
		],
	] as const)("fails closed for %s", async (_label, override) => {
		const { adapter, source } = await loadSource();
		const base = {
			...context(source, { status: "cancelled", version: 5 }),
			dbService: { db: {} },
			finalizationCause: "command" as const,
			transition: {
				kind: "cancel_pending" as const,
				from: "pending" as const,
				to: "cancelled" as const,
				reason: null,
			},
			finalizedAt,
		};
		await expect(
			adapter.preflightTerminal({
				...base,
				...override,
				actor: override.actor ?? base.actor,
			} as never),
		).rejects.toMatchObject({ name: "TimeCorrectionApprovalAdapterError" });
	});

	it("projects stable requester-safe display text without private lineage", async () => {
		const { adapter, source } = await loadSource();
		const display = await adapter.projectDisplay(context(source));
		const serialized = JSON.stringify(display);

		expect(display).toMatchObject({
			displayPayload: {
				requesterEmployeeId: ids.employee,
				requesterName: "Avery Requester",
				title: "Time correction",
				action: "edit",
				endpoints: ["Clock in", "Clock out"],
			},
			searchText: "avery requester time correction edit clock in clock out",
		});
		for (const privateValue of [
			ids.correctionIn,
			ids.correctionOut,
			ids.originalIn,
			ids.originalOut,
			"private correction note",
			"Europe/Berlin",
			"America/New_York",
		]) {
			expect(serialized).not.toContain(privateValue);
		}
	});
});
