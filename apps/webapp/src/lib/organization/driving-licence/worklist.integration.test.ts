import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const session = vi.hoisted(() => ({
	userId: "",
	organizationId: "",
	now: "2026-01-31T11:00:00Z",
}));
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: async () => ({
		user: { id: session.userId },
		session: { activeOrganizationId: session.organizationId },
	}),
}));
vi.mock("@/lib/datetime/temporal-core", async (original) => {
	const actual = await original<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...actual,
		systemClock: { nowInstant: () => actual.parseInstant(session.now) },
	};
});
const policies = await import("./policy-actions");
const intendedDrivers = await import("./intended-driver-actions");
const grants = await import("./verifier-actions");
const checks = await import("./check-actions");
const { readDrivingLicenceCheckSubject } = await import("./check-subject");

const setup = {
	intervalMonths: 6,
	timezone: "Europe/Berlin",
	retentionMonths: 36,
	retentionJustification: "Organization driving evidence retention",
};
type CheckedClass = {
	code: "B" | "C";
	result: "successful" | "unsuccessful" | "inconclusive";
	expiryDate: string | null;
	restrictions: string;
};

let fixture: LifecycleDatabaseFixture;
let verifier: SeededEmployee;
let people: Record<"anna" | "bruno" | "carla" | "dora" | "erik" | "frank", SeededEmployee>;
let northTeamId: string;

async function as<T>(userId: string, operation: () => Promise<T>) {
	const previous = session.userId;
	session.userId = userId;
	try {
		return await operation();
	} finally {
		session.userId = previous;
	}
}
async function named(name: string, organizationId = fixture.organizationId) {
	const seeded = await fixture.seedEmployee({ organizationId });
	await fixture.pool.query(`update "user" set name=$1 where id=$2`, [name, seeded.userId]);
	return seeded;
}
async function createTeam(name: string, organizationId = fixture.organizationId) {
	const id = crypto.randomUUID();
	await fixture.pool.query(
		`insert into team (id, organization_id, name, updated_at) values ($1,$2,$3,now())`,
		[id, organizationId, name],
	);
	return id;
}
async function joinPrimaryTeam(employeeId: string, teamId: string) {
	await fixture.pool.query(`update employee set team_id=$1 where id=$2`, [teamId, employeeId]);
	await fixture.pool.query(
		`insert into team_membership (organization_id, team_id, employee_id) select organization_id, $1, id from employee where id=$2`,
		[teamId, employeeId],
	);
}
async function switchOn(ownerUserId = fixture.ownerUserId) {
	expect(
		await as(ownerUserId, () =>
			policies.switchDrivingLicenceControlAction({ enabled: true, setup }),
		),
	).toMatchObject({ success: true });
}
/** #1423 replaces enrollment with intended-driver assignments: swap this helper's body only. */
async function makeIntendedDriver(employeeId: string, ownerUserId = fixture.ownerUserId) {
	expect(
		await as(ownerUserId, () =>
			intendedDrivers.setDrivingLicenceIntendedDriverAssignmentAction({
				target: { type: "employee", employeeId },
				value: "required",
			}),
		),
	).toMatchObject({ success: true });
}
async function grantVerifier(
	verifierEmployeeId: string,
	scope: { scope: "all" | "specific"; teamIds?: string[] },
	ownerUserId = fixture.ownerUserId,
) {
	expect(
		await as(ownerUserId, () =>
			grants.saveDrivingLicenceVerifierGrantAction({
				verifierEmployeeId,
				scope: scope.scope,
				teamIds: scope.teamIds ?? [],
				employeeIds: [],
			}),
		),
	).toMatchObject({ success: true });
}
async function recordCheck(employeeId: string, classes: CheckedClass[]) {
	expect(
		await as(verifier.userId, () =>
			checks.completeDrivingLicenceCheckAction({
				employeeId,
				commandId: crypto.randomUUID(),
				originalInspected: true,
				identityConfirmed: true,
				employeeDeclaration: true,
				verifierConfirmed: true,
				documentIssuedOn: "2020-05-01",
				documentExpiresOn: "2035-05-01",
				classes,
			}),
		),
	).toMatchObject({ success: true });
}
function successful(code: "B" | "C", expiryDate: string): CheckedClass {
	return { code, result: "successful", expiryDate, restrictions: "" };
}
type WorklistQuery = Parameters<typeof checks.getDrivingLicenceCheckWorklistAction>[0];
async function worklist(userId: string, query?: WorklistQuery) {
	const result = await as(userId, () => checks.getDrivingLicenceCheckWorklistAction(query));
	if (!result.success) throw new Error(result.error);
	return result.data;
}
async function names(userId: string, query?: WorklistQuery) {
	return (await worklist(userId, query)).map((row) => row.name);
}

