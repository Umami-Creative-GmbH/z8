import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { SendEmailParams } from "@/lib/email/email-service";
import { createDepartureCommands } from "@/lib/employee-lifecycle/commands";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const harness = vi.hoisted(() => ({
	userId: "",
	organizationId: "",
	now: "2026-03-01T12:00:00Z",
	mail: vi.fn(async (_message: SendEmailParams) => ({ success: true })),
	transport: "smtp",
}));
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: { id: harness.userId, role: "user" },
				session: {
					id: `session-${harness.userId}`,
					userId: harness.userId,
					activeOrganizationId: harness.organizationId,
				},
			}),
		},
	},
}));
vi.mock("@/lib/email/email-service", async (original) => ({
	...(await (
		await import("@/test/integration-harness")
	).emailService(original)),
	getTransportName: async () => harness.transport,
	sendEmail: harness.mail,
}));
vi.mock("@/lib/app-url", () => ({
	getOrganizationBaseUrl: async () => "https://z8.test",
}));
vi.mock("@/lib/datetime/temporal-core", async (original) => {
	const actual =
		await original<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...actual,
		systemClock: { nowInstant: () => actual.parseInstant(harness.now) },
	};
});
const actions = await import("@/lib/organization/equipment/actions");
const { runEquipmentRemindersJob } = await import("./equipment-reminders");
const { getUserNotifications } = await import(
	"@/lib/notifications/notification-service"
);
let fixture: LifecycleDatabaseFixture;
let subjectUserId: string;
let typeId: string;
beforeEach(async () => {
	fixture = await createLifecycleDatabaseFixture();
	harness.organizationId = fixture.organizationId;
	harness.userId = fixture.ownerUserId;
	harness.now = "2026-03-01T12:00:00Z";
	harness.transport = "smtp";
	harness.mail.mockReset().mockResolvedValue({ success: true });
	await fixture.pool.query(
		"update organization set timezone='Europe/Berlin', equipment_enabled=true where id=$1",
		[fixture.organizationId],
	);
	subjectUserId = (
		await fixture.pool.query("select user_id from employee where id=$1", [
			fixture.employeeId,
		])
	).rows[0].user_id;
	await setup({
		kind: "configure_policy",
		retentionMonths: 24,
		expectedRevision: 0,
	});
	typeId = (
		await setup({
			kind: "create_type",
			name: "Shirts",
			trackingMode: "quantity",
			defaultReturnRequired: true,
		})
	).id;
});
afterEach(async () => {
	await fixture?.close();
});
async function setup(input: Record<string, unknown>) {
	const result = await actions.changeEquipmentSetup({
		requestId: crypto.randomUUID(),
		...input,
	});
	if (!result.success || !result.data.ok)
		throw new Error(JSON.stringify(result));
	return result.data;
}
async function issue(extra: Record<string, unknown> = {}) {
	const detail = await actions.getEquipmentSetupDetail({
		kind: "type",
		id: typeId,
	});
	if (!detail.success || !detail.data)
		throw new Error("Equipment type missing");
	return change({
		kind: "issue_quantity",
		typeId,
		employeeId: fixture.employeeId,
		expectedRevision: detail.data.record.revision,
		quantity: 3,
		actualDate: "2026-03-01",
		condition: "good",
		returnRequired: true,
		explicitDeadline: "2026-03-30",
		...extra,
	});
}
async function change(input: Record<string, unknown>) {
	const result = await actions.changeEquipment({
		requestId: crypto.randomUUID(),
		...input,
	});
	if (!result.success || !result.data.ok)
		throw new Error(JSON.stringify(result));
	return result.data;
}
async function inbox(userId = subjectUserId) {
	return (
		await getUserNotifications(userId, fixture.organizationId, { limit: 100 })
	).notifications;
}

