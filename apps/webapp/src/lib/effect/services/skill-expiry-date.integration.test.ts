/**
 * PostgreSQL contract (#1142): the skill expiry date is a plain last-valid day.
 * A skill expiring 2026-11-30 covers a shift dated 2026-11-30 and is an
 * expired skill for a shift dated 2026-12-01, in every scheduling check.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Effect, Layer } from "effect";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SeededEmployee } from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import { shiftStoredDate } from "@/lib/scheduling/shift-date";
import {
	createShiftDatabaseFixture,
	type ShiftDatabaseFixture,
	type ShiftTestOrganization,
} from "@/lib/scheduling/testing/shift-database.test.fixture";
import { DatabaseServiceLive } from "./database.service";
import { ShiftService, ShiftServiceLive } from "./shift.service";
import { SkillService, SkillServiceLive } from "./skill.service";

const layer = Layer.mergeAll(SkillServiceLive, ShiftServiceLive).pipe(
	Layer.provide(DatabaseServiceLive),
);

const run = <A, E>(program: Effect.Effect<A, E, SkillService | ShiftService>) =>
	Effect.runPromise(program.pipe(Effect.provide(layer)));

const skills = <A, E>(program: (service: SkillService["Service"]) => Effect.Effect<A, E>) =>
	run(
		Effect.gen(function* () {
			return yield* program(yield* SkillService);
		}),
	);

const skillsResult = <A, E>(program: (service: SkillService["Service"]) => Effect.Effect<A, E>) =>
	skills((service) => Effect.result(program(service)));

const failureOf = (errorClass: typeof NotFoundError | typeof ValidationError) => ({
	_tag: "Failure",
	failure: expect.any(errorClass),
});

const LAST_VALID_DAY = "2026-11-30";
const DAY_AFTER = "2026-12-01";

describe("skill expiry date (#1142)", () => {
	let fixture: ShiftDatabaseFixture;
	let org: ShiftTestOrganization;
	let other: ShiftTestOrganization;
	let firstAid: string;
	let french: string;
	let holder: SeededEmployee;

	async function createSkill(
		target: ShiftTestOrganization,
		name: string,
		requiresExpiry: boolean,
	): Promise<string> {
		const created = await skills((service) =>
			service.createSkill({
				organizationId: target.organizationId,
				name,
				category: "certification",
				requiresExpiry,
				createdBy: target.creator.userId,
			}),
		);
		return created.id;
	}

	async function storedExpiry(employeeId: string, skillId: string) {
		const { rows } = await fixture.pool.query<{ expires_at: string | null; id: string }>(
			"select id, expires_at::text as expires_at from employee_skill where employee_id = $1 and skill_id = $2",
			[employeeId, skillId],
		);
		return rows[0];
	}

	beforeAll(async () => {
		fixture = await createShiftDatabaseFixture();
		org = await fixture.organization("Europe/Berlin");
		other = await fixture.organization("UTC");
		firstAid = await createSkill(org, "First aid", true);
		french = await createSkill(org, "French", false);
		holder = await fixture.seedEmployee({ organizationId: org.organizationId });
		await skills((service) =>
			service.setSubareaSkillRequirements({
				organizationId: org.organizationId,
				targetId: org.subareaId,
				requirements: [{ skillId: firstAid, isRequired: true }],
				createdBy: org.creator.userId,
			}),
		);
		await skills((service) =>
			service.assignSkillToEmployee({
				organizationId: org.organizationId,
				employeeId: holder.employeeId,
				skillId: firstAid,
				expiresAt: LAST_VALID_DAY,
				assignedBy: org.creator.userId,
			}),
		);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	describe("assigning", () => {
		it("stores the picked day as the skill expiry date", async () => {
			expect(await storedExpiry(holder.employeeId, firstAid)).toMatchObject({
				expires_at: LAST_VALID_DAY,
			});
		});

		it("rejects a skill that requires expiry without a date", async () => {
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });

			const result = await skillsResult((service) =>
				service.assignSkillToEmployee({
					organizationId: org.organizationId,
					employeeId: person.employeeId,
					skillId: firstAid,
					assignedBy: org.creator.userId,
				}),
			);

			expect(result).toMatchObject(failureOf(ValidationError));
			expect(await storedExpiry(person.employeeId, firstAid)).toBeUndefined();
		});

		it("rejects an expiry date that is not a plain date", async () => {
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });

			const result = await skillsResult((service) =>
				service.assignSkillToEmployee({
					organizationId: org.organizationId,
					employeeId: person.employeeId,
					skillId: firstAid,
					expiresAt: "2026-11-30T00:00:00.000Z",
					assignedBy: org.creator.userId,
				}),
			);

			expect(result).toMatchObject(failureOf(ValidationError));
		});
	});

	describe("editing in place", () => {
		it("changes an assigned employee skill's expiry date without re-assigning it", async () => {
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });
			await skills((service) =>
				service.assignSkillToEmployee({
					organizationId: org.organizationId,
					employeeId: person.employeeId,
					skillId: firstAid,
					expiresAt: "2026-06-30",
					notes: "Card 4711",
					assignedBy: org.creator.userId,
				}),
			);
			const before = await storedExpiry(person.employeeId, firstAid);

			const updated = await skills((service) =>
				service.updateEmployeeSkillExpiry({
					organizationId: org.organizationId,
					employeeId: person.employeeId,
					skillId: firstAid,
					expiresAt: "2027-06-30",
				}),
			);

			expect(updated).toMatchObject({
				id: before?.id,
				expiresAt: "2027-06-30",
				notes: "Card 4711",
			});
			expect(await storedExpiry(person.employeeId, firstAid)).toEqual({
				id: before?.id,
				expires_at: "2027-06-30",
			});
		});

		it("still rejects an empty date for a skill that requires expiry", async () => {
			const result = await skillsResult((service) =>
				service.updateEmployeeSkillExpiry({
					organizationId: org.organizationId,
					employeeId: holder.employeeId,
					skillId: firstAid,
					expiresAt: null,
				}),
			);

			expect(result).toMatchObject(failureOf(ValidationError));
			expect(await storedExpiry(holder.employeeId, firstAid)).toMatchObject({
				expires_at: LAST_VALID_DAY,
			});
		});

		it("clears the date of a skill that does not require expiry", async () => {
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });
			await skills((service) =>
				service.assignSkillToEmployee({
					organizationId: org.organizationId,
					employeeId: person.employeeId,
					skillId: french,
					expiresAt: "2027-01-31",
					assignedBy: org.creator.userId,
				}),
			);

			await skills((service) =>
				service.updateEmployeeSkillExpiry({
					organizationId: org.organizationId,
					employeeId: person.employeeId,
					skillId: french,
					expiresAt: null,
				}),
			);

			expect(await storedExpiry(person.employeeId, french)).toMatchObject({ expires_at: null });
		});

		it("does not edit another organization's employee skill", async () => {
			const result = await skillsResult((service) =>
				service.updateEmployeeSkillExpiry({
					organizationId: other.organizationId,
					employeeId: holder.employeeId,
					skillId: firstAid,
					expiresAt: "2030-01-01",
				}),
			);

			expect(result).toMatchObject(failureOf(NotFoundError));
			expect(await storedExpiry(holder.employeeId, firstAid)).toMatchObject({
				expires_at: LAST_VALID_DAY,
			});
		});

		it("reports an unassigned skill as not found", async () => {
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });

			const result = await skillsResult((service) =>
				service.updateEmployeeSkillExpiry({
					organizationId: org.organizationId,
					employeeId: person.employeeId,
					skillId: french,
					expiresAt: "2030-01-01",
				}),
			);

			expect(result).toMatchObject(failureOf(NotFoundError));
		});
	});

	describe("qualification checks use the shift date", () => {
		it("covers a shift on the skill expiry date", async () => {
			const result = await skills((service) =>
				service.validateEmployeeForShift(org.organizationId, holder.employeeId, {
					subareaId: org.subareaId,
					date: LAST_VALID_DAY,
				}),
			);

			expect(result).toEqual({ isQualified: true, missingSkills: [], expiredSkills: [] });
		});

		it("is an expired skill for a shift the day after", async () => {
			const result = await skills((service) =>
				service.validateEmployeeForShift(org.organizationId, holder.employeeId, {
					subareaId: org.subareaId,
					date: DAY_AFTER,
				}),
			);

			expect(result.isQualified).toBe(false);
			expect(result.expiredSkills).toEqual([
				{ id: firstAid, name: "First aid", expiresAt: LAST_VALID_DAY },
			]);
		});

		it("applies the same rule to the subarea check", async () => {
			const covered = await skills((service) =>
				service.validateEmployeeForSubarea(
					org.organizationId,
					holder.employeeId,
					org.subareaId,
					LAST_VALID_DAY,
				),
			);
			const expired = await skills((service) =>
				service.validateEmployeeForSubarea(
					org.organizationId,
					holder.employeeId,
					org.subareaId,
					DAY_AFTER,
				),
			);

			expect(covered.isQualified).toBe(true);
			expect(expired.expiredSkills.map((skill) => skill.expiresAt)).toEqual([LAST_VALID_DAY]);
		});

		it("rejects a shift date that is not a plain date", async () => {
			const result = await skillsResult((service) =>
				service.validateEmployeeForShift(org.organizationId, holder.employeeId, {
					subareaId: org.subareaId,
					date: "2026-12-01T00:00:00Z",
				}),
			);

			expect(result).toMatchObject(failureOf(ValidationError));
		});

		it("looks up qualified employees on the shift date", async () => {
			const covered = await skills((service) =>
				service.getQualifiedEmployeesForSkills(org.organizationId, [firstAid], LAST_VALID_DAY),
			);
			const expired = await skills((service) =>
				service.getQualifiedEmployeesForSkills(org.organizationId, [firstAid], DAY_AFTER),
			);

			expect(covered).toContain(holder.employeeId);
			expect(expired).not.toContain(holder.employeeId);
		});
	});

	describe("shift save warning", () => {
		async function saveShift(person: SeededEmployee, day: string) {
			return run(
				Effect.gen(function* () {
					const service = yield* ShiftService;
					return yield* service.upsertShift({
						organizationId: org.organizationId,
						employeeId: person.employeeId,
						subareaId: org.subareaId,
						date: shiftStoredDate(day, org.timezone),
						timezone: org.timezone,
						startTime: "08:00",
						endTime: "16:00",
						createdBy: org.creator.userId,
					});
				}),
			);
		}

		it("does not warn on the skill expiry date", async () => {
			const saved = await saveShift(holder, LAST_VALID_DAY);

			expect(saved.metadata.skillWarning).toBeUndefined();
		});

		it("warns about a skill that expires before a shift planned next month", async () => {
			// The skill is valid today (2026-10); the shift is planned after its last valid day.
			const saved = await saveShift(holder, DAY_AFTER);

			expect(saved.metadata.skillWarning?.expiredSkills).toEqual([
				{ id: firstAid, name: "First aid", expiresAt: LAST_VALID_DAY },
			]);
		});
	});

	describe("organization's today", () => {
		it("counts badges from the organization's calendar day", async () => {
			// 23:30 UTC on 30 November is already 1 December in Berlin.
			const now = Temporal.Instant.from("2026-11-30T23:30:00Z");

			const window = await skills((service) =>
				service.getSkillExpiryWindow(org.organizationId, now),
			);
			const otherWindow = await skills((service) =>
				service.getSkillExpiryWindow(other.organizationId, now),
			);

			expect(window).toEqual({ today: DAY_AFTER, expiringSoonDays: 30 });
			expect(otherWindow).toEqual({ today: LAST_VALID_DAY, expiringSoonDays: 30 });
		});
	});

	describe("migration", () => {
		function migrationStatements() {
			const directory = path.join(process.cwd(), "drizzle");
			const file = readdirSync(directory).find((name) =>
				name.endsWith("_employee_skill_expiry_date.sql"),
			);
			expect(file).toBeDefined();
			return readFileSync(path.join(directory, file as string), "utf8")
				.split("--> statement-breakpoint")
				.map((statement) => statement.trim())
				.filter((statement) => statement.length > 0);
		}

		it("turns midnight timestamps into their UTC calendar day and keeps null", async () => {
			const dated = await fixture.seedEmployee({ organizationId: org.organizationId });
			const undated = await fixture.seedEmployee({ organizationId: org.organizationId });
			const client = await fixture.pool.connect();
			try {
				await client.query("begin");
				// The column as it was before the migration.
				await client.query(
					`alter table employee_skill alter column expires_at set data type timestamp
					 using expires_at::timestamp`,
				);
				await client.query(
					`insert into employee_skill (employee_id, skill_id, expires_at, assigned_by)
					 values ($1, $3, '2026-11-30T00:00:00', $4), ($2, $3, null, $4)`,
					[dated.employeeId, undated.employeeId, firstAid, org.creator.userId],
				);

				for (const statement of migrationStatements()) await client.query(statement);

				const { rows } = await client.query<{ employee_id: string; expires_at: string | null }>(
					`select employee_id, expires_at::text as expires_at from employee_skill
					 where employee_id in ($1, $2)`,
					[dated.employeeId, undated.employeeId],
				);
				const { rows: columns } = await client.query<{ data_type: string }>(
					`select data_type from information_schema.columns
					 where table_name = 'employee_skill' and column_name = 'expires_at'`,
				);
				expect(Object.fromEntries(rows.map((row) => [row.employee_id, row.expires_at]))).toEqual({
					[dated.employeeId]: "2026-11-30",
					[undated.employeeId]: null,
				});
				expect(columns.map((column) => column.data_type)).toEqual(["date"]);
			} finally {
				await client.query("rollback");
				client.release();
			}
		});
	});
});