beforeEach(async () => {
	fixture = await createLifecycleDatabaseFixture();
	session.organizationId = fixture.organizationId;
	session.userId = fixture.ownerUserId;
	session.now = "2026-01-31T11:00:00Z";
	verifier = await named("Vera Verifier");
	people = {
		anna: await named("Anna Later"),
		bruno: await named("Bruno Soon"),
		carla: await named("Carla Unchecked"),
		dora: await named("Dora Partial"),
		erik: await named("Erik Expired"),
		frank: await named("Frank Bystander"),
	};
	northTeamId = await createTeam("North");
	await joinPrimaryTeam(people.anna.employeeId, northTeamId);
	await joinPrimaryTeam(people.bruno.employeeId, northTeamId);

	await switchOn();
	for (const person of [people.anna, people.bruno, people.carla, people.dora, people.erik])
		await makeIntendedDriver(person.employeeId);
	// The verifier is an intended driver too, yet never sees themselves.
	await makeIntendedDriver(verifier.employeeId);
	await grantVerifier(verifier.employeeId, { scope: "all" });

	await recordCheck(people.anna.employeeId, [successful("B", "2026-05-01")]);
	await recordCheck(people.bruno.employeeId, [successful("B", "2026-02-10")]);
	await recordCheck(people.dora.employeeId, [
		successful("B", "2026-04-01"),
		{ code: "C", result: "unsuccessful", expiryDate: null, restrictions: "" },
	]);
	await recordCheck(people.erik.employeeId, [successful("B", "2026-02-05")]);
	// Erik's class expiry has passed; Bruno's is still ahead.
	session.now = "2026-02-06T12:00:00Z";
});
afterEach(async () => fixture?.close());