it("delivers the employee's three-calendar-day and deadline occasions once across DST and organization midnight", async () => {
	await issue();
	harness.now = "2026-03-26T22:59:59Z";
	await runEquipmentRemindersJob();
	expect(await inbox()).toHaveLength(0);
	harness.now = "2026-03-26T23:00:00Z"; // March 27 in Berlin, three calendar days before March 30.
	await runEquipmentRemindersJob();
	expect(await inbox()).toMatchObject([
		{ type: "equipment_return_reminder", actionUrl: "/my-equipment" },
	]);
	expect(harness.mail.mock.calls.map(([m]) => m.to)).toEqual([
		`${subjectUserId}@lifecycle.test`,
	]);
	expect(harness.mail.mock.calls[0][0].html).toContain(
		'href="https://z8.test/my-equipment"',
	);
	await runEquipmentRemindersJob();
	expect(await inbox()).toHaveLength(1);
	expect(harness.mail).toHaveBeenCalledTimes(1);
	harness.now = "2026-03-29T21:59:59Z";
	await runEquipmentRemindersJob();
	expect(await inbox()).toHaveLength(1);
	harness.now = "2026-03-29T22:00:00Z"; // March 30 after the DST jump.
	await runEquipmentRemindersJob();
	expect(await inbox()).toHaveLength(2);
	expect(harness.mail).toHaveBeenCalledTimes(2);
	expect(await inbox(fixture.ownerUserId)).toHaveLength(0);
});

it("sends no reminders while equipment tracking is switched off, and resumes once it is back on (#1572)", async () => {
	await issue();
	await fixture.pool.query(
		"update organization set equipment_enabled=false where id=$1",
		[fixture.organizationId],
	);
	harness.now = "2026-03-26T23:00:00Z"; // March 27 in Berlin, an employee occasion.
	await runEquipmentRemindersJob();
	expect(await inbox()).toHaveLength(0);
	expect(harness.mail).not.toHaveBeenCalled();
	await fixture.pool.query(
		"update organization set equipment_enabled=true where id=$1",
		[fixture.organizationId],
	);
	await runEquipmentRemindersJob();
	expect(await inbox()).toHaveLength(1);
});

async function grant(officerId: string, extra: Record<string, unknown> = {}) {
	const result = await actions.changeEquipmentOfficerGrant({
		kind: "set_officer_grant",
		requestId: crypto.randomUUID(),
		employeeId: officerId,
		expectedRevision: 0,
		scope: "selected",
		teamIds: [],
		employeeIds: [fixture.employeeId],
		...extra,
	});
	if (!result.success || !result.data.ok)
		throw new Error(JSON.stringify(result));
	return result.data;
}
it("notifies only covering officers on the first overdue day and every seven calendar days, including concurrent runs", async () => {
	await issue();
	const officer = await fixture.seedEmployee();
	const otherOfficer = await fixture.seedEmployee();
	await grant(officer.employeeId);
	await grant(otherOfficer.employeeId, {
		employeeIds: [otherOfficer.employeeId],
	});
	harness.now = "2026-03-30T22:00:00Z";
	await Promise.all([runEquipmentRemindersJob(), runEquipmentRemindersJob()]);
	expect(await inbox(officer.userId)).toMatchObject([
		{ actionUrl: `/equipment?holderId=${fixture.employeeId}&outstanding=true` },
	]);
	expect(await inbox(fixture.ownerUserId)).toHaveLength(0);
	expect(await inbox(otherOfficer.userId)).toHaveLength(0);
	expect(await inbox()).toHaveLength(0);
	expect(harness.mail).toHaveBeenCalledTimes(1);
	for (const day of ["2026-04-01T12:00:00Z", "2026-04-06T12:00:00Z"]) {
		harness.now = day;
		await runEquipmentRemindersJob();
	}
	expect(await inbox(officer.userId)).toHaveLength(1);
	harness.now = "2026-04-07T12:00:00Z";
	await runEquipmentRemindersJob();
	expect(await inbox(officer.userId)).toHaveLength(2);
	expect(harness.mail).toHaveBeenCalledTimes(2);
});

