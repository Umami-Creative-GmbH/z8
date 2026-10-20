import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SendEmailParams } from "@/lib/email/email-service";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const harness = vi.hoisted(() => ({
	userId: "",
	organizationId: "",
	now: "2026-01-31T11:00:00Z",
	mail: vi.fn(async (_message: SendEmailParams) => ({ success: true })),
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
vi.mock("@/lib/email/email-service", () => ({ sendEmail: harness.mail }));
vi.mock("@/lib/app-url", () => ({
	getOrganizationBaseUrl: async () => "https://z8.test",
}));
vi.mock("@/lib/datetime/temporal-core", async (original) => {
	const actual =
		await original<typeof import("@/lib/datetime/temporal-core")>();
	return {
		...actual,
		systemClock: Object.freeze({
			nowInstant: () => actual.parseInstant(harness.now),
		}),
	};
});
const checks = await import("@/lib/organization/driving-licence/check-actions");
const policy = await import(
	"@/lib/organization/driving-licence/policy-actions"
);
const grants = await import(
	"@/lib/organization/driving-licence/verifier-actions"
);
const { runDrivingLicenceRemindersJob } = await import(
	"./driving-licence-reminders"
);
const { getUserNotifications, loadNotificationChannelPreferences } =
	await import("@/lib/notifications/notification-service");
let fixture: LifecycleDatabaseFixture;
let verifier: SeededEmployee;
let subjectUserId: string;
function original(
	documentExpiresOn = "2035-05-01",
	classes = [
		{
			code: "B",
			result: "successful",
			expiryDate: null as string | null,
			restrictions: "",
		},
	],
) {
	return {
		employeeId: fixture.employeeId,
		commandId: crypto.randomUUID(),
		originalInspected: true,
		identityConfirmed: true,
		employeeDeclaration: true,
		verifierConfirmed: true,
		documentIssuedOn: "2020-05-01",
		documentExpiresOn,
		classes,
	};
}
async function changeInterval(intervalMonths: number) {
	const intervals = await import(
		"@/lib/organization/driving-licence/interval-actions"
	);
	const preview = await intervals.previewDrivingLicenceIntervalAction({
		intervalMonths,
	});
	if (!preview.success) throw new Error(preview.error);
	expect(
		(
			await intervals.applyDrivingLicenceIntervalAction({
				intervalMonths,
				previewToken: preview.data.previewToken,
			})
		).success,
	).toBe(true);
}
async function inbox(userId = subjectUserId) {
	return (await getUserNotifications(userId, fixture.organizationId))
		.notifications;
}
beforeEach(async () => {
	fixture = await createLifecycleDatabaseFixture();
	verifier = await fixture.seedEmployee();
	harness.organizationId = fixture.organizationId;
	harness.userId = fixture.ownerUserId;
	harness.now = "2026-01-31T11:00:00Z";
	harness.mail.mockReset().mockResolvedValue({ success: true });
	subjectUserId = (
		await fixture.pool.query("select user_id from employee where id=$1", [
			fixture.employeeId,
		])
	).rows[0].user_id;
	expect(
		(
			await policy.saveDrivingLicencePolicyAction({
				enabled: true,
				intervalMonths: 1,
				timezone: "Europe/Berlin",
				reminderLeadDays: [30, 7],
				retentionMonths: 36,
				retentionJustification:
					"Evidence retained for organization driving checks",
			})
		).success,
	).toBe(true);
	expect(
		(
			await policy.enrollDrivingLicenceEmployeeAction({
				employeeId: fixture.employeeId,
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
	harness.userId = verifier.userId;
});
afterEach(async () => {
	await fixture?.close();
});

it("persists mandatory unread inbox reminders on the exact organization-zone lead day, despite opt-outs, only for the employee and scoped verifier", async () => {
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(true);
	for (const userId of [subjectUserId, verifier.userId])
		for (const channel of ["in_app", "email"]) {
			await fixture.pool.query(
				`insert into notification_preference (user_id,notification_type,channel,enabled,updated_at) values ($1,'driving_licence_reminder',$2,false,now())`,
				[userId, channel],
			);
		}
	harness.now = "2026-02-20T23:00:00Z"; // 21 February in the deadline's Berlin zone: exactly seven days.
	await runDrivingLicenceRemindersJob();
	const mine = await inbox();
	expect(mine).toHaveLength(1);
	expect(mine[0]).toMatchObject({
		type: "driving_licence_reminder",
		isRead: false,
		readAt: null,
		actionUrl: "/driving-licence",
	});
	expect(await inbox(verifier.userId)).toHaveLength(1);
	expect(await inbox(fixture.ownerUserId)).toHaveLength(0);
	expect(harness.mail).not.toHaveBeenCalled();
	expect(
		(
			await loadNotificationChannelPreferences(
				subjectUserId,
				"driving_licence_reminder",
			)
		).in_app,
	).toBe(true);
	await runDrivingLicenceRemindersJob();
	expect(await inbox()).toHaveLength(1);
});

it("links the employee to their own licence and each verifier to the employee's check page, in the inbox and in email (#1429)", async () => {
	expect(
		(await checks.completeDrivingLicenceCheckAction(original("2026-02-10"))).success,
	).toBe(true);
	const checkPage = `/driving-licence/checks/${fixture.employeeId}`;
	harness.now = "2026-02-05T10:00:00Z"; // Within seven days of the document's expiry.
	await runDrivingLicenceRemindersJob();
	expect((await inbox()).map((n) => n.actionUrl)).toEqual(["/driving-licence"]);
	expect((await inbox(verifier.userId)).map((n) => n.actionUrl)).toEqual([checkPage]);
	const mailTo = (userId: string) =>
		harness.mail.mock.calls
			.map(([message]) => message)
			.find((message) => message.to === `${userId}@lifecycle.test`)?.html;
	expect(mailTo(subjectUserId)).toContain('href="https://z8.test/driving-licence"');
	expect(mailTo(verifier.userId)).toContain(`href="https://z8.test${checkPage}"`);

	harness.now = "2026-02-10T23:00:00Z"; // The document has expired in Berlin.
	await runDrivingLicenceRemindersJob();
	const suspended = (userId: string) =>
		inbox(userId).then((notices) =>
			notices
				.filter((n) => n.type === "driving_authorization_suspended")
				.map((n) => n.actionUrl),
		);
	expect(await suspended(subjectUserId)).toEqual(["/driving-licence"]);
	expect(await suspended(verifier.userId)).toEqual([checkPage]);
});

it("persists an uncertain email attempt before provider acceptance and never blindly retries an ambiguous outcome", async () => {
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(true);
	await fixture.pool.query(
		`insert into user_settings (user_id,locale,updated_at) values ($1,'de',now())`,
		[subjectUserId],
	);
	harness.now = "2026-02-21T10:00:00Z";
	let durableAttempts: unknown;
	harness.mail.mockImplementationOnce(async () => {
		const attempts = await fixture.pool.query(
			"select email_state,email_attempts,emailed_at from driving_licence_reminder_delivery where organization_id=$1 and email_state='attempted'",
			[fixture.organizationId],
		);
		durableAttempts = attempts.rows;
		// SMTP accepted this message, but the response was lost before the caller knew.
		throw new Error("connection lost after acceptance");
	});
	const first = await runDrivingLicenceRemindersJob();
	expect(durableAttempts).toMatchObject([
		{ email_state: "attempted", email_attempts: 1, emailed_at: null },
	]);
	expect(first.emailFailed).toBe(1);
	expect(first.emailSent).toBe(1);
	harness.userId = harness.mail.mock.calls[0][0].to.replace(
		"@lifecycle.test",
		"",
	);
	expect(
		await checks.getDrivingLicenceEmployeeRecordAction({
			employeeId: fixture.employeeId,
		}),
	).toMatchObject({ success: true, data: { uncertainEmailCount: 1 } });

	expect(await inbox()).toHaveLength(1);
	expect(await inbox(verifier.userId)).toHaveLength(1);
	const second = await runDrivingLicenceRemindersJob();
	expect(second.emailSent).toBe(0);
	expect(harness.mail).toHaveBeenCalledTimes(2);
	const german = harness.mail.mock.calls
		.map((args) => args[0])
		.find((mail) => mail.to === `${subjectUserId}@lifecycle.test`);
	expect(german?.html).toContain('lang="de"');
	expect(german?.html).toContain("28. Feb. 2026");
	await runDrivingLicenceRemindersJob();
	expect(harness.mail).toHaveBeenCalledTimes(2);
	expect(await inbox()).toHaveLength(1);
});

it("uses the earliest class or document limit, catches up missed lead days, and materializes expiry without waiting for delivery", async () => {
	expect(
		(
			await checks.completeDrivingLicenceCheckAction(
				original("2026-02-10", [
					{
						code: "B",
						result: "successful",
						expiryDate: null,
						restrictions: "",
					},
					{
						code: "C",
						result: "successful",
						expiryDate: "2026-02-05",
						restrictions: "",
					},
				]),
			)
		).success,
	).toBe(true);
	harness.now = "2026-02-01T10:00:00Z"; // C is within 7 days, B within 30 days.
	await runDrivingLicenceRemindersJob();
	const reminders = await inbox();
	expect(reminders).toHaveLength(2);
	const metadata = reminders.map((n) => JSON.parse(n.metadata ?? "null"));
	expect(metadata.map((m) => m.i18n.params.deadline.date).sort()).toEqual([
		"2026-02-05",
		"2026-02-10",
	]);
	harness.now = "2026-02-05T22:59:59Z";
	harness.userId = subjectUserId;
	expect(
		(
			await checks.getDrivingLicenceEmployeeRecordAction({
				employeeId: fixture.employeeId,
			})
		).success,
	).toBe(true);
	harness.now = "2026-02-05T23:00:00Z"; // First expired instant in Berlin.
	const beforeJob = await checks.getDrivingLicenceEmployeeRecordAction({
		employeeId: fixture.employeeId,
	});
	expect(beforeJob.success && beforeJob.data.authorizedClasses).toEqual(["B"]);
	harness.mail.mockRejectedValue(new Error("mail unavailable"));
	await runDrivingLicenceRemindersJob();
	expect(
		(await inbox()).filter((n) => n.type === "driving_authorization_suspended"),
	).toHaveLength(1);
	const afterJob = await checks.getDrivingLicenceEmployeeRecordAction({
		employeeId: fixture.employeeId,
	});
	expect(afterJob.success && afterJob.data.authorizedClasses).toEqual(["B"]);
	await runDrivingLicenceRemindersJob();
	expect(
		(await inbox()).filter((n) => n.type === "driving_authorization_suspended"),
	).toHaveLength(1);
});

it("excludes foreign, expired, out-of-scope, inactive and kiosk recipients and never forwards personal details to ordinary admins", async () => {
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(true);
	const other = await fixture.seedEmployee();
	const expired = await fixture.seedEmployee();
	const inactive = await fixture.seedEmployee();
	const revoked = await fixture.seedEmployee();
	harness.userId = fixture.ownerUserId;
	for (const [recipient, scope, employeeIds, expiresAt] of [
		[other, "specific", [fixture.ownerEmployeeId], null],
		[expired, "all", [], "2026-02-01T00:00:00Z"],
		[inactive, "all", [], null],
		[revoked, "all", [], null],
	] as const) {
		expect(
			(
				await grants.saveDrivingLicenceVerifierGrantAction({
					verifierEmployeeId: recipient.employeeId,
					scope,
					employeeIds: [...employeeIds],
					teamIds: [],
					expiresAt,
				})
			).success,
		).toBe(true);
	}
	await fixture.pool.query("update employee set is_active=false where id=$1", [
		inactive.employeeId,
	]);
	const revokedGrant = (
		await fixture.pool.query(
			"select id from driving_licence_verifier_grant where verifier_employee_id=$1",
			[revoked.employeeId],
		)
	).rows[0].id;
	expect(
		(
			await grants.revokeDrivingLicenceVerifierGrantAction({
				grantId: revokedGrant,
			})
		).success,
	).toBe(true);
	const foreignOrganizationId = await fixture.createOrganization();
	const foreign = await fixture.seedEmployee({
		organizationId: foreignOrganizationId,
		role: "owner",
	});
	harness.organizationId = foreignOrganizationId;
	harness.userId = foreign.userId;
	expect(
		(
			await grants.saveDrivingLicenceVerifierGrantAction({
				verifierEmployeeId: foreign.employeeId,
				scope: "all",
				employeeIds: [],
				teamIds: [],
			})
		).success,
	).toBe(true);
	harness.organizationId = fixture.organizationId;
	harness.now = "2026-02-21T10:00:00Z";
	await fixture.pool.query('update "user" set email=$2 where id=$1', [
		subjectUserId,
		`terminal-${subjectUserId}@kiosk.invalid`,
	]);
	await runDrivingLicenceRemindersJob();
	expect(await inbox()).toHaveLength(0);
	expect(await inbox(verifier.userId)).toHaveLength(1);
	for (const userId of [
		fixture.ownerUserId,
		other.userId,
		expired.userId,
		inactive.userId,
		revoked.userId,
		foreign.userId,
	])
		expect(await inbox(userId)).toHaveLength(0);
	expect(harness.mail.mock.calls.map((args) => args[0].to)).toEqual([
		`${verifier.userId}@lifecycle.test`,
	]);
});

it("serializes concurrent workers and drops a failed email after its check was renewed or verifier responsibility revoked", async () => {
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(true);
	harness.now = "2026-02-21T10:00:00Z";
	harness.mail.mockRejectedValue(new Error("provider offline"));
	await Promise.all([
		runDrivingLicenceRemindersJob(),
		runDrivingLicenceRemindersJob(),
	]);
	expect(await inbox()).toHaveLength(1);
	expect(await inbox(verifier.userId)).toHaveLength(1);
	harness.mail.mockClear();
	harness.mail.mockResolvedValue({ success: true });
	// Renewal moves the earliest deadline outside every configured lead threshold.
	harness.userId = fixture.ownerUserId;
	await changeInterval(6);
	harness.userId = verifier.userId;
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(true);
	harness.userId = fixture.ownerUserId;
	const id = (
		await fixture.pool.query(
			"select id from driving_licence_verifier_grant where verifier_employee_id=$1 and revoked_at is null",
			[verifier.employeeId],
		)
	).rows[0].id;
	expect(
		(await grants.revokeDrivingLicenceVerifierGrantAction({ grantId: id }))
			.success,
	).toBe(true);
	harness.now = "2026-02-22T10:00:00Z";
	await runDrivingLicenceRemindersJob();
	expect(harness.mail).not.toHaveBeenCalled();
	expect(await inbox()).toHaveLength(1);
});

it("runs the registered cron processor without duplicate inbox or email delivery under concurrent retries", async () => {
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(true);
	harness.now = "2026-02-21T10:00:00Z";
	const { CRON_JOBS } = await import("@/lib/cron/registry");
	await Promise.all([
		CRON_JOBS["cron:driving-licence-reminders"].processor(),
		runDrivingLicenceRemindersJob(),
	]);
	expect(await inbox()).toHaveLength(1);
	expect(await inbox(verifier.userId)).toHaveLength(1);
	expect(harness.mail).toHaveBeenCalledTimes(2);
});

it("discards old-employment retries without suspending or sending stale reminders about the employee's fresh check", async () => {
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(true);
	harness.now = "2026-02-21T10:00:00Z";
	harness.mail.mockRejectedValue(new Error("provider offline"));
	await runDrivingLicenceRemindersJob();
	harness.mail.mockClear().mockResolvedValue({ success: true });
	await fixture.pool.query(
		`update employee_employment_period set status='closed',ended_at='2026-02-21T12:00:00Z' where id=$1`,
		[fixture.employmentPeriodId],
	);
	await fixture.pool.query(
		`insert into employee_employment_period (organization_id,employee_id,status,started_at,start_provenance) values ($1,$2,'open','2026-02-22T00:00:00Z','recorded')`,
		[fixture.organizationId, fixture.employeeId],
	);
	harness.now = "2026-02-22T10:00:00Z";
	harness.userId = fixture.ownerUserId;
	await changeInterval(6);
	harness.userId = verifier.userId;
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(true);
	await runDrivingLicenceRemindersJob();
	expect(harness.mail).not.toHaveBeenCalled();
	const current = await checks.getDrivingLicenceEmployeeRecordAction({
		employeeId: fixture.employeeId,
	});
	expect(current.success && current.data.authorizedClasses).toEqual(["B"]);
	expect(await inbox()).toHaveLength(1);
});

it("rechecks the live clock before each email so a slow send cannot deliver a stale pre-expiry reminder", async () => {
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(true);
	harness.now = "2026-02-28T22:59:59Z";
	harness.mail.mockImplementationOnce(async () => {
		harness.now = "2026-02-28T23:00:00Z";
		return { success: true };
	});
	const result = await runDrivingLicenceRemindersJob();
	expect(result.emailSent).toBe(1);
	harness.userId = subjectUserId;
	const state = await checks.getDrivingLicenceEmployeeRecordAction({
		employeeId: fixture.employeeId,
	});
	expect(state.success && state.data.authorizedClasses).toEqual([]);
	await runDrivingLicenceRemindersJob();
	expect(
		(await inbox()).filter((n) => n.type === "driving_authorization_suspended"),
	).toHaveLength(1);
});

it("honors the configured 30- and 7-day routine thresholds exactly in the saved deadline zone", async () => {
	harness.userId = fixture.ownerUserId;
	await changeInterval(6);
	harness.userId = verifier.userId;
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(true);
	harness.now = "2026-06-30T21:59:59Z";
	await runDrivingLicenceRemindersJob();
	expect(await inbox()).toHaveLength(0);
	harness.now = "2026-06-30T22:00:00Z";
	await runDrivingLicenceRemindersJob();
	expect(await inbox()).toHaveLength(1);
	harness.now = "2026-07-23T22:00:00Z";
	await runDrivingLicenceRemindersJob();
	expect(await inbox()).toHaveLength(2);
	expect(harness.mail).toHaveBeenCalledTimes(4);
});

it("does not resend provider-accepted email when recording its success rolls back", async () => {
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(true);
	harness.now = "2026-02-21T10:00:00Z";
	const functionName = `driving_email_commit_loss_${crypto.randomUUID().replaceAll("-", "")}`;
	const triggerName = `${functionName}_trigger`;
	await fixture.pool.query(
		`create function ${functionName}() returns trigger language plpgsql as $$ begin if NEW.organization_id='${fixture.organizationId}' and NEW.email_state='sent' then raise exception 'simulated result commit failure'; end if; return NEW; end $$`,
	);
	await fixture.pool.query(
		`create constraint trigger ${triggerName} after update on driving_licence_reminder_delivery deferrable initially deferred for each row execute function ${functionName}()`,
	);
	const { CRON_JOBS } = await import("@/lib/cron/registry");
	try {
		await expect(
			CRON_JOBS["cron:driving-licence-reminders"].processor(),
		).rejects.toThrow();
		expect(harness.mail).toHaveBeenCalledTimes(1);
	} finally {
		await fixture.pool.query(
			`drop trigger ${triggerName} on driving_licence_reminder_delivery`,
		);
		await fixture.pool.query(`drop function ${functionName}()`);
	}
	await CRON_JOBS["cron:driving-licence-reminders"].processor();
	expect(harness.mail).toHaveBeenCalledTimes(2); // Only the other recipient's previously unattempted message.
	expect(await inbox()).toMatchObject([{ isRead: false, readAt: null }]);
	expect(await inbox(verifier.userId)).toMatchObject([
		{ isRead: false, readAt: null },
	]);
	await CRON_JOBS["cron:driving-licence-reminders"].processor();
	expect(harness.mail).toHaveBeenCalledTimes(2);
});

it("distinguishes an unavailable transport from recorded success and an uncertain thrown outcome", async () => {
	expect(
		(await checks.completeDrivingLicenceCheckAction(original())).success,
	).toBe(true);
	harness.now = "2026-02-21T10:00:00Z";
	harness.mail.mockImplementationOnce(async () => ({
		success: false,
		unavailable: true,
	}));
	const first = await runDrivingLicenceRemindersJob();
	expect(first).toMatchObject({ emailSent: 1, emailFailed: 0 });
	harness.userId = harness.mail.mock.calls[0][0].to.replace(
		"@lifecycle.test",
		"",
	);
	expect(
		await checks.getDrivingLicenceEmployeeRecordAction({
			employeeId: fixture.employeeId,
		}),
	).toMatchObject({ success: true, data: { uncertainEmailCount: 0 } });
	await runDrivingLicenceRemindersJob();
	expect(harness.mail).toHaveBeenCalledTimes(2);
	expect(await inbox()).toMatchObject([{ isRead: false, readAt: null }]);
});
