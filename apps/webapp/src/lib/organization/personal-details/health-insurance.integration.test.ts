/**
 * Health insurance through the personal details module on PostgreSQL (#2070,
 * spec #2068): statutory picked or typed, private typed, each from a valid-from
 * day with history; insurers left the list stay on records and are refused for
 * new picks; hidden for External Contractors; the mandatory notice and the
 * audit never name the insurer.
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
import type { HealthInsuranceInput, StatutoryInsurerList } from "./health-insurance";
import {
	changePersonalDetails,
	endPersonalDetails,
	type PersonalDetailsDependencies,
	readPersonalDetails,
} from "./personal-details";

vi.mock("@/lib/email/email-service", async (importOriginal) =>
	(await import("@/test/integration-harness")).emailService(importOriginal),
);

/** Read off the bundled list (GKV-Spitzenverband Stammdatendatei, 2026-11-26). */
const TK = { name: "Techniker Krankenkasse", betriebsnummer: "15027365" };
const BARMER = { name: "BARMER", betriebsnummer: "42938966" };
/** Merged into SBK on 1 January 2026: off the list for new picks. */
const BKK_VORALB = "97352653";

const PICK_TK: HealthInsuranceInput = { kind: "statutory", betriebsnummer: TK.betriebsnummer };
const PICK_BARMER: HealthInsuranceInput = {
	kind: "statutory",
	betriebsnummer: BARMER.betriebsnummer,
};
const PRIVATE: HealthInsuranceInput = { kind: "private", insurerName: "Allianz Private" };