describe("the verifier's Checks worklist", () => {
	it("lists intended drivers in scope with status, primary team and next deadline, checks due now first, then soonest deadline", async () => {
		const rows = await worklist(verifier.userId);
		expect(rows.map((row) => row.name)).toEqual([
			"Carla Unchecked",
			"Erik Expired",
			"Bruno Soon",
			"Dora Partial",
			"Anna Later",
		]);
		expect(rows.find((row) => row.name === "Bruno Soon")).toMatchObject({
			employeeId: people.bruno.employeeId,
			canVerify: true,
			status: "active",
			team: { id: northTeamId, name: "North" },
			nextDeadline: {
				validThrough: "2026-02-10",
				timezone: "Europe/Berlin",
				expiresAt: "2026-02-10T23:00:00.000Z",
			},
		});
		expect(rows.find((row) => row.name === "Dora Partial")).toMatchObject({
			status: "partially_active",
			team: null,
			nextDeadline: { validThrough: "2026-04-01", timezone: "Europe/Berlin" },
		});
		expect(rows.find((row) => row.name === "Carla Unchecked")).toMatchObject({
			status: "not_yet_checked",
			nextDeadline: null,
		});
		expect(rows.find((row) => row.name === "Erik Expired")).toMatchObject({
			status: "suspended",
			nextDeadline: null,
		});
	});

	it("never lists the verifier themselves or employees who are not intended drivers", async () => {
		const listed = await names(verifier.userId);
		expect(listed).not.toContain("Vera Verifier");
		expect(listed).not.toContain("Frank Bystander");
	});

	it.each([
		["not_yet_checked", ["Carla Unchecked"]],
		["active", ["Bruno Soon", "Anna Later"]],
		["partially_active", ["Dora Partial"]],
		["suspended", ["Erik Expired"]],
	] as const)("filters by status %s on the server", async (status, expected) => {
		expect(await names(verifier.userId, { status })).toEqual(expected);
	});

	it("searches by name on the server, case-insensitively and with wildcards taken literally", async () => {
		expect(await names(verifier.userId, { search: "bru" })).toEqual(["Bruno Soon"]);
		expect(await names(verifier.userId, { search: "  LATER " })).toEqual(["Anna Later"]);
		expect(await names(verifier.userId, { search: "%" })).toEqual([]);
		expect(await names(verifier.userId, { search: "r", status: "active" })).toEqual([
			"Bruno Soon",
			"Anna Later",
		]);
	});

	it("refuses an unknown status filter", async () => {
		expect(
			await as(verifier.userId, () =>
				// The UI never sends it; the server refuses it anyway.
				checks.getDrivingLicenceCheckWorklistAction({
					status: "ended",
				} as unknown as WorklistQuery),
			),
		).toMatchObject({ success: false });
	});

	it("keeps a team verifier to the employees their grant covers", async () => {
		const teamVerifier = await named("Tess Team");
		await grantVerifier(teamVerifier.employeeId, { scope: "specific", teamIds: [northTeamId] });
		expect(await names(teamVerifier.userId)).toEqual(["Bruno Soon", "Anna Later"]);
	});

	it("gives a member without a current grant an empty worklist", async () => {
		expect(await worklist(people.frank.userId)).toEqual([]);
	});

	it("reads only the active organization's intended drivers for a verifier in two organizations", async () => {
		const otherOrganizationId = await fixture.createOrganization();
		const otherOwner = await fixture.seedEmployee({
			organizationId: otherOrganizationId,
			role: "owner",
		});
		const otherDriver = await named("Olga Other", otherOrganizationId);
		const otherVerifierEmployeeId = crypto.randomUUID();
		await fixture.pool.query(
			`insert into member (id, organization_id, user_id, role, status, created_at) values ($1,$2,$3,'member','approved',now())`,
			[crypto.randomUUID(), otherOrganizationId, verifier.userId],
		);
		await fixture.pool.query(
			`insert into employee (id, user_id, organization_id, role, is_active, start_date, updated_at) values ($1,$2,$3,'employee',true,'2026-01-01',now())`,
			[otherVerifierEmployeeId, verifier.userId, otherOrganizationId],
		);
		await fixture.pool.query(
			`insert into employee_employment_period (id, organization_id, employee_id, status, started_at, start_provenance) values ($1,$2,$3,'open','2026-01-01','recorded')`,
			[crypto.randomUUID(), otherOrganizationId, otherVerifierEmployeeId],
		);
		session.organizationId = otherOrganizationId;
		await switchOn(otherOwner.userId);
		await makeIntendedDriver(otherDriver.employeeId, otherOwner.userId);
		await grantVerifier(otherVerifierEmployeeId, { scope: "all" }, otherOwner.userId);

		expect(await names(verifier.userId)).toEqual(["Olga Other"]);
		session.organizationId = fixture.organizationId;
		expect(await names(verifier.userId)).not.toContain("Olga Other");
	});
});

describe("the check page subject (#1429)", () => {
	const subject = (userId: string, employeeId: string, organizationId = fixture.organizationId) =>
		readDrivingLicenceCheckSubject({ organizationId, userId, employeeId });

	it("names an employee the viewer's current grant covers", async () => {
		expect(await subject(verifier.userId, people.bruno.employeeId)).toEqual({
			employeeId: people.bruno.employeeId,
			name: "Bruno Soon",
			canVerify: true,
		});
	});

	it("refuses the verifier's own check", async () => {
		expect(await subject(verifier.userId, verifier.employeeId)).toBeNull();
	});

	it("refuses an employee outside the grant and a viewer without a grant", async () => {
		const teamVerifier = await named("Tess Team");
		await grantVerifier(teamVerifier.employeeId, { scope: "specific", teamIds: [northTeamId] });
		expect(await subject(teamVerifier.userId, people.bruno.employeeId)).not.toBeNull();
		expect(await subject(teamVerifier.userId, people.carla.employeeId)).toBeNull();
		expect(await subject(people.frank.userId, people.bruno.employeeId)).toBeNull();
	});

	it("refuses an employee of another organization", async () => {
		const otherOrganizationId = await fixture.createOrganization();
		const stranger = await named("Olga Other", otherOrganizationId);
		expect(await subject(verifier.userId, stranger.employeeId)).toBeNull();
		expect(await subject(verifier.userId, people.bruno.employeeId, otherOrganizationId)).toBeNull();
	});
});