it("keeps reminders staff-only for old deactivation lineage after access is restored", async () => {
	const issued = await issue();
	// Fixture a recorded ending subsequently reactivated in the same employment period.
	const deactivationId = crypto.randomUUID();
	await fixture.pool.query(
		`insert into employee_deactivation(id,organization_id,employee_id,employment_period_id,reason,deactivated_at,created_by,request_id,request_fingerprint,reactivated_at,reactivated_by) values($1,$2,$3,$4,'employee_deactivated', '2026-03-20T12:00:00Z',$5,$6,'fixture','2026-03-25T12:00:00Z',$5)`,
		[
			deactivationId,
			fixture.organizationId,
			fixture.employeeId,
			fixture.employmentPeriodId,
			fixture.ownerUserId,
			crypto.randomUUID(),
		],
	);
	await fixture.pool.query(
		"update equipment_assignment set deactivation_id=$1 where organization_id=$2 and id=$3",
		[deactivationId, fixture.organizationId, issued.id],
	);
	harness.now = "2026-03-27T12:00:00Z";
	await runEquipmentRemindersJob();
	expect(await inbox()).toHaveLength(0);
	expect(harness.mail).not.toHaveBeenCalled();
});

async function preference(userId: string, channel: string, enabled: boolean) {
	await fixture.pool.query(
		"insert into notification_preference(user_id,notification_type,channel,enabled,updated_at) values($1,'equipment_return_reminder',$2,$3,now()) on conflict(user_id,notification_type,channel) do update set enabled=excluded.enabled",
		[userId, channel, enabled],
	);
}
async function assignment(id: string) {
	const result = await actions.getEmployeeEquipment(fixture.employeeId);
	if (!result.success) throw new Error(JSON.stringify(result));
	const found = result.data.assignments.find((a) => a.id === id);
	if (!found) throw new Error("Assignment missing from authorized read");
	return found;
}
async function correctDeadline(id: string, deadline: string | null) {
	const current = await assignment(id);
	return change({
		kind: "correct_issue",
		assignmentId: id,
		expectedRevision: current.revision,
		reason: "Correct agreed return date",
		quantity: current.quantity,
		actualDate: current.issue.actualDate,
		condition: current.issue.condition,
		notes: current.issue.notes ?? "",
		returnRequired: true,
		explicitDeadline: deadline,
		employmentPeriodId: current.employmentPeriodId,
	});
}
async function pending(
	id: string,
	recipient: string,
	audience = "staff",
	date = "2026-03-31",
	deadline = "2026-03-30",
) {
	await fixture.pool.query(
		`insert into equipment_reminder_delivery(organization_id,assignment_id,deadline,timezone,occasion_date,audience,recipient_user_id,channel,created_at) values($1,$2,$3,'Europe/Berlin',$4,$5,$6,'email','2026-03-01T12:00:00Z')`,
		[fixture.organizationId, id, deadline, date, audience, recipient],
	);
}
it("honors optional per-channel preferences and renders the email and date in the recipient language", async () => {
	await issue();
	await preference(subjectUserId, "in_app", false);
	await fixture.pool.query(
		"insert into user_settings(user_id,locale,updated_at) values($1,'de',now())",
		[subjectUserId],
	);
	harness.now = "2026-03-27T12:00:00Z";
	await runEquipmentRemindersJob();
	expect(await inbox()).toHaveLength(0);
	expect(harness.mail).toHaveBeenCalledTimes(1);
	expect(harness.mail.mock.calls[0][0].html).toContain('lang="de"');
	expect(harness.mail.mock.calls[0][0].html).toContain("30. März 2026");
	await preference(subjectUserId, "email", false);
	await preference(subjectUserId, "in_app", true);
	harness.now = "2026-03-30T12:00:00Z";
	await runEquipmentRemindersJob();
	expect(await inbox()).toHaveLength(1);
	expect(harness.mail).toHaveBeenCalledTimes(1);
});
it("recalculates corrected deadlines and suppresses queued notices for the old or cancelled date", async () => {
	const issued = await issue();
	await pending(issued.id, subjectUserId, "employee", "2026-03-27");
	await correctDeadline(issued.id, "2026-03-31");
	harness.now = "2026-03-27T12:00:00Z";
	await runEquipmentRemindersJob();
	expect(await inbox()).toHaveLength(0);
	expect(harness.mail).not.toHaveBeenCalled();
	harness.now = "2026-03-28T12:00:00Z";
	await runEquipmentRemindersJob();
	expect(await inbox()).toHaveLength(1);
	expect(harness.mail).toHaveBeenCalledTimes(1);
	await correctDeadline(issued.id, null);
	harness.now = "2026-03-31T12:00:00Z";
	await runEquipmentRemindersJob();
	expect(await inbox()).toHaveLength(1);
	expect(harness.mail).toHaveBeenCalledTimes(1);
});
it("uses partial receipt and corrected receipt balances, then stops when fully returned", async () => {
	const issued = await issue();
	await change({
		kind: "receive_quantity",
		assignmentId: issued.id,
		expectedRevision: 1,
		quantity: 2,
		actualDate: "2026-03-01",
		condition: "worn",
	});
	harness.now = "2026-03-31T12:00:00Z";
	await runEquipmentRemindersJob();
	expect((await inbox(fixture.ownerUserId))[0].message).toContain("(1)");
	const current = await assignment(issued.id);
	await change({
		kind: "correct_receipt",
		assignmentId: issued.id,
		handoverId: current.receipts[0].id,
		expectedRevision: current.revision,
		quantity: 1,
		actualDate: "2026-03-01",
		condition: "worn",
		notes: "",
		reason: "Only one shirt received",
	});
	harness.now = "2026-04-07T12:00:00Z";
	await runEquipmentRemindersJob();
	expect((await inbox(fixture.ownerUserId))[0].message).toContain("(2)");
	await change({
		kind: "receive_quantity",
		assignmentId: issued.id,
		expectedRevision: (await assignment(issued.id)).revision,
		quantity: 2,
		actualDate: "2026-04-07",
		condition: "good",
	});
	harness.now = "2026-04-14T12:00:00Z";
	await runEquipmentRemindersJob();
	expect(await inbox(fixture.ownerUserId)).toHaveLength(2);
	expect(harness.mail).toHaveBeenCalledTimes(2);
});
it.each(["lost", "waived"])(
	"stops for %s closures and resumes after a reasoned reversal without claiming receipt",
	async (outcome) => {
		const issued = await issue();
		const closed = await change({
			kind: "close_return",
			assignmentId: issued.id,
			expectedRevision: 1,
			outcome,
			quantity: 3,
			reason: "Recorded decision",
		});
		harness.now = "2026-03-31T12:00:00Z";
		await runEquipmentRemindersJob();
		expect(await inbox(fixture.ownerUserId)).toHaveLength(0);
		expect(harness.mail).not.toHaveBeenCalled();
		const current = await assignment(issued.id);
		expect(current.receipts).toHaveLength(0);
		await change({
			kind: "correct_exception",
			assignmentId: issued.id,
			exceptionId: current.exceptions[0].id,
			expectedRevision: closed.revision,
			quantity: 0,
			outcome,
			reason: "Mistaken decision reversed",
			decisionReason: "The obligation remains",
		});
		harness.now = "2026-04-07T12:00:00Z";
		await runEquipmentRemindersJob();
		expect(await inbox(fixture.ownerUserId)).toHaveLength(1);
		expect(harness.mail).toHaveBeenCalledTimes(1);
	},
);
it("does not double-settle recovered lost quantities and follows effective exception corrections", async () => {
	const issued = await issue();
	await change({
		kind: "close_return",
		assignmentId: issued.id,
		expectedRevision: 1,
		outcome: "lost",
		quantity: 2,
		reason: "Missing shirts",
	});
	let current = await assignment(issued.id);
	await change({
		kind: "receive_exception",
		assignmentId: issued.id,
		exceptionId: current.exceptions[0].id,
		expectedRevision: current.revision,
		quantity: 2,
		actualDate: "2026-03-01",
		condition: "good",
	});
	harness.now = "2026-03-31T12:00:00Z";
	await runEquipmentRemindersJob();
	expect((await inbox(fixture.ownerUserId))[0].message).toContain("(1)");
	current = await assignment(issued.id);
	await change({
		kind: "correct_exception",
		assignmentId: issued.id,
		exceptionId: current.exceptions[0].id,
		expectedRevision: current.revision,
		quantity: 3,
		outcome: "lost",
		reason: "Third shirt also lost",
		decisionReason: "All three missing at the time",
	});
	harness.now = "2026-04-07T12:00:00Z";
	await runEquipmentRemindersJob();
	expect(await inbox(fixture.ownerUserId)).toHaveLength(1);
	expect(harness.mail).toHaveBeenCalledTimes(1);
});
it("never schedules issued-to-keep equipment, undated loans or resolved returns", async () => {
	await issue({ returnRequired: false, explicitDeadline: null });
	await issue({ explicitDeadline: null });
	const received = await issue();
	await change({
		kind: "receive_quantity",
		assignmentId: received.id,
		expectedRevision: 1,
		quantity: 3,
		actualDate: "2026-03-01",
		condition: "good",
	});
	for (const day of [
		"2026-03-27T12:00:00Z",
		"2026-03-30T12:00:00Z",
		"2026-03-31T12:00:00Z",
	]) {
		harness.now = day;
		await runEquipmentRemindersJob();
	}
	expect(await inbox()).toHaveLength(0);
	expect(await inbox(fixture.ownerUserId)).toHaveLength(0);
	expect(harness.mail).not.toHaveBeenCalled();
});
it("rechecks queued recipient scope after grant revocation and falls back to an accessible administrator", async () => {
	const issued = await issue();
	const officer = await fixture.seedEmployee();
	const admin = await fixture.seedEmployee({ role: "owner" });
	await grant(officer.employeeId);
	await pending(issued.id, officer.userId);
	expect(
		await actions.changeEquipmentOfficerGrant({
			kind: "revoke_officer_grant",
			requestId: crypto.randomUUID(),
			employeeId: officer.employeeId,
			expectedRevision: 1,
		}),
	).toMatchObject({ success: true, data: { ok: true } });
	await fixture.pool.query("update employee set is_active=false where id=$1", [
		fixture.ownerEmployeeId,
	]);
	harness.now = "2026-03-31T12:00:00Z";
	await runEquipmentRemindersJob();
	expect(await inbox(officer.userId)).toHaveLength(0);
	expect(await inbox(fixture.ownerUserId)).toHaveLength(0);
	expect(await inbox(admin.userId)).toHaveLength(1);
	expect(harness.mail.mock.calls.map(([m]) => m.to)).toEqual([
		`${admin.userId}@lifecycle.test`,
	]);
});
it("does not resend an external attempt after an ambiguous transport failure", async () => {
	await issue();
	harness.now = "2026-03-27T12:00:00Z";
	harness.mail.mockRejectedValueOnce(new Error("Transport connection lost"));
	expect(await runEquipmentRemindersJob()).toMatchObject({
		externalFailed: 1,
		inAppCreated: 1,
	});
	await runEquipmentRemindersJob();
	expect(await inbox()).toHaveLength(1);
	expect(harness.mail).toHaveBeenCalledTimes(1);
});