describe("health insurance", () => {
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
		value: HealthInsuranceInput,
		dependencies: PersonalDetailsDependencies = {},
	) {
		return changePersonalDetails(
			{
				organizationId,
				actorUserId: actor.userId,
				employeeId: target.employeeId,
				part: "health_insurance",
				validFrom,
				value,
			},
			{ clock, ...dependencies },
		);
	}

	function end(actor: SeededEmployee, target: SeededEmployee, validFrom: string) {
		return endPersonalDetails(
			{
				organizationId,
				actorUserId: actor.userId,
				employeeId: target.employeeId,
				part: "health_insurance",
				validFrom,
			},
			{ clock },
		);
	}

	function read(actor: SeededEmployee, target: SeededEmployee, on?: string) {
		return readPersonalDetails(
			{ organizationId, actorUserId: actor.userId, employeeId: target.employeeId, on },
			{ clock },
		);
	}

	const insurerOn = (day: string) =>
		read(admin, worker, day).then(
			(details) => details?.healthInsurance?.current?.value?.insurerName ?? null,
		);

	describe("recording", () => {
		it("copies a picked statutory insurer's name and Betriebsnummer onto the record", async () => {
			await expect(change(admin, worker, "2026-11-01", PICK_TK)).resolves.toEqual({
				replaced: false,
			});

			const details = await read(admin, worker);
			expect(details?.healthInsurance?.current).toEqual({
				validFrom: "2026-11-01",
				value: { kind: "statutory", insurerName: TK.name, betriebsnummer: TK.betriebsnummer },
			});
		});

		it("records a statutory insurer missing from the list by its typed name", async () => {
			await change(admin, worker, "2026-11-01", {
				kind: "statutory",
				insurerName: "  Neue Ersatzkasse ",
			});

			expect((await read(admin, worker))?.healthInsurance?.current?.value).toEqual({
				kind: "statutory",
				insurerName: "Neue Ersatzkasse",
				betriebsnummer: null,
			});
		});

		it("records a private insurer by its typed name", async () => {
			await change(admin, worker, "2026-11-01", PRIVATE);

			expect((await read(admin, worker))?.healthInsurance?.current?.value).toEqual({
				kind: "private",
				insurerName: "Allianz Private",
				betriebsnummer: null,
			});
		});

		it("refuses an insurer that has left the list for a new pick, and stores nothing", async () => {
			await expect(
				change(admin, worker, "2026-11-01", { kind: "statutory", betriebsnummer: BKK_VORALB }),
			).rejects.toMatchObject({
				code: "invalid_input",
				details: { fields: { betriebsnummer: "insurer_removed" } },
			});
			await expect(
				change(admin, worker, "not-a-day", { kind: "private", insurerName: " " }),
			).rejects.toMatchObject({
				code: "invalid_input",
				details: {
					fields: { insurerName: "insurer_name_required", validFrom: "valid_from_invalid" },
				},
			});
			expect((await read(admin, worker))?.healthInsurance?.history).toEqual([]);
		});

		it("keeps an insurer on the record as it was picked after it merged and left the list", async () => {
			const before: StatutoryInsurerList = {
				source: "test",
				asOf: "2025-06-01",
				insurers: [{ name: "BKK Altkasse", betriebsnummer: "11111111" }],
			};
			const after: StatutoryInsurerList = {
				source: "test",
				asOf: "2026-06-01",
				insurers: [
					{
						name: "BKK Altkasse (merged)",
						betriebsnummer: "11111111",
						removedOn: "2026-01-01",
						successor: "22222222",
					},
					{ name: "BKK Neukasse", betriebsnummer: "22222222" },
				],
			};
			const pick = { kind: "statutory", betriebsnummer: "11111111" } as const;
			await change(admin, worker, "2025-07-01", pick, { statutoryInsurers: before });

			await expect(
				change(admin, worker, "2026-12-01", pick, { statutoryInsurers: after }),
			).rejects.toMatchObject({ details: { fields: { betriebsnummer: "insurer_removed" } } });
			expect((await read(admin, worker))?.healthInsurance?.history).toEqual([
				{
					validFrom: "2025-07-01",
					value: { kind: "statutory", insurerName: "BKK Altkasse", betriebsnummer: "11111111" },
				},
			]);
		});
	});

	describe("history", () => {
		it("replaces the entry of the same valid-from and adds a later one", async () => {
			await change(admin, worker, "2026-01-01", PICK_TK);
			await expect(change(admin, worker, "2026-01-01", PICK_BARMER)).resolves.toEqual({
				replaced: true,
			});
			await expect(change(admin, worker, "2026-06-01", PRIVATE)).resolves.toEqual({
				replaced: false,
			});

			expect(
				(await read(admin, worker))?.healthInsurance?.history.map((entry) => [
					entry.validFrom,
					entry.value?.insurerName,
				]),
			).toEqual([
				["2026-06-01", "Allianz Private"],
				["2026-01-01", BARMER.name],
			]);
		});

		it("reads back the insurer in force on any day, a future-dated one kept in the history", async () => {
			await change(admin, worker, "2025-01-01", PICK_TK);
			await change(admin, worker, "2026-12-01", PICK_BARMER);

			expect(await insurerOn("2024-12-31")).toBeNull();
			expect(await insurerOn("2026-11-30")).toBe(TK.name);
			expect(await insurerOn("2026-12-01")).toBe(BARMER.name);
			expect((await read(admin, worker))?.healthInsurance?.current?.value?.insurerName).toBe(
				TK.name,
			);
		});

		it("keeps the bank account and health insurance histories apart", async () => {
			await change(admin, worker, "2026-01-01", PICK_TK);

			const details = await read(admin, worker);
			expect(details?.bankAccount.history).toEqual([]);
			expect(details?.healthInsurance?.history).toHaveLength(1);
		});
	});

	describe("who sees it", () => {
		it("shows the employee their own health insurance, without the right to change it", async () => {
			await change(admin, worker, "2026-11-01", PICK_TK);

			const own = await read(worker, worker);
			expect(own?.viewer).toMatchObject({ own: true, mayChange: false });
			expect(own?.healthInsurance?.current?.value).toEqual({
				kind: "statutory",
				insurerName: TK.name,
				betriebsnummer: TK.betriebsnummer,
			});
			await expect(change(worker, worker, "2026-12-01", PRIVATE)).rejects.toMatchObject({
				code: "own_details",
			});
			await expect(end(worker, worker, "2026-12-01")).rejects.toMatchObject({
				code: "own_details",
			});
		});

		it("shows and lets change nothing to a colleague", async () => {
			await change(admin, worker, "2026-11-01", PICK_TK);
			const colleague = await fixture.seedEmployee({ organizationId });

			expect(await read(colleague, worker)).toBeNull();
			await expect(change(colleague, worker, "2026-12-01", PRIVATE)).rejects.toMatchObject({
				code: "not_found",
			});
			await expect(end(colleague, worker, "2026-12-01")).rejects.toMatchObject({
				code: "not_found",
			});
		});
	});

	describe("ending", () => {
		it("leaves no health insurance in force from the end day and keeps the earlier history", async () => {
			await change(admin, worker, "2026-01-01", PICK_TK);
			await change(admin, worker, "2027-01-01", PICK_BARMER);

			await expect(end(admin, worker, "2026-12-01")).resolves.toEqual({ replaced: false });

			expect(await insurerOn("2026-11-30")).toBe(TK.name);
			expect(await insurerOn("2026-12-01")).toBeNull();
			expect(await insurerOn("2027-02-01")).toBeNull();
			expect(
				(await read(admin, worker))?.healthInsurance?.history.map((entry) => [
					entry.validFrom,
					entry.value?.insurerName ?? null,
				]),
			).toEqual([
				["2026-12-01", null],
				["2026-01-01", TK.name],
			]);
		});

		it("refuses an end when no health insurance is in force, and leaves the bank account alone", async () => {
			await expect(end(admin, worker, "2026-11-01")).rejects.toMatchObject({
				code: "nothing_to_end",
			});
			expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
		});
	});

	describe("External Contractors", () => {
		/** Closes the person's open stint and opens one of `kind` from `day`, as a conversion does. */
		async function convert(person: SeededEmployee, kind: "employee" | "contractor", day: string) {
			const at = `${day}T00:00:00Z`;
			await fixture.pool.query(
				`update employee_employment_period set status = 'closed', ended_at = $2
				 where employee_id = $1 and status = 'open'`,
				[person.employeeId, at],
			);
			await fixture.pool.query(
				`insert into employee_employment_period
				 (organization_id, employee_id, status, started_at, start_provenance, engagement_kind)
				 values ($1, $2, 'open', $3, 'recorded', $4)`,
				[organizationId, person.employeeId, at, kind],
			);
			await fixture.pool.query("update employee set engagement_kind = $2 where id = $1", [
				person.employeeId,
				kind,
			]);
		}

		it("neither shows nor records health insurance for an External Contractor", async () => {
			const contractor = await fixture.seedEmployee({
				organizationId,
				engagementKind: "contractor",
			});

			const details = await read(admin, contractor);
			expect(details).not.toBeNull();
			expect(details?.healthInsurance).toBeNull();
			expect((await read(contractor, contractor))?.healthInsurance).toBeNull();
			await expect(change(admin, contractor, "2026-12-01", PICK_TK)).rejects.toMatchObject({
				code: "external_contractor",
			});
			await expect(end(admin, contractor, "2026-12-01")).rejects.toMatchObject({
				code: "external_contractor",
			});
			expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
		});

		it("still records an External Contractor's bank account", async () => {
			const contractor = await fixture.seedEmployee({
				organizationId,
				engagementKind: "contractor",
			});
			await changePersonalDetails(
				{
					organizationId,
					actorUserId: admin.userId,
					employeeId: contractor.employeeId,
					part: "bank_account",
					validFrom: "2026-12-01",
					value: { accountHolder: "Kim Contractor", iban: "DE89370400440532013000" },
				},
				{ clock },
			);
			expect((await read(admin, contractor))?.bankAccount.history).toHaveLength(1);
		});

		it("hides an employee's health insurance once they become one, and shows it again when they are an employee again", async () => {
			await change(admin, worker, "2026-01-01", PICK_TK);
			await change(admin, worker, "2026-06-01", PICK_BARMER);

			await convert(worker, "contractor", "2026-07-01");
			expect((await read(admin, worker))?.healthInsurance).toBeNull();
			expect((await read(worker, worker))?.healthInsurance).toBeNull();

			await convert(worker, "employee", "2026-10-01");
			const details = await read(admin, worker);
			expect(
				details?.healthInsurance?.history.map((entry) => [
					entry.validFrom,
					entry.value?.insurerName,
				]),
			).toEqual([
				["2026-06-01", BARMER.name],
				["2026-01-01", TK.name],
			]);
		});
	});

	describe("the notice and the audit", () => {
		async function noticesOf(employee: SeededEmployee) {
			const { rows } = await fixture.pool.query<{
				type: string;
				message: string;
				metadata: string;
				action_url: string;
			}>(
				"select type, message, metadata, action_url from notification where user_id = $1 and organization_id = $2",
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
		async function auditOf(employee: SeededEmployee) {
			const { rows } = await fixture.pool.query<{
				action: string;
				performed_by: string;
				metadata: string | null;
				changes: string | null;
			}>(
				"select action, performed_by, metadata, changes from audit_log where organization_id = $1 and employee_id = $2",
				[organizationId, employee.employeeId],
			);
			return rows;
		}

		it("tells the employee in-app and by email even with both switched off, naming no insurer", async () => {
			for (const channel of ["in_app", "email"]) {
				await fixture.pool.query(
					`insert into notification_preference (user_id, notification_type, channel, enabled, updated_at)
					 values ($1, 'personal_details_changed', $2, false, now())`,
					[worker.userId, channel],
				);
			}

			await change(admin, worker, "2026-12-01", PICK_TK);

			const notices = await noticesOf(worker);
			expect(notices).toHaveLength(1);
			expect(notices[0]).toMatchObject({
				type: "personal_details_changed",
				action_url: "/settings/profile",
			});
			expect(JSON.parse(notices[0]?.metadata ?? "{}")).toMatchObject({
				part: "health_insurance",
				outcome: "changed",
				i18n: {
					messageKey: "common:notifications.content.personalDetailsChanged.healthInsuranceChanged",
					params: { validFrom: { kind: "plainDate", date: "2026-12-01" } },
				},
			});
			expect(notices[0]?.message).toContain("health insurance");
			const emails = emailsTo(worker);
			expect(emails).toHaveLength(1);
			for (const text of [JSON.stringify(notices), JSON.stringify(emails)]) {
				expect(text).not.toContain("Techniker");
				expect(text).not.toContain(TK.betriebsnummer);
				expect(text).not.toContain("statutory");
			}
		});

		it("tells the employee about an end in its own words", async () => {
			await change(admin, worker, "2026-01-01", PRIVATE);
			await end(admin, worker, "2026-12-01");

			const ended = (await noticesOf(worker)).find(
				(notice) => JSON.parse(notice.metadata).outcome === "ended",
			);
			expect(JSON.parse(ended?.metadata ?? "{}")).toMatchObject({
				part: "health_insurance",
				i18n: {
					messageKey: "common:notifications.content.personalDetailsChanged.healthInsuranceEnded",
				},
			});
			expect(ended?.message).not.toContain("Allianz");
			expect(emailsTo(worker)).toHaveLength(2);
		});

		it("records changes and ends with actor, part and day, never the insurer", async () => {
			await change(admin, worker, "2026-01-01", PICK_TK);
			await change(admin, worker, "2026-01-01", PRIVATE);
			await end(admin, worker, "2026-12-01");

			const entries = (await auditOf(worker)).map((entry) => ({
				...entry,
				metadata: JSON.parse(entry.metadata ?? "{}"),
			}));
			expect(entries).toEqual(
				expect.arrayContaining([
					{
						action: "personal_details.changed",
						performed_by: admin.userId,
						metadata: { part: "health_insurance", validFrom: "2026-01-01", correction: false },
						changes: null,
					},
					expect.objectContaining({
						metadata: { part: "health_insurance", validFrom: "2026-01-01", correction: true },
					}),
					expect.objectContaining({
						action: "personal_details.ended",
						metadata: {
							part: "health_insurance",
							validFrom: "2026-12-01",
							correction: false,
							superseded: 0,
						},
					}),
				]),
			);
			const text = JSON.stringify(entries);
			for (const value of ["Techniker", TK.betriebsnummer, "Allianz", "statutory", "private"]) {
				expect(text).not.toContain(value);
			}
		});
	});

	describe("a failed write", () => {
		const trigger = `health_insurance_forced_failure_${randomUUID().replaceAll("-", "")}`;

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

		it("names no insurer in the error, whatever the database said", async () => {
			await fixture.pool.query(
				`create function ${trigger}() returns trigger language plpgsql as $$
				begin
					raise exception 'forced failure for %', new.insurer_name
						using errcode = '23514', detail = format('Failing row contains (%s, %s)', new.insurer_name, new.insurer_betriebsnummer);
				end $$`,
			);
			await fixture.pool.query(
				`create trigger ${trigger} before insert on employee_health_insurance for each row
				when (new.employee_id = '${worker.employeeId}') execute function ${trigger}()`,
			);

			const error = await change(admin, worker, "2026-12-01", PICK_TK).then(
				() => null,
				(failure: unknown) => failure,
			);

			expect(error).toMatchObject({ code: "23514" });
			const text = textOf(error);
			for (const value of ["Techniker", TK.betriebsnummer]) expect(text).not.toContain(value);
			expect((await read(admin, worker))?.healthInsurance?.history).toEqual([]);
		});
	});
});
