/**
 * The personal details module on PostgreSQL (#2069, #2071, spec #2068): who
 * reads what (org admins and covering payroll access holders decide), the
 * date-effective bank account history, direct changes and ends, the mandatory
 * "personal details changed" notice and its value-free audit.
 *
 * Local contract: pnpm --filter webapp test:integration src/lib/organization/personal-details
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { sendEmail } from "@/lib/email/email-service";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import {
	changePersonalDetails,
	endPersonalDetails,
	readPersonalDetails,
	retryPersonalDetailsChangedEmails,
} from "./personal-details";

const ERIKA = { accountHolder: "Erika Mustermann", iban: "DE89370400440532013000", bic: null };
const MAX = { accountHolder: "Max Mustermann", iban: "AT611904300234573201", bic: "BKAUATWW" };

vi.mock("@/lib/email/email-service", async (importOriginal) =>
	(await import("@/test/integration-harness")).emailService(importOriginal),
);

const IBAN = ERIKA.iban;

describe("personal details", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	let organizationId: string;
	let admin: SeededEmployee;
	let worker: SeededEmployee;
	const clock = { nowInstant: () => parseInstant("2026-11-28T10:00:00Z") };

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});
	afterAll(async () => {
		await fixture.close();
	});
	beforeEach(async () => {
		vi.mocked(sendEmail).mockClear();
		organizationId = await fixture.createOrganization();
		await fixture.pool.query("update organization set timezone = 'Europe/Berlin' where id = $1", [
			organizationId,
		]);
		admin = await fixture.seedEmployee({ organizationId, role: "admin" });
		worker = await fixture.seedEmployee({ organizationId });
	});

	function change(
		actor: SeededEmployee,
		target: SeededEmployee,
		validFrom: string,
		value: { accountHolder: string; iban: string; bic?: string | null },
	) {
		return changePersonalDetails(
			{
				organizationId,
				actorUserId: actor.userId,
				employeeId: target.employeeId,
				part: "bank_account",
				validFrom,
				value,
			},
			{ clock },
		);
	}

	function read(actor: SeededEmployee, target: SeededEmployee, options: { reveal?: boolean } = {}) {
		return readPersonalDetails(
			{
				organizationId,
				actorUserId: actor.userId,
				employeeId: target.employeeId,
				...options,
			},
			{ clock },
		);
	}

	it("lets an org admin record an employee's bank account, read back in force today", async () => {
		await change(admin, worker, "2026-11-01", {
			accountHolder: " Erika Mustermann ",
			iban: "de89 3704 0044 0532 0130 00",
			bic: "cobadeff",
		});

		const details = await read(admin, worker, { reveal: true });
		expect(details?.bankAccount.current).toEqual({
			validFrom: "2026-11-01",
			value: {
				accountHolder: "Erika Mustermann",
				iban: IBAN,
				ibanLastFour: "3000",
				bic: "COBADEFF",
			},
		});
	});

	it("replaces the entry of the same valid-from and adds a later one to the history", async () => {
		await change(admin, worker, "2026-01-01", ERIKA);
		await expect(change(admin, worker, "2026-01-01", MAX)).resolves.toEqual({ replaced: true });
		await expect(change(admin, worker, "2026-06-01", ERIKA)).resolves.toEqual({ replaced: false });

		const details = await read(admin, worker, { reveal: true });
		expect(
			details?.bankAccount.history.map((entry) => [entry.validFrom, entry.value?.iban]),
		).toEqual([
			["2026-06-01", ERIKA.iban],
			["2026-01-01", MAX.iban],
		]);
	});

	it("reads back the value in force on any day, a past one included", async () => {
		await change(admin, worker, "2026-06-01", ERIKA);
		await change(admin, worker, "2025-01-01", MAX);
		const on = (day: string) =>
			readPersonalDetails(
				{ organizationId, actorUserId: admin.userId, employeeId: worker.employeeId, on: day },
				{ clock },
			).then((details) => details?.bankAccount.current?.value?.ibanLastFour ?? null);

		expect(await on("2024-12-31")).toBeNull();
		expect(await on("2025-01-01")).toBe("3201");
		expect(await on("2026-05-31")).toBe("3201");
		expect(await on("2026-06-01")).toBe("3000");
	});

	it("keeps a future-dated bank account in the history but not in force today", async () => {
		await change(admin, worker, "2026-11-01", ERIKA);
		await change(admin, worker, "2026-12-01", MAX);

		const details = await read(admin, worker);
		expect(details?.on).toBe("2026-11-28");
		expect(details?.bankAccount.current?.validFrom).toBe("2026-11-01");
		expect(details?.bankAccount.history.map((entry) => entry.validFrom)).toEqual([
			"2026-12-01",
			"2026-11-01",
		]);
	});

	it("takes today in the organization's timezone", async () => {
		const lateEvening = { nowInstant: () => parseInstant("2026-11-30T23:30:00Z") };
		await change(admin, worker, "2026-12-01", ERIKA);
		const details = await readPersonalDetails(
			{ organizationId, actorUserId: admin.userId, employeeId: worker.employeeId },
			{ clock: lateEvening },
		);
		// 00:30 on 1 December in Berlin.
		expect(details?.on).toBe("2026-12-01");
		expect(details?.bankAccount.current?.validFrom).toBe("2026-12-01");
	});

	it("shows an org admin only the IBAN's last four characters until revealed", async () => {
		await change(admin, worker, "2026-11-01", ERIKA);

		const masked = await read(admin, worker);
		expect(masked?.viewer).toEqual({ own: false, mayChange: true, revealed: false });
		expect(masked?.bankAccount.current?.value).toEqual({
			accountHolder: "Erika Mustermann",
			iban: null,
			ibanLastFour: "3000",
			bic: null,
		});
		expect(masked?.bankAccount.history[0]?.value?.iban).toBeNull();
		expect((await read(admin, worker, { reveal: true }))?.bankAccount.current?.value?.iban).toBe(
			ERIKA.iban,
		);
	});

	it("shows the employee their own bank account in full, without the right to change it", async () => {
		await change(admin, worker, "2026-11-01", ERIKA);

		const own = await read(worker, worker);
		expect(own?.viewer).toEqual({ own: true, mayChange: false, revealed: true });
		expect(own?.bankAccount.current?.value?.iban).toBe(ERIKA.iban);
		await expect(change(worker, worker, "2026-12-01", MAX)).rejects.toMatchObject({
			code: "own_details",
		});
	});

	it("refuses an org admin's direct change of their own personal details", async () => {
		await expect(change(admin, admin, "2026-12-01", MAX)).rejects.toMatchObject({
			code: "own_details",
		});
		const own = await read(admin, admin);
		expect(own?.viewer).toEqual({ own: true, mayChange: false, revealed: true });
		expect(own?.bankAccount.history).toEqual([]);
	});

	it("lets an owner change an employee's bank account", async () => {
		const owner = await fixture.seedEmployee({ organizationId, role: "owner" });
		await change(owner, worker, "2026-11-01", ERIKA);
		expect((await read(owner, worker))?.bankAccount.current?.value?.ibanLastFour).toBe("3000");
	});

	function end(actor: SeededEmployee, target: SeededEmployee, validFrom: string) {
		return endPersonalDetails(
			{
				organizationId,
				actorUserId: actor.userId,
				employeeId: target.employeeId,
				part: "bank_account",
				validFrom,
			},
			{ clock },
		);
	}

	describe("ending", () => {
		const on = (day: string) =>
			readPersonalDetails(
				{ organizationId, actorUserId: admin.userId, employeeId: worker.employeeId, on: day },
				{ clock },
			).then((details) => details?.bankAccount.current?.value?.ibanLastFour ?? null);

		it("leaves no bank account in force from the end day and keeps the earlier history", async () => {
			await change(admin, worker, "2026-01-01", MAX);
			await change(admin, worker, "2026-06-01", ERIKA);

			await expect(end(admin, worker, "2026-11-15")).resolves.toEqual({ replaced: false });

			expect(await on("2026-11-14")).toBe("3000");
			expect(await on("2026-11-15")).toBeNull();
			expect(await on("2027-06-01")).toBeNull();
			const details = await read(admin, worker);
			expect(details?.bankAccount.current).toBeNull();
			expect(
				details?.bankAccount.history.map((entry) => [
					entry.validFrom,
					entry.value?.ibanLastFour ?? null,
				]),
			).toEqual([
				["2026-11-15", null],
				["2026-06-01", "3000"],
				["2026-01-01", "3201"],
			]);
		});

		it("drops entries later than the end day, so none comes into force after it", async () => {
			await change(admin, worker, "2026-11-01", ERIKA);
			await change(admin, worker, "2027-01-01", MAX);

			await end(admin, worker, "2026-12-01");

			expect(await on("2027-02-01")).toBeNull();
			expect(
				(await read(admin, worker))?.bankAccount.history.map((entry) => [
					entry.validFrom,
					entry.value?.ibanLastFour ?? null,
				]),
			).toEqual([
				["2026-12-01", null],
				["2026-11-01", "3000"],
			]);
		});

		it("replaces the entry of the same day with the end, as for a bank account entered on the wrong employee", async () => {
			await change(admin, worker, "2026-12-01", ERIKA);

			await expect(end(admin, worker, "2026-12-01")).resolves.toEqual({ replaced: true });

			expect((await read(admin, worker))?.bankAccount.history).toEqual([
				{ validFrom: "2026-12-01", value: null },
			]);
		});

		it.each([
			["no bank account was ever recorded", async () => {}],
			[
				"the bank account already ended before that day",
				async () => {
					await change(admin, worker, "2026-01-01", ERIKA);
					await end(admin, worker, "2026-06-01");
				},
			],
		])("refuses an end when %s, and tells nobody", async (_when, seed) => {
			await seed();
			const before = (await read(admin, worker))?.bankAccount.history;
			vi.mocked(sendEmail).mockClear();

			await expect(end(admin, worker, "2026-11-01")).rejects.toMatchObject({
				code: "nothing_to_end",
			});
			expect((await read(admin, worker))?.bankAccount.history).toEqual(before);
			expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
		});

		it("refuses an end by those who may not change, and of one's own details", async () => {
			await change(admin, worker, "2026-01-01", ERIKA);
			const colleague = await fixture.seedEmployee({ organizationId });
			const owner = await fixture.seedEmployee({ organizationId, role: "owner" });
			await change(owner, admin, "2026-01-01", MAX);

			await expect(end(colleague, worker, "2026-11-01")).rejects.toMatchObject({
				code: "not_found",
			});
			await expect(end(worker, worker, "2026-11-01")).rejects.toMatchObject({
				code: "own_details",
			});
			await expect(end(admin, admin, "2026-11-01")).rejects.toMatchObject({
				code: "own_details",
			});
			expect(await on("2026-12-01")).toBe("3000");
		});

		it("refuses an invalid end day", async () => {
			await change(admin, worker, "2026-01-01", ERIKA);
			await expect(end(admin, worker, "2026-02-30")).rejects.toMatchObject({
				code: "invalid_input",
				details: { fields: { validFrom: "valid_from_invalid" } },
			});
		});
	});

	describe("payroll access holders", () => {
		/** A member holding an active payroll access grant: everyone, or the named employees and teams. */
		async function payrollHolder(
			coverage: "all" | { employees?: SeededEmployee[]; teams?: string[] },
		) {
			const holder = await fixture.seedEmployee({ organizationId });
			const grantId = randomUUID();
			await fixture.pool.query(
				`insert into payroll_access_grant (id, organization_id, payroll_employee_id, scope, created_by, updated_at)
				 values ($1, $2, $3, $4, $5, now())`,
				[
					grantId,
					organizationId,
					holder.employeeId,
					coverage === "all" ? "all" : "specific",
					admin.userId,
				],
			);
			if (coverage !== "all") {
				for (const employee of coverage.employees ?? []) {
					await fixture.pool.query(
						"insert into payroll_access_employee (organization_id, grant_id, employee_id, created_by) values ($1, $2, $3, $4)",
						[organizationId, grantId, employee.employeeId, admin.userId],
					);
				}
				for (const teamId of coverage.teams ?? []) {
					await fixture.pool.query(
						"insert into payroll_access_team (organization_id, grant_id, team_id, created_by) values ($1, $2, $3, $4)",
						[organizationId, grantId, teamId, admin.userId],
					);
				}
			}
			return Object.assign(holder, { grantId });
		}

		it("a holder covering everyone sees masked, reveals and changes like an org admin", async () => {
			await change(admin, worker, "2026-11-01", ERIKA);
			const holder = await payrollHolder("all");

			const masked = await read(holder, worker);
			expect(masked?.viewer).toEqual({ own: false, mayChange: true, revealed: false });
			expect(masked?.bankAccount.current?.value).toMatchObject({
				iban: null,
				ibanLastFour: "3000",
			});
			expect((await read(holder, worker, { reveal: true }))?.bankAccount.current?.value?.iban).toBe(
				ERIKA.iban,
			);
			await change(holder, worker, "2026-12-01", MAX);
			await end(holder, worker, "2027-01-01");
			expect(
				(await read(admin, worker))?.bankAccount.history.map((entry) => [
					entry.validFrom,
					entry.value?.ibanLastFour ?? null,
				]),
			).toEqual([
				["2027-01-01", null],
				["2026-12-01", "3201"],
				["2026-11-01", "3000"],
			]);
		});

		async function teamOf(...members: SeededEmployee[]) {
			const teamId = randomUUID();
			await fixture.pool.query(
				"insert into team (id, organization_id, name, updated_at) values ($1, $2, 'Payroll covered', now())",
				[teamId, organizationId],
			);
			for (const member of members) await fixture.placeInTeam(member.employeeId, teamId);
			return teamId;
		}

		it.each([
			["names the employee", async () => payrollHolder({ employees: [worker] })],
			["names the employee's team", async () => payrollHolder({ teams: [await teamOf(worker)] })],
			[
				"names a team the employee is a member of",
				async () => {
					const teamId = await teamOf();
					await fixture.pool.query(
						"insert into team_membership (organization_id, team_id, employee_id) values ($1, $2, $3)",
						[organizationId, teamId, worker.employeeId],
					);
					return payrollHolder({ teams: [teamId] });
				},
			],
		])("a holder whose grant %s sees and changes them", async (_how, seed) => {
			await change(admin, worker, "2026-11-01", ERIKA);
			const holder = await seed();

			expect((await read(holder, worker))?.viewer.mayChange).toBe(true);
			await expect(change(holder, worker, "2026-12-01", MAX)).resolves.toEqual({
				replaced: false,
			});
			await expect(end(holder, worker, "2027-01-01")).resolves.toEqual({ replaced: false });
		});

		it.each([
			["names someone else", async () => payrollHolder({ employees: [admin] })],
			["names another team", async () => payrollHolder({ teams: [await teamOf(admin)] })],
			[
				"was revoked",
				async () => {
					const holder = await payrollHolder("all");
					await fixture.pool.query(
						"update payroll_access_grant set is_active = false where id = $1",
						[holder.grantId],
					);
					return holder;
				},
			],
		])("a holder whose grant %s sees nothing and changes nothing", async (_how, seed) => {
			await change(admin, worker, "2026-11-01", ERIKA);
			const holder = await seed();

			expect(await read(holder, worker, { reveal: true })).toBeNull();
			await expect(change(holder, worker, "2026-12-01", MAX)).rejects.toMatchObject({
				code: "not_found",
			});
			await expect(end(holder, worker, "2026-12-01")).rejects.toMatchObject({
				code: "not_found",
			});
			expect((await read(admin, worker))?.bankAccount.history).toHaveLength(1);
		});

		it("a holder covering everyone sees their own only as the employee and changes it only by request", async () => {
			const holder = await payrollHolder("all");
			await change(admin, holder, "2026-11-01", ERIKA);

			expect((await read(holder, holder))?.viewer).toEqual({
				own: true,
				mayChange: false,
				revealed: true,
			});
			await expect(change(holder, holder, "2026-12-01", MAX)).rejects.toMatchObject({
				code: "own_details",
			});
			await expect(end(holder, holder, "2026-12-01")).rejects.toMatchObject({
				code: "own_details",
			});
		});

		it("a holder still covers an employee who has left", async () => {
			const holder = await payrollHolder({ employees: [worker] });
			await change(admin, worker, "2026-11-01", ERIKA);
			await fixture.pool.query(
				"update employee set is_active = false, end_date = '2026-02-15' where id = $1",
				[worker.employeeId],
			);

			expect((await read(holder, worker))?.bankAccount.current?.value?.ibanLastFour).toBe("3000");
		});
	});

	describe("who has no right", () => {
		async function scopedManagerOf(target: SeededEmployee) {
			const manager = await fixture.seedEmployee({ organizationId });
			await fixture.pool.query("update employee set role = 'manager' where id = $1", [
				manager.employeeId,
			]);
			await fixture.pool.query(
				"insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by) values ($1, $2, $3, true, $4)",
				[randomUUID(), target.employeeId, manager.employeeId, admin.userId],
			);
			return manager;
		}
		async function workforceAdmin() {
			const workforce = await fixture.seedEmployee({ organizationId });
			await fixture.pool.query("update employee set role = 'admin' where id = $1", [
				workforce.employeeId,
			]);
			return workforce;
		}
		async function personnelFileOfficer() {
			const officer = await fixture.seedEmployee({ organizationId });
			await fixture.pool.query(
				`insert into personnel_file_officer_grant (organization_id, officer_employee_id, scope, categories, created_by)
				 values ($1, $2, 'all', array['contract','payslip','certificate','sick_note','other'], $3)`,
				[organizationId, officer.employeeId, admin.userId],
			);
			return officer;
		}

		it.each([
			["a scoped manager of the employee", () => scopedManagerOf(worker)],
			["a workforce admin", workforceAdmin],
			["a personnel file officer for everyone", personnelFileOfficer],
			["a colleague", () => fixture.seedEmployee({ organizationId })],
		])("%s sees nothing and changes nothing", async (_who, seed) => {
			await change(admin, worker, "2026-11-01", ERIKA);
			const viewer = await seed();

			expect(await read(viewer, worker, { reveal: true })).toBeNull();
			await expect(change(viewer, worker, "2026-12-01", MAX)).rejects.toMatchObject({
				code: "not_found",
			});
			await expect(end(viewer, worker, "2026-12-01")).rejects.toMatchObject({
				code: "not_found",
			});
			expect((await read(admin, worker))?.bankAccount.history).toHaveLength(1);
		});

		it("a former employee no longer sees their own", async () => {
			await change(admin, worker, "2026-11-01", ERIKA);
			await fixture.pool.query(
				"update employee set is_active = false, end_date = '2026-02-15' where id = $1",
				[worker.employeeId],
			);
			expect(await read(worker, worker)).toBeNull();
			expect((await read(admin, worker))?.bankAccount.current).not.toBeNull();
		});

		it("another organization's admin sees and changes nothing", async () => {
			await change(admin, worker, "2026-11-01", ERIKA);
			const otherOrganizationId = await fixture.createOrganization();
			const otherAdmin = await fixture.seedEmployee({
				organizationId: otherOrganizationId,
				role: "admin",
			});

			for (const scope of [organizationId, otherOrganizationId]) {
				expect(
					await readPersonalDetails(
						{
							organizationId: scope,
							actorUserId: otherAdmin.userId,
							employeeId: worker.employeeId,
						},
						{ clock },
					),
				).toBeNull();
				await expect(
					changePersonalDetails(
						{
							organizationId: scope,
							actorUserId: otherAdmin.userId,
							employeeId: worker.employeeId,
							part: "bank_account",
							validFrom: "2026-12-01",
							value: MAX,
						},
						{ clock },
					),
				).rejects.toMatchObject({ code: "not_found" });
			}
			expect((await read(admin, worker))?.bankAccount.history).toHaveLength(1);
		});
	});

	it("refuses an invalid bank account or valid-from, naming each field, and stores nothing", async () => {
		await expect(
			change(admin, worker, "2026-02-30", {
				accountHolder: " ",
				iban: "US64SVBKUS6S3300958879",
				bic: "X",
			}),
		).rejects.toMatchObject({
			code: "invalid_input",
			details: {
				fields: {
					validFrom: "valid_from_invalid",
					accountHolder: "account_holder_required",
					iban: "iban_not_sepa",
					bic: "bic_format",
				},
			},
		});
		expect((await read(admin, worker))?.bankAccount.history).toEqual([]);
	});

	describe("the personal details changed notice", () => {
		async function noticesOf(employee: SeededEmployee) {
			const { rows } = await fixture.pool.query<{
				type: string;
				title: string;
				message: string;
				metadata: string;
				action_url: string;
			}>(
				"select type, title, message, metadata, action_url from notification where user_id = $1 and organization_id = $2",
				[employee.userId, organizationId],
			);
			return rows;
		}
		function emailsTo(employee: SeededEmployee) {
			return vi
				.mocked(sendEmail)
				.mock.calls.map(([message]) => message)
				.filter((message) => message.to === `${employee.userId}@lifecycle.test`);
		}

		it("tells the employee in-app and by email even with both switched off, showing only the IBAN's last four", async () => {
			for (const channel of ["in_app", "email"]) {
				await fixture.pool.query(
					`insert into notification_preference (user_id, notification_type, channel, enabled, updated_at)
					 values ($1, 'personal_details_changed', $2, false, now())`,
					[worker.userId, channel],
				);
			}

			await change(admin, worker, "2026-12-01", ERIKA);

			const notices = await noticesOf(worker);
			expect(notices).toHaveLength(1);
			expect(notices[0]).toMatchObject({
				type: "personal_details_changed",
				action_url: "/settings/profile",
			});
			expect(notices[0]?.message).toContain("3000");
			expect(JSON.parse(notices[0]?.metadata ?? "{}")).toMatchObject({
				part: "bank_account",
				i18n: { params: { lastFour: "3000" } },
			});
			const emails = emailsTo(worker);
			expect(emails).toHaveLength(1);
			expect(emails[0]?.html).toContain("3000");
			for (const text of [JSON.stringify(notices), JSON.stringify(emails)]) {
				expect(text).not.toContain(ERIKA.iban);
				expect(text).not.toContain("0532013000");
			}
		});

		it("tells the employee about every applied change, a correction included, and no one else", async () => {
			const owner = await fixture.seedEmployee({ organizationId, role: "owner" });
			await change(admin, worker, "2026-01-01", ERIKA);
			await change(owner, worker, "2026-01-01", MAX);

			expect((await noticesOf(worker)).map((notice) => notice.message)).toEqual(
				expect.arrayContaining([expect.stringContaining("3000"), expect.stringContaining("3201")]),
			);
			expect(await noticesOf(worker)).toHaveLength(2);
			expect(emailsTo(worker)).toHaveLength(2);
			expect(await noticesOf(admin)).toEqual([]);
			expect(await noticesOf(owner)).toEqual([]);
		});

		it("emails the notice again after a failed delivery, so it is never lost and never sent twice", async () => {
			vi.mocked(sendEmail).mockResolvedValueOnce({ success: false, error: "smtp_unreachable" });

			await expect(change(admin, worker, "2026-12-01", ERIKA)).resolves.toEqual({
				replaced: false,
			});
			expect(emailsTo(worker)).toHaveLength(1);

			// A failed delivery waits before it is tried again.
			await retryPersonalDetailsChangedEmails({ clock });
			expect(emailsTo(worker)).toHaveLength(1);

			const later = { nowInstant: () => parseInstant("2026-11-28T11:00:00Z") };
			await retryPersonalDetailsChangedEmails({ clock: later });
			await retryPersonalDetailsChangedEmails({ clock: later });

			const emails = emailsTo(worker);
			expect(emails).toHaveLength(2);
			expect(emails[1]?.html).toContain("3000");
			expect(await noticesOf(worker)).toHaveLength(1);
			expect((await read(admin, worker))?.bankAccount.history).toHaveLength(1);
		});

		it("stops trying an employee no email can reach", async () => {
			vi.mocked(sendEmail).mockResolvedValueOnce({ success: false, unavailable: true });

			await change(admin, worker, "2026-12-01", ERIKA);
			await retryPersonalDetailsChangedEmails({
				clock: { nowInstant: () => parseInstant("2026-11-29T10:00:00Z") },
			});

			expect(emailsTo(worker)).toHaveLength(1);
			expect(await noticesOf(worker)).toHaveLength(1);
		});

		it("tells the employee about an end in-app and by email, in its own words and with no value", async () => {
			await fixture.pool.query(
				`insert into notification_preference (user_id, notification_type, channel, enabled, updated_at)
				 values ($1, 'personal_details_changed', 'email', false, now())`,
				[worker.userId],
			);
			await change(admin, worker, "2026-01-01", ERIKA);

			await end(admin, worker, "2026-12-01");

			const notices = await noticesOf(worker);
			expect(notices).toHaveLength(2);
			const ended = notices.find((notice) => notice.message.includes("ended"));
			expect(ended).toMatchObject({
				type: "personal_details_changed",
				action_url: "/settings/profile",
			});
			expect(JSON.parse(ended?.metadata ?? "{}")).toMatchObject({
				part: "bank_account",
				outcome: "ended",
				i18n: {
					messageKey: "common:notifications.content.personalDetailsChanged.bankAccountEnded",
					params: { validFrom: { kind: "plainDate", date: "2026-12-01" } },
				},
			});
			expect(ended?.message).not.toContain("3000");
			const emails = emailsTo(worker);
			expect(emails).toHaveLength(2);
			expect(emails.some((email) => email.html.includes("ended"))).toBe(true);
		});

		it("tells nobody about a refused change", async () => {
			const colleague = await fixture.seedEmployee({ organizationId });
			await expect(change(colleague, worker, "2026-12-01", ERIKA)).rejects.toThrow();
			await expect(
				change(admin, worker, "2026-12-01", { ...ERIKA, iban: "DE00" }),
			).rejects.toThrow();
			expect(await noticesOf(worker)).toEqual([]);
			expect(emailsTo(worker)).toEqual([]);
		});
	});

	describe("the audit log", () => {
		async function auditOf(employee: SeededEmployee) {
			const { rows } = await fixture.pool.query<{
				action: string;
				performed_by: string;
				entity_type: string;
				entity_id: string;
				metadata: string | null;
				changes: string | null;
			}>(
				"select action, performed_by, entity_type, entity_id, metadata, changes from audit_log where organization_id = $1 and employee_id = $2",
				[organizationId, employee.employeeId],
			);
			return rows;
		}

		it("records actor, employee, part and valid-from of a change, never its values", async () => {
			await change(admin, worker, "2026-01-01", {
				accountHolder: "Erika Mustermann",
				iban: ERIKA.iban,
				bic: "COBADEFF",
			});
			await change(admin, worker, "2026-01-01", MAX);

			const entries = await auditOf(worker);
			expect(entries).toHaveLength(2);
			expect(
				entries.map((entry) => ({ ...entry, metadata: JSON.parse(entry.metadata ?? "{}") })),
			).toEqual(
				expect.arrayContaining([
					{
						action: "personal_details.changed",
						performed_by: admin.userId,
						entity_type: "employee",
						entity_id: worker.employeeId,
						metadata: { part: "bank_account", validFrom: "2026-01-01", correction: false },
						changes: null,
					},
					expect.objectContaining({
						metadata: { part: "bank_account", validFrom: "2026-01-01", correction: true },
					}),
				]),
			);
			const text = JSON.stringify(entries);
			for (const value of [
				ERIKA.iban,
				MAX.iban,
				"COBADEFF",
				MAX.bic,
				"Mustermann",
				"3000",
				"3201",
			]) {
				expect(text).not.toContain(value);
			}
		});

		it("records an end with actor, part and day, never the ended values", async () => {
			await change(admin, worker, "2026-01-01", ERIKA);
			await change(admin, worker, "2027-01-01", MAX);

			await end(admin, worker, "2026-12-01");

			const entries = await auditOf(worker);
			const ended = entries.filter((entry) => entry.action === "personal_details.ended");
			expect(
				ended.map((entry) => ({ ...entry, metadata: JSON.parse(entry.metadata ?? "{}") })),
			).toEqual([
				{
					action: "personal_details.ended",
					performed_by: admin.userId,
					entity_type: "employee",
					entity_id: worker.employeeId,
					metadata: {
						part: "bank_account",
						validFrom: "2026-12-01",
						correction: false,
						superseded: 1,
					},
					changes: null,
				},
			]);
			const text = JSON.stringify(ended);
			for (const value of [ERIKA.iban, MAX.iban, "Mustermann", "3000", "3201"]) {
				expect(text).not.toContain(value);
			}
		});

		it("records nothing for a refused change", async () => {
			await expect(change(worker, worker, "2026-12-01", ERIKA)).rejects.toThrow();
			expect(await auditOf(worker)).toEqual([]);
		});
	});

	describe("a failed write", () => {
		const trigger = `personal_details_forced_failure_${randomUUID().replaceAll("-", "")}`;

		/** Every string an error carries along its cause chain: what logs and spans could see. */
		function textOf(error: unknown, seen = new Set<unknown>()): string {
			if (error === null || typeof error !== "object" || seen.has(error)) return String(error);
			seen.add(error);
			return Object.getOwnPropertyNames(error)
				.map((name) => {
					const value = (error as Record<string, unknown>)[name];
					return typeof value === "object" ? textOf(value, seen) : `${name}: ${String(value)}`;
				})
				.join("\n");
		}

		afterAll(async () => {
			await fixture.pool.query(`drop function if exists ${trigger}() cascade`);
		});

		it("names none of the bank account's values in the error, whatever the database said", async () => {
			// The database echoes the row back, as a failing check constraint does.
			await fixture.pool.query(
				`create function ${trigger}() returns trigger language plpgsql as $$
				begin
					raise exception 'forced failure for %', new.iban
						using errcode = '23514', detail = format('Failing row contains (%s, %s, %s)', new.account_holder, new.iban, new.bic);
				end $$`,
			);
			await fixture.pool.query(
				`create trigger ${trigger} before insert on employee_bank_account for each row
				when (new.employee_id = '${worker.employeeId}') execute function ${trigger}()`,
			);
			const holder = "Leaky Holderperson";

			const error = await change(admin, worker, "2026-12-01", {
				...MAX,
				accountHolder: holder,
			}).then(
				() => null,
				(failure: unknown) => failure,
			);

			expect(error).toBeInstanceOf(Error);
			expect(error).toMatchObject({ code: "23514" });
			const text = textOf(error);
			for (const value of [MAX.iban, MAX.bic, holder, "Holderperson"]) {
				expect(text).not.toContain(value);
			}
			expect((await read(admin, worker))?.bankAccount.history).toEqual([]);
		});
	});
});