function departures() {
	return createDepartureCommands({
		db: fixture.db,
		clock: { nowInstant: () => parseInstant(harness.now) },
		clockOut: { close: async () => ({ kind: "not_running" }) },
	});
}
const actor = () => ({
	organizationId: fixture.organizationId,
	userId: fixture.ownerUserId,
});
async function schedule(
	lastWorkingDay: string,
	expectedRevision: number | null = null,
) {
	return departures().scheduleDeparture(actor(), {
		employeeId: fixture.employeeId,
		requestId: crypto.randomUUID(),
		expectedRevision,
		lastWorkingDay,
		replacementEmployeeId: null,
		acknowledgeUnassignedDuties: false,
	});
}
it("moves and cancels lifecycle-derived occasions while retaining an independent explicit deadline", async () => {
	const undated = await issue({ explicitDeadline: null });
	await issue({ explicitDeadline: "2026-03-29" });
	const first = await schedule("2026-03-30");
	await pending(undated.id, subjectUserId, "employee", "2026-03-27");
	const moved = await schedule("2026-04-02", first.revision);
	harness.now = "2026-03-27T12:00:00Z";
	await runEquipmentRemindersJob();
	expect(await inbox()).toHaveLength(0);
	await departures().cancelDeparture(actor(), {
		employeeId: fixture.employeeId,
		departureId: moved.departureId,
		expectedRevision: moved.revision,
		requestId: crypto.randomUUID(),
	});
	harness.now = "2026-03-29T12:00:00Z";
	await runEquipmentRemindersJob();
	expect(await inbox()).toHaveLength(1);
	expect(harness.mail).toHaveBeenCalledTimes(1);
	harness.now = "2026-03-30T12:00:00Z";
	await runEquipmentRemindersJob();
	// Only the independent March 29 loan is overdue; the undated loan stays silent.
	expect(await inbox(fixture.ownerUserId)).toHaveLength(1);
	expect(harness.mail).toHaveBeenCalledTimes(2);
});
it("uses current team coverage, then captured former-team scope after departure and roster cleanup", async () => {
	await issue();
	const officer = await fixture.seedEmployee();
	const teamId = crypto.randomUUID();
	await fixture.pool.query(
		"insert into team(id,organization_id,name,updated_at) values($1,$2,'Equipment team',now())",
		[teamId, fixture.organizationId],
	);
	await fixture.pool.query("update employee set team_id=$1 where id=$2", [
		teamId,
		fixture.employeeId,
	]);
	await grant(officer.employeeId, { employeeIds: [], teamIds: [teamId] });
	harness.now = "2026-03-31T12:00:00Z";
	await runEquipmentRemindersJob();
	expect(await inbox(officer.userId)).toHaveLength(1);
	// Ending access captures the team before removing it from the current roster.
	expect(
		await departures().offboardNow(actor(), {
			employeeId: fixture.employeeId,
			requestId: crypto.randomUUID(),
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: false,
		}),
	).toMatchObject({ status: "effective" });
	harness.now = "2026-04-07T12:00:00Z";
	await runEquipmentRemindersJob();
	expect(await inbox(officer.userId)).toHaveLength(2);
	expect(await inbox()).toHaveLength(0);
	expect(await inbox(fixture.ownerUserId)).toHaveLength(0);
	expect(harness.mail.mock.calls.map(([m]) => m.to)).toEqual([
		`${officer.userId}@lifecycle.test`,
		`${officer.userId}@lifecycle.test`,
	]);
	// A departed officer's old grant cannot receive the next occasion; the owner takes over.
	expect(
		await departures().offboardNow(actor(), {
			employeeId: officer.employeeId,
			requestId: crypto.randomUUID(),
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: false,
		}),
	).toMatchObject({ status: "effective" });
	harness.now = "2026-04-14T12:00:00Z";
	await runEquipmentRemindersJob();
	expect(await inbox(officer.userId)).toHaveLength(2);
	expect(await inbox(fixture.ownerUserId)).toHaveLength(1);
});
it("never sends employee reminders after a pending departure cutoff, before maintenance materializes it", async () => {
	await issue();
	await schedule("2026-03-26");
	// March 27 is already past cutoff, so only staff follow-up is permitted.
	harness.now = "2026-03-26T23:00:00Z";
	await runEquipmentRemindersJob();
	expect(await inbox()).toHaveLength(0);
	expect(await inbox(fixture.ownerUserId)).toHaveLength(1);
	expect(harness.mail.mock.calls.map(([m]) => m.to)).toEqual([
		`${fixture.ownerUserId}@lifecycle.test`,
	]);
});
it("suppresses stale queued delivery after full settlement and rejects a foreign organization's recipient", async () => {
	const issued = await issue();
	await pending(issued.id, fixture.ownerUserId);
	const foreignOrganization = await fixture.createOrganization();
	const outsider = await fixture.seedEmployee({
		organizationId: foreignOrganization,
		role: "owner",
	});
	await pending(issued.id, outsider.userId);
	await change({
		kind: "receive_quantity",
		assignmentId: issued.id,
		expectedRevision: 1,
		quantity: 3,
		actualDate: "2026-03-01",
		condition: "good",
	});
	harness.now = "2026-03-31T12:00:00Z";
	await runEquipmentRemindersJob();
	expect(await inbox(fixture.ownerUserId)).toHaveLength(0);
	expect(await inbox(outsider.userId)).toHaveLength(0);
	expect(harness.mail).not.toHaveBeenCalled();
	// Reopen one quantity through the public correction boundary; the foreign recipient remains forbidden.
	const current = await assignment(issued.id);
	await change({
		kind: "correct_receipt",
		assignmentId: issued.id,
		handoverId: current.receipts[0].id,
		expectedRevision: current.revision,
		quantity: 2,
		actualDate: "2026-03-01",
		condition: "good",
		notes: "",
		reason: "One shirt not received",
	});
	harness.now = "2026-04-07T12:00:00Z";
	await pending(issued.id, outsider.userId, "staff", "2026-04-07");
	await runEquipmentRemindersJob();
	expect(await inbox(fixture.ownerUserId)).toHaveLength(1);
	expect(await inbox(outsider.userId)).toHaveLength(0);
	expect(harness.mail.mock.calls.map(([m]) => m.to)).toEqual([
		`${fixture.ownerUserId}@lifecycle.test`,
	]);
});
it("honors channel availability without sending through an unavailable email transport", async () => {
	await issue();
	harness.transport = "console";
	harness.now = "2026-03-27T12:00:00Z";
	await runEquipmentRemindersJob();
	expect(await inbox()).toHaveLength(1);
	expect(harness.mail).not.toHaveBeenCalled();
	await runEquipmentRemindersJob();
	expect(await inbox()).toHaveLength(1);
});

