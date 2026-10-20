import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { createDepartureCommands } from "@/lib/employee-lifecycle/commands";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { saveConfirmedIntendedDriverAssignment } from "./testing/control.test.fixture";

const harness = vi.hoisted(() => ({
	userId: "",
	organizationId: "",
	now: "2026-09-01T08:00:00Z",
}));
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: async () => ({
		user: { id: harness.userId },
		session: { activeOrganizationId: harness.organizationId },
	}),
}));
vi.mock("@/lib/datetime/temporal-core", async (original) => {
	const actual =
		await original<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...actual,
		systemClock: { nowInstant: () => actual.parseInstant(harness.now) },
	};
});
const checks = await import("./check-actions");
const policy = await import("./policy-actions");
const grants = await import("./verifier-actions");
const impediments = await import("./impediment-actions");
let fixture: LifecycleDatabaseFixture;
let target: SeededEmployee;
let verifier: SeededEmployee;
function owner() {
	return {
		userId: fixture.ownerUserId,
		organizationId: fixture.organizationId,
	};
}
function commands() {
	return createDepartureCommands({
		db: fixture.db,
		clock: { nowInstant: () => parseInstant(harness.now) },
		clockOut: {
			async close() {
				return { kind: "not_running" };
			},
		},
	});
}
function original(employeeId = target.employeeId) {
	return {
		employeeId,
		commandId: randomUUID(),
		originalInspected: true,
		identityConfirmed: true,
		employeeDeclaration: true,
		verifierConfirmed: true,
		documentIssuedOn: "2020-05-01",
		documentExpiresOn: "2035-05-01",
		classes: [
			{ code: "B", result: "successful", expiryDate: null, restrictions: "" },
			{ code: "C", result: "successful", expiryDate: null, restrictions: "" },
		],
	};
}
async function record() {
	const result = await checks.getDrivingLicenceEmployeeRecordAction({
		employeeId: target.employeeId,
	});
	if (!result.success) throw new Error(result.error);
	return result.data;
}
beforeEach(async () => {
	fixture = await createLifecycleDatabaseFixture();
	target = await fixture.seedEmployee();
	verifier = await fixture.seedEmployee();
	harness.organizationId = fixture.organizationId;
	harness.now = "2026-09-01T08:00:00Z";
	harness.userId = fixture.ownerUserId;
	expect(
		(
			await policy.saveDrivingLicencePolicyAction({
				enabled: true,
				intervalMonths: 6,
				timezone: "Europe/Berlin",
				reminderLeadDays: [30, 7],
				retentionMonths: 36,
				retentionJustification:
					"Dedicated driving inspection evidence retention",
			})
		).success,
	).toBe(true);
	expect(
		(
			await saveConfirmedIntendedDriverAssignment({
				target: { type: "employee", employeeId: target.employeeId },
				value: "required",
			})
		).success,
	).toBe(true);
	expect(
		(
			await grants.saveDrivingLicenceVerifierGrantAction({
				verifierEmployeeId: verifier.employeeId,
				scope: "all",
				teamIds: [],
				employeeIds: [],
			})
		).success,
	).toBe(true);
	expect(
		(
			await grants.saveDrivingLicenceVerifierGrantAction({
				verifierEmployeeId: target.employeeId,
				scope: "all",
				teamIds: [],
				employeeIds: [],
			})
		).success,
	).toBe(true);
	harness.userId = verifier.userId;
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(true);
});
afterEach(async () => {
	await fixture?.close();
});
it("ends active and person-wide suspended classes at departure while retaining their attributable evidence", async () => {
	harness.now = "2026-09-02T08:00:00Z";
	harness.userId = target.userId;
	expect(
		(
			await impediments.reportDrivingImpedimentAction({
				commandId: randomUUID(),
			})
		).success,
	).toBe(true);
	harness.now = "2026-09-03T08:00:00Z";
	await commands().offboardNow(owner(), {
		employeeId: target.employeeId,
		requestId: randomUUID(),
		replacementEmployeeId: null,
		acknowledgeUnassignedDuties: true,
	});
	harness.userId = verifier.userId;
	const evidence = await record();
	expect(evidence.status).toBe("ended");
	expect(evidence.checks).toHaveLength(1);
	expect(await checks.getDrivingLicenceCheckWorklistAction()).toMatchObject({
		success: true,
		data: expect.arrayContaining([
			expect.objectContaining({
				employeeId: target.employeeId,
				status: "ended",
				canVerify: false,
			}),
		]),
	});
	expect(evidence.events.filter((event) => event.kind === "ended")).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				classCode: "B",
				reason: "employment_ended",
				effectiveAt: "2026-09-03T08:00:00.000Z",
			}),
			expect.objectContaining({ classCode: "C", reason: "employment_ended" }),
			expect.objectContaining({ classCode: null, reason: "employment_ended" }),
		]),
	);
	harness.userId = fixture.ownerUserId;
	const admin = await grants.getDrivingLicenceVerifierAdminDataAction();
	expect(
		admin.success &&
			admin.data.grants.find(
				(grant) => grant.verifierEmployeeId === target.employeeId,
			)?.revokedAt,
	).toBe("2026-09-03T08:00:00.000Z");
	harness.userId = target.userId;
	expect(
		(
			await checks.getDrivingLicenceEmployeeRecordAction({
				employeeId: target.employeeId,
			})
		).success,
	).toBe(false);
});
async function schedule() {
	harness.now = "2026-09-02T08:00:00Z";
	await fixture.pool.query(
		`update organization set timezone='Europe/Berlin' where id=$1`,
		[fixture.organizationId],
	);
	const scheduled = await commands().scheduleDeparture(owner(), {
		employeeId: target.employeeId,
		requestId: randomUUID(),
		expectedRevision: null,
		lastWorkingDay: "2026-09-03",
		replacementEmployeeId: null,
		acknowledgeUnassignedDuties: true,
	});
	return {
		organizationId: fixture.organizationId,
		employeeId: target.employeeId,
		employmentPeriodId: target.employmentPeriodId,
		departureId: scheduled.departureId,
		revision: scheduled.revision,
	};
}
async function rehire(at = "2026-10-01T08:00:00Z") {
	const policyRow = await fixture.pool.query<{ id: string }>(
		`insert into work_policy (organization_id,name,created_by,updated_at) values ($1,'Returning policy',$2,now()) returning id`,
		[fixture.organizationId, fixture.ownerUserId],
	);
	harness.now = at;
	await commands().rehireEmployee(owner(), {
		employeeId: target.employeeId,
		requestId: randomUUID(),
		previousEmploymentPeriodId: target.employmentPeriodId,
		role: "employee",
		teamId: null,
		primaryManagerId: fixture.ownerEmployeeId,
		workPolicyId: policyRow.rows[0].id,
		weeklyContractMinutes: 2400,
		contractType: "fixed",
		workModel: "onsite",
		hourlyRate: null,
		currency: "EUR",
		probationStartsOn: null,
		probationEndsOn: null,
		changeReason: "Returning",
	});
}
it("reflects a due cutoff before worker processing and never restores old impediments or grants after rehire", async () => {
	harness.userId = target.userId;
	expect(
		(
			await impediments.reportDrivingImpedimentAction({
				commandId: randomUUID(),
			})
		).success,
	).toBe(true);
	const identity = await schedule();
	harness.now = "2026-09-03T22:00:00Z";
	harness.userId = verifier.userId;
	expect((await record()).status).toBe("ended");
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(false);
	harness.userId = target.userId;
	expect(
		(await grants.getDrivingLicenceVerifierResponsibilityAction()).success,
	).toBe(false);
	harness.now = "2026-09-04T12:00:00Z";
	expect((await commands().executeDeparture(identity)).status).toBe(
		"effective",
	);
	harness.userId = verifier.userId;
	expect(
		(await record()).events
			.filter((event) => event.kind === "ended")
			.every((event) => event.effectiveAt === "2026-09-03T22:00:00.000Z"),
	).toBe(true);
	await rehire();
	harness.userId = target.userId;
	const responsibility =
		await grants.getDrivingLicenceVerifierResponsibilityAction();
	expect(responsibility.success && responsibility.data).toBeNull();
	expect((await record()).authorizedClasses).toEqual([]);
	harness.userId = verifier.userId;
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(true);
	expect((await record()).authorizedClasses).toEqual(["B", "C"]);
	expect((await record()).checks).toHaveLength(2);
	harness.userId = fixture.ownerUserId;
	expect(
		(
			await grants.saveDrivingLicenceVerifierGrantAction({
				verifierEmployeeId: target.employeeId,
				scope: "all",
				teamIds: [],
				employeeIds: [],
			})
		).success,
	).toBe(true);
	expect((await commands().executeDeparture(identity)).status).toBe("obsolete");
	harness.userId = target.userId;
	const fresh = await grants.getDrivingLicenceVerifierResponsibilityAction();
	expect(fresh.success && fresh.data?.revokedAt).toBeNull();
	expect((await record()).authorizedClasses).toEqual(["B", "C"]);
});
it("shows an enrolled employee with no check as ended at the effective cutoff", async () => {
	const unchecked = await fixture.seedEmployee();
	harness.userId = fixture.ownerUserId;
	expect(
		(
			await saveConfirmedIntendedDriverAssignment({
				target: { type: "employee", employeeId: unchecked.employeeId },
				value: "required",
			})
		).success,
	).toBe(true);
	harness.now = "2026-09-03T08:00:00Z";
	await commands().offboardNow(owner(), {
		employeeId: unchecked.employeeId,
		requestId: randomUUID(),
		replacementEmployeeId: null,
		acknowledgeUnassignedDuties: true,
	});
	harness.userId = verifier.userId;
	const result = await checks.getDrivingLicenceEmployeeRecordAction({
		employeeId: unchecked.employeeId,
	});
	expect(result.success && result.data.status).toBe("ended");
});
it("serializes a driving task read behind a departing employee without an inverted organization lock", async () => {
	const identity = await schedule();
	harness.now = "2026-09-04T12:00:00Z";
	harness.userId = verifier.userId;
	const lease = await fixture.pool.connect();
	const departurePid = (
		await lease.query<{ pid: number }>("select pg_backend_pid() pid")
	).rows[0].pid;
	await lease.query("begin");
	await lease.query(
		"select id from employee_departure where organization_id=$1 and id=$2 for update",
		[fixture.organizationId, identity.departureId],
	);
	async function waiter(blocker: number) {
		for (let attempt = 0; attempt < 400; attempt++) {
			const result = await fixture.pool.query<{ pid: number }>(
				"select pid from pg_stat_activity where $1::int=any(pg_blocking_pids(pid)) limit 1",
				[blocker],
			);
			if (result.rows[0]) return result.rows[0].pid;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		throw new Error("Public operation did not reach the held database lock");
	}
	const departure = commands().executeDeparture(identity);
	try {
		const blockedDeparture = await waiter(departurePid);
		const tasks = (
			await import("./task-actions")
		).getDrivingLicenceTasksAction();
		await waiter(blockedDeparture);
		await lease.query("commit");
		const [ended, taskRead] = await Promise.all([departure, tasks]);
		expect(ended.status).toBe("effective");
		expect(taskRead.success).toBe(true);
		expect((await record()).authorizedClasses).toEqual([]);
	} finally {
		await lease.query("rollback");
		lease.release();
		await departure;
	}
}, 15000);
it("terminates legacy unversioned authorizations and held grants when departure establishes the first period", async () => {
	target = await fixture.seedEmployee({ withPeriod: false });
	harness.userId = fixture.ownerUserId;
	expect(
		(
			await saveConfirmedIntendedDriverAssignment({
				target: { type: "employee", employeeId: target.employeeId },
				value: "required",
			})
		).success,
	).toBe(true);
	expect(
		(
			await grants.saveDrivingLicenceVerifierGrantAction({
				verifierEmployeeId: target.employeeId,
				scope: "all",
				teamIds: [],
				employeeIds: [],
			})
		).success,
	).toBe(true);
	harness.userId = verifier.userId;
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(true);
	harness.now = "2026-09-03T08:00:00Z";
	await commands().offboardNow(owner(), {
		employeeId: target.employeeId,
		requestId: randomUUID(),
		replacementEmployeeId: null,
		acknowledgeUnassignedDuties: true,
	});
	expect(
		(await record()).events.filter((event) => event.kind === "ended"),
	).toHaveLength(2);
	harness.userId = fixture.ownerUserId;
	const admin = await grants.getDrivingLicenceVerifierAdminDataAction();
	expect(
		admin.success &&
			admin.data.grants.find(
				(grant) => grant.verifierEmployeeId === target.employeeId,
			)?.revokedAt,
	).toBe("2026-09-03T08:00:00.000Z");
	const retention = await (
		await import("./retention-actions")
	).getDrivingLicenceRetentionAction();
	expect(
		retention.success &&
			retention.data.records.find(
				(record) => record.employeeId === target.employeeId,
			),
	).toMatchObject({
		retentionStartedAt: "2026-09-03T08:00:00.000Z",
		protected: false,
	});
});
it("rejects a verifier grant whose locked submission crosses the effective departure cutoff", async () => {
	await schedule();
	harness.now = "2026-09-03T21:59:00Z";
	harness.userId = fixture.ownerUserId;
	const lease = await fixture.pool.connect();
	await lease.query("begin");
	const blocker = (
		await lease.query<{ pid: number }>("select pg_backend_pid() pid")
	).rows[0].pid;
	await lease.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
		`${fixture.organizationId}:${target.employeeId}:driving-verifier`,
	]);
	const submission = grants.saveDrivingLicenceVerifierGrantAction({
		verifierEmployeeId: target.employeeId,
		scope: "all",
		teamIds: [],
		employeeIds: [],
	});
	try {
		let waiting = false;
		for (let attempt = 0; attempt < 400; attempt++) {
			const result = await fixture.pool.query(
				"select pid from pg_stat_activity where $1::int=any(pg_blocking_pids(pid)) limit 1",
				[blocker],
			);
			if (result.rows[0]) {
				waiting = true;
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		expect(waiting).toBe(true);
		harness.now = "2026-09-03T22:00:00Z";
		await lease.query("commit");
		expect((await submission).success).toBe(false);
	} finally {
		await lease.query("rollback");
		lease.release();
		await submission;
	}
}, 15000);
it("uses employment period identity for fresh checks and grants even when rehire shares the cutoff instant", async () => {
	harness.now = "2026-09-03T08:00:00Z";
	await commands().offboardNow(owner(), {
		employeeId: target.employeeId,
		requestId: randomUUID(),
		replacementEmployeeId: null,
		acknowledgeUnassignedDuties: true,
	});
	await rehire("2026-09-03T08:00:00Z");
	harness.userId = verifier.userId;
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(true);
	expect((await record()).authorizedClasses).toEqual(["B", "C"]);
	harness.userId = fixture.ownerUserId;
	expect(
		(
			await grants.saveDrivingLicenceVerifierGrantAction({
				verifierEmployeeId: target.employeeId,
				scope: "all",
				teamIds: [],
				employeeIds: [],
			})
		).success,
	).toBe(true);
	harness.userId = target.userId;
	const responsibility =
		await grants.getDrivingLicenceVerifierResponsibilityAction();
	expect(
		responsibility.success && responsibility.data?.employmentPeriodId,
	).toBeTruthy();
});