it("dispatches queued former-team reminders only for their own employment ending after rehire", async () => {
	const officer = await fixture.seedEmployee();
	const teamA = crypto.randomUUID(),
		teamB = crypto.randomUUID();
	for (const team of [teamA, teamB])
		await fixture.pool.query(
			"insert into team(id,organization_id,name,updated_at) values($1,$2,'Returns',now())",
			[team, fixture.organizationId],
		);
	await fixture.pool.query("update employee set team_id=$1 where id=$2", [
		teamA,
		fixture.employeeId,
	]);
	await grant(officer.employeeId, { employeeIds: [], teamIds: [teamA] });
	const old = await issue({ explicitDeadline: null });
	harness.now = "2026-03-20T12:00:00Z";
	expect(
		await departures().offboardNow(actor(), {
			employeeId: fixture.employeeId,
			requestId: crypto.randomUUID(),
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: false,
		}),
	).toMatchObject({ status: "effective" });
	const policy = await fixture.pool.query(
		"insert into work_policy(organization_id,name,created_by,updated_at) values($1,'Rehire policy',$2,now()) returning id",
		[fixture.organizationId, fixture.ownerUserId],
	);
	harness.now = "2026-03-21T12:00:00Z";
	await departures().rehireEmployee(actor(), {
		employeeId: fixture.employeeId,
		requestId: crypto.randomUUID(),
		previousEmploymentPeriodId: fixture.employmentPeriodId,
		role: "employee",
		teamId: teamB,
		primaryManagerId: null,
		workPolicyId: policy.rows[0].id,
		weeklyContractMinutes: 2400,
		contractType: "fixed",
		workModel: "onsite",
		hourlyRate: null,
		currency: "EUR",
		probationStartsOn: null,
		probationEndsOn: null,
		changeReason: "Return",
	});
	const fresh = await issue({
		actualDate: "2026-03-21",
		explicitDeadline: null,
	});
	harness.now = "2026-03-27T12:00:00Z";
	expect(
		await departures().offboardNow(actor(), {
			employeeId: fixture.employeeId,
			requestId: crypto.randomUUID(),
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: false,
		}),
	).toMatchObject({ status: "effective" });
	// A stale pending external attempt for B must not inherit this officer's A grant.
	await pending(fresh.id, officer.userId, "staff", "2026-03-28", "2026-03-27");
	harness.now = "2026-03-28T12:00:00Z";
	await runEquipmentRemindersJob();
	const notices = await inbox(officer.userId);
	expect(notices).toHaveLength(1);
	expect(notices[0].entityId).toBe(old.id);
	expect((await inbox(fixture.ownerUserId)).map((n) => n.entityId)).toEqual([
		fresh.id,
	]);
	expect(
		harness.mail.mock.calls.filter(
			([m]) => m.to === `${officer.userId}@lifecycle.test`,
		),
	).toHaveLength(1);
});
