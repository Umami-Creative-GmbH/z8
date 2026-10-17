/**
 * PostgreSQL contract (#893): assigning an employee who lacks a required skill
 * on the shift date records a skill requirement override, with the planner's
 * reason, in the same transaction as the assignment. Preferred skills never
 * need a reason.
 */
import { Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SeededEmployee } from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { shiftStoredDate } from "@/lib/scheduling/shift-date";
import { SKILL_OVERRIDE_REASON_REQUIRED } from "@/lib/scheduling/skill-override";
import {
	createShiftDatabaseFixture,
	SHIFT_DAY,
	type ShiftDatabaseFixture,
	type ShiftTestOrganization,
	STORED_SHIFT_DATES,
} from "@/lib/scheduling/testing/shift-database.test.fixture";
import { DatabaseServiceLive } from "./database.service";
import { ShiftService, ShiftServiceLive } from "./shift.service";
import { ShiftRequestService, ShiftRequestServiceLive } from "./shift-request.service";
import { SkillService, SkillServiceLive } from "./skill.service";

const layer = Layer.mergeAll(SkillServiceLive, ShiftServiceLive, ShiftRequestServiceLive).pipe(
	Layer.provide(DatabaseServiceLive),
);

type Services = SkillService | ShiftService | ShiftRequestService;

const run = <A, E>(program: Effect.Effect<A, E, Services>) =>
	Effect.runPromise(program.pipe(Effect.provide(layer)));

const skills = <A, E>(program: (service: SkillService["Service"]) => Effect.Effect<A, E>) =>
	run(
		Effect.gen(function* () {
			return yield* program(yield* SkillService);
		}),
	);

const LAST_VALID_DAY = "2026-11-30";
const DAY_AFTER = "2026-12-01";

describe("skill requirement overrides (#893)", () => {
	let fixture: ShiftDatabaseFixture;
	let org: ShiftTestOrganization;
	let forklift: string;
	let french: string;

	async function createSkill(name: string): Promise<string> {
		const created = await skills((service) =>
			service.createSkill({
				organizationId: org.organizationId,
				name,
				category: "certification",
				requiresExpiry: false,
				createdBy: org.creator.userId,
			}),
		);
		return created.id;
	}

	async function grant(person: SeededEmployee, skillId: string, expiresAt?: string) {
		await skills((service) =>
			service.assignSkillToEmployee({
				organizationId: org.organizationId,
				employeeId: person.employeeId,
				skillId,
				expiresAt,
				assignedBy: org.creator.userId,
			}),
		);
	}

	beforeAll(async () => {
		fixture = await createShiftDatabaseFixture();
		org = await fixture.organization("Europe/Berlin");
		forklift = await createSkill("Forklift");
		french = await createSkill("French");
		await skills((service) =>
			service.setSubareaSkillRequirements({
				organizationId: org.organizationId,
				targetId: org.subareaId,
				requirements: [
					{ skillId: forklift, isRequired: true },
					{ skillId: french, isRequired: false },
				],
				createdBy: org.creator.userId,
			}),
		);
	});

	afterAll(async () => {
		// A decided request references its approver without cascading.
		await fixture?.pool.query(
			"delete from shift_request where shift_id in (select id from shift where organization_id = $1)",
			[org?.organizationId],
		);
		await fixture?.close();
	});

	interface SaveInput {
		id?: string;
		employeeId: string | null;
		day: string;
		subareaId?: string;
		templateId?: string | null;
		notes?: string;
		reason?: string;
		organization?: ShiftTestOrganization;
	}

	const saveShift = (input: SaveInput) => {
		const target = input.organization ?? org;
		return Effect.gen(function* () {
			const service = yield* ShiftService;
			return yield* service.upsertShift({
				id: input.id,
				organizationId: target.organizationId,
				employeeId: input.employeeId,
				subareaId: input.subareaId ?? target.subareaId,
				templateId: input.templateId,
				date: shiftStoredDate(input.day, target.timezone),
				timezone: target.timezone,
				startTime: "08:00",
				endTime: "16:00",
				notes: input.notes,
				skillOverrideReason: input.reason,
				createdBy: target.creator.userId,
			});
		});
	};

	const overridesOf = (shiftId: string, organization = org) =>
		skills((service) => service.getOverrideHistory(organization.organizationId, { shiftId }));

	const assigneeOf = (shiftId: string) =>
		run(
			Effect.gen(function* () {
				const service = yield* ShiftService;
				return (yield* service.getShiftById(shiftId))?.employeeId;
			}),
		);

	const shiftsOf = (person: SeededEmployee) =>
		run(
			Effect.gen(function* () {
				const service = yield* ShiftService;
				return yield* service.getShifts({
					organizationId: org.organizationId,
					employeeId: person.employeeId,
				});
			}),
		);

	/** Makes every override insert fail while `work` runs, as a failing audit write would. */
	async function withFailingOverrideWrites<A>(work: () => Promise<A>): Promise<A> {
		await fixture.pool.query(`
			create or replace function t893_refuse_override() returns trigger language plpgsql as $$
			begin raise exception 't893: override write refused'; end $$;
			create trigger t893_refuse_override before insert on skill_requirement_override
			for each row execute function t893_refuse_override();
		`);
		try {
			return await work();
		} finally {
			await fixture.pool.query(`
				drop trigger t893_refuse_override on skill_requirement_override;
				drop function t893_refuse_override();
			`);
		}
	}

	describe("saving a shift", () => {
		it("records the override with the planner's reason", async () => {
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });
			const before = Date.now();

			const saved = await run(
				saveShift({ employeeId: person.employeeId, day: SHIFT_DAY, reason: "  Only one on duty " }),
			);

			const overrides = await overridesOf(saved.shift.id);
			expect(overrides).toHaveLength(1);
			const [override] = overrides;
			expect(override).toMatchObject({
				organizationId: org.organizationId,
				shiftId: saved.shift.id,
				employeeId: person.employeeId,
				overrideReason: "Only one on duty",
				overriddenBy: org.creator.userId,
				missingSkillNames: ["Forklift"],
			});
			expect(JSON.parse(override.missingSkillIds)).toEqual([forklift]);
			expect(override.overriddenAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
			expect(saved.shift.employeeId).toBe(person.employeeId);
		});

		it.each([
			["without a reason", undefined],
			["with a blank reason", "   "],
		])("refuses the assignment %s and saves nothing", async (_label, reason) => {
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });
			const shiftId = await fixture.shift(org, {
				employeeId: null,
				stored: STORED_SHIFT_DATES["Europe/Berlin"].day,
				status: "draft",
			});

			const created = await run(
				Effect.result(saveShift({ employeeId: person.employeeId, day: SHIFT_DAY, reason })),
			);
			const updated = await run(
				Effect.result(
					saveShift({ id: shiftId, employeeId: person.employeeId, day: SHIFT_DAY, reason }),
				),
			);

			for (const result of [created, updated]) {
				expect(result).toMatchObject({
					_tag: "Failure",
					failure: { _tag: "ValidationError", refusal: SKILL_OVERRIDE_REASON_REQUIRED },
				});
			}
			expect(await assigneeOf(shiftId)).toBeNull();
			expect(await shiftsOf(person)).toEqual([]);
		});

		it("needs no reason for a qualified employee, an open shift or a preferred-only gap", async () => {
			const qualified = await fixture.seedEmployee({ organizationId: org.organizationId });
			await grant(qualified, forklift);

			const saves = await Promise.all([
				run(saveShift({ employeeId: qualified.employeeId, day: SHIFT_DAY })),
				run(saveShift({ employeeId: null, day: SHIFT_DAY })),
			]);

			for (const saved of saves) expect(await overridesOf(saved.shift.id)).toEqual([]);
			// French is preferred: the warning names it, but nothing is logged.
			expect(saves[0].metadata.skillWarning?.missingSkills).toEqual([
				{ id: french, name: "French", category: "certification", isRequired: false },
			]);
		});

		it("treats an expired required skill as unmet from the day after its last valid day", async () => {
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });
			await grant(person, forklift, LAST_VALID_DAY);

			// Berlin's 2026-12-01 starts at 2026-11-30T23:00Z: the UTC date would still be valid.
			const onLastDay = await run(
				saveShift({ employeeId: person.employeeId, day: LAST_VALID_DAY }),
			);
			const refused = await run(
				Effect.result(saveShift({ employeeId: person.employeeId, day: DAY_AFTER })),
			);
			const dayAfter = await run(
				saveShift({ employeeId: person.employeeId, day: DAY_AFTER, reason: "Renewal booked" }),
			);

			expect(await overridesOf(onLastDay.shift.id)).toEqual([]);
			expect(refused).toMatchObject({
				_tag: "Failure",
				failure: { refusal: SKILL_OVERRIDE_REASON_REQUIRED },
			});
			const [override] = await overridesOf(dayAfter.shift.id);
			expect(JSON.parse(override.missingSkillIds)).toEqual([forklift]);
		});

		it("lists each unmet required skill once across subarea and template, required winning", async () => {
			const template = await run(
				Effect.gen(function* () {
					const service = yield* ShiftService;
					return yield* service.createTemplate({
						organizationId: org.organizationId,
						name: `Late ${crypto.randomUUID()}`,
						startTime: "14:00",
						endTime: "22:00",
						createdBy: org.creator.userId,
					});
				}),
			);
			await skills((service) =>
				service.setTemplateSkillRequirements({
					organizationId: org.organizationId,
					targetId: template.id,
					requirements: [
						{ skillId: forklift, isRequired: true },
						{ skillId: french, isRequired: true },
					],
					createdBy: org.creator.userId,
				}),
			);
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });

			const saved = await run(
				saveShift({
					employeeId: person.employeeId,
					day: SHIFT_DAY,
					templateId: template.id,
					reason: "Covering",
				}),
			);

			const [override] = await overridesOf(saved.shift.id);
			expect(JSON.parse(override.missingSkillIds).sort()).toEqual([forklift, french].sort());
		});

		it("does not log an unchanged save or a notes edit again", async () => {
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });
			const saved = await run(
				saveShift({ employeeId: person.employeeId, day: SHIFT_DAY, reason: "First" }),
			);
			const again = { id: saved.shift.id, employeeId: person.employeeId, day: SHIFT_DAY };

			await run(saveShift(again));
			await run(saveShift({ ...again, notes: "Bring gloves" }));
			await run(saveShift({ ...again, reason: "Retry" }));

			expect((await overridesOf(saved.shift.id)).map((row) => row.overrideReason)).toEqual([
				"First",
			]);
		});

		it("asks again when the employee, date, subarea or template changes", async () => {
			const first = await fixture.seedEmployee({ organizationId: org.organizationId });
			const second = await fixture.seedEmployee({ organizationId: org.organizationId });
			const dock = await fixture.subarea(org, `Dock ${crypto.randomUUID()}`);
			await skills((service) =>
				service.setSubareaSkillRequirements({
					organizationId: org.organizationId,
					targetId: dock,
					requirements: [{ skillId: forklift, isRequired: true }],
					createdBy: org.creator.userId,
				}),
			);
			const saved = await run(
				saveShift({ employeeId: first.employeeId, day: SHIFT_DAY, reason: "Assigned" }),
			);
			const id = saved.shift.id;

			const steps: SaveInput[] = [
				{ id, employeeId: second.employeeId, day: SHIFT_DAY },
				{ id, employeeId: second.employeeId, day: "2026-10-10" },
				{ id, employeeId: second.employeeId, day: "2026-10-10", subareaId: dock },
				{ id, employeeId: first.employeeId, day: "2026-10-10", subareaId: dock },
			];
			for (const [index, step] of steps.entries()) {
				expect(await run(Effect.result(saveShift(step)))).toMatchObject({
					_tag: "Failure",
					failure: { refusal: SKILL_OVERRIDE_REASON_REQUIRED },
				});
				await run(saveShift({ ...step, reason: `Step ${index}` }));
			}

			const overrides = await overridesOf(id);
			expect(overrides.map((row) => row.overrideReason).sort()).toEqual(
				["Assigned", "Step 0", "Step 1", "Step 2", "Step 3"].sort(),
			);
		});

		it("logs an earlier assignment without an override on its next save", async () => {
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });
			const shiftId = await fixture.shift(org, {
				employeeId: person.employeeId,
				stored: STORED_SHIFT_DATES["Europe/Berlin"].day,
				status: "draft",
			});
			const again = { id: shiftId, employeeId: person.employeeId, day: SHIFT_DAY };

			const refused = await run(Effect.result(saveShift(again)));
			await run(saveShift({ ...again, reason: "Confirmed" }));

			expect(refused).toMatchObject({
				_tag: "Failure",
				failure: { refusal: SKILL_OVERRIDE_REASON_REQUIRED },
			});
			expect((await overridesOf(shiftId)).map((row) => row.overrideReason)).toEqual(["Confirmed"]);
		});

		it("refuses another organization's employee or shift and logs nothing", async () => {
			const other = await fixture.organization("UTC");
			const outsider = await fixture.seedEmployee({ organizationId: other.organizationId });
			const foreignShift = await fixture.shift(other, {
				employeeId: null,
				stored: STORED_SHIFT_DATES.UTC.day,
				status: "draft",
			});
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });

			const results = [
				await run(
					Effect.result(
						saveShift({ employeeId: outsider.employeeId, day: SHIFT_DAY, reason: "x" }),
					),
				),
				await run(
					Effect.result(
						saveShift({
							id: foreignShift,
							employeeId: person.employeeId,
							day: SHIFT_DAY,
							reason: "x",
						}),
					),
				),
			];

			for (const result of results) {
				expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "NotFoundError" } });
			}
			expect(await assigneeOf(foreignShift)).toBeNull();
			expect(await overridesOf(foreignShift, other)).toEqual([]);
		});

		it("keeps the shift unchanged when the override cannot be written", async () => {
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });
			const shiftId = await fixture.shift(org, {
				employeeId: null,
				stored: STORED_SHIFT_DATES["Europe/Berlin"].day,
				status: "draft",
			});

			const result = await withFailingOverrideWrites(() =>
				run(
					Effect.result(
						saveShift({ id: shiftId, employeeId: person.employeeId, day: SHIFT_DAY, reason: "x" }),
					),
				),
			);

			expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "DatabaseError" } });
			expect(await assigneeOf(shiftId)).toBeNull();
		});
	});

	describe("recording an override directly", () => {
		it("refuses a shift, employee or skill of another organization", async () => {
			const other = await fixture.organization("UTC");
			const outsider = await fixture.seedEmployee({ organizationId: other.organizationId });
			const foreignShift = await fixture.shift(other, {
				employeeId: null,
				stored: STORED_SHIFT_DATES.UTC.day,
			});
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });
			const ownShift = await fixture.shift(org, {
				employeeId: person.employeeId,
				stored: STORED_SHIFT_DATES["Europe/Berlin"].day,
			});
			const foreignSkill = await run(
				Effect.gen(function* () {
					const service = yield* SkillService;
					return yield* service.createSkill({
						organizationId: other.organizationId,
						name: "Crane",
						category: "certification",
						requiresExpiry: false,
						createdBy: other.creator.userId,
					});
				}),
			);
			const record = (input: { shiftId: string; employeeId: string; skillId: string }) =>
				skills((service) =>
					Effect.result(
						service.recordOverride({
							organizationId: org.organizationId,
							shiftId: input.shiftId,
							employeeId: input.employeeId,
							missingSkillIds: [input.skillId],
							overrideReason: "x",
							overriddenBy: org.creator.userId,
						}),
					),
				);

			const results = [
				await record({ shiftId: foreignShift, employeeId: person.employeeId, skillId: forklift }),
				await record({ shiftId: ownShift, employeeId: outsider.employeeId, skillId: forklift }),
				await record({
					shiftId: ownShift,
					employeeId: person.employeeId,
					skillId: foreignSkill.id,
				}),
			];

			for (const result of results) {
				expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "NotFoundError" } });
			}
			expect(await overridesOf(ownShift)).toEqual([]);
			expect(await overridesOf(foreignShift, other)).toEqual([]);
		});
	});

	describe("approving a shift request", () => {
		const requests = <A, E>(
			program: (service: ShiftRequestService["Service"]) => Effect.Effect<A, E>,
		) =>
			run(
				Effect.gen(function* () {
					return yield* program(yield* ShiftRequestService);
				}),
			);

		const approve = (requestId: string, reason?: string, approver = org.creator) =>
			requests((service) =>
				Effect.result(
					service.approveRequest(org.organizationId, requestId, approver.employeeId, {
						skillOverrideReason: reason,
					}),
				),
			);

		async function pickup(person: SeededEmployee) {
			const shiftId = await fixture.shift(org, {
				employeeId: null,
				stored: STORED_SHIFT_DATES["Europe/Berlin"].day,
			});
			const request = await requests((service) =>
				service.requestPickup(org.organizationId, { shiftId, requesterId: person.employeeId }),
			);
			return { shiftId, requestId: request.id };
		}

		const statusOf = (requestId: string) =>
			requests((service) => service.getRequestById(org.organizationId, requestId)).then(
				(request) => request?.status,
			);

		it("refuses a pickup by an employee without a required skill until a reason is given", async () => {
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });
			const { shiftId, requestId } = await pickup(person);

			const refused = await approve(requestId, " ");

			expect(refused).toMatchObject({
				_tag: "Failure",
				failure: { _tag: "ValidationError", refusal: SKILL_OVERRIDE_REASON_REQUIRED },
			});
			expect(await statusOf(requestId)).toBe("pending");
			expect(await assigneeOf(shiftId)).toBeNull();
			expect(await overridesOf(shiftId)).toEqual([]);

			expect(await approve(requestId, "Short-staffed")).toMatchObject({ _tag: "Success" });
			expect(await statusOf(requestId)).toBe("approved");
			expect(await assigneeOf(shiftId)).toBe(person.employeeId);
			const overrides = await overridesOf(shiftId);
			expect(overrides).toHaveLength(1);
			expect(overrides[0]).toMatchObject({
				organizationId: org.organizationId,
				employeeId: person.employeeId,
				overrideReason: "Short-staffed",
				overriddenBy: org.creator.userId,
				missingSkillNames: ["Forklift"],
			});
		});

		it("records the swap target's unmet skills", async () => {
			const requester = await fixture.seedEmployee({ organizationId: org.organizationId });
			const target = await fixture.seedEmployee({ organizationId: org.organizationId });
			await grant(requester, forklift);
			const shiftId = await fixture.shift(org, {
				employeeId: requester.employeeId,
				stored: STORED_SHIFT_DATES["Europe/Berlin"].day,
			});
			const request = await requests((service) =>
				service.requestSwap(org.organizationId, {
					shiftId,
					requesterId: requester.employeeId,
					targetEmployeeId: target.employeeId,
				}),
			);

			expect(await approve(request.id)).toMatchObject({
				_tag: "Failure",
				failure: { refusal: SKILL_OVERRIDE_REASON_REQUIRED },
			});
			expect(await approve(request.id, "Swap agreed")).toMatchObject({ _tag: "Success" });

			expect((await overridesOf(shiftId)).map((row) => row.employeeId)).toEqual([
				target.employeeId,
			]);
		});

		it("approves a qualified pickup without a reason or an override", async () => {
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });
			await grant(person, forklift);
			const { shiftId, requestId } = await pickup(person);

			expect(await approve(requestId)).toMatchObject({ _tag: "Success" });
			expect(await overridesOf(shiftId)).toEqual([]);
		});

		it("logs nothing for a request that is no longer pending or an approver who may not approve", async () => {
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });
			const colleague = await fixture.seedEmployee({ organizationId: org.organizationId });
			const rejected = await pickup(person);
			await requests((service) =>
				service.rejectRequest(org.organizationId, rejected.requestId, org.creator.employeeId),
			);
			const pending = await pickup(person);

			expect(await approve(rejected.requestId, "x")).toMatchObject({
				_tag: "Failure",
				failure: { _tag: "ConflictError" },
			});
			expect(await approve(pending.requestId, "x", colleague)).toMatchObject({
				_tag: "Failure",
				failure: { _tag: "AuthorizationError" },
			});
			expect(await overridesOf(rejected.shiftId)).toEqual([]);
			expect(await overridesOf(pending.shiftId)).toEqual([]);
			expect(await statusOf(pending.requestId)).toBe("pending");
		});

		it("leaves the request pending when the override cannot be written", async () => {
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });
			const { shiftId, requestId } = await pickup(person);

			const result = await withFailingOverrideWrites(() => approve(requestId, "x"));

			expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "DatabaseError" } });
			expect(await statusOf(requestId)).toBe("pending");
			expect(await assigneeOf(shiftId)).toBeNull();
		});
	});

	describe("the skill check", () => {
		it("keeps an employee whose only gap is an expired preferred skill qualified", async () => {
			const person = await fixture.seedEmployee({ organizationId: org.organizationId });
			await grant(person, forklift);
			await grant(person, french, LAST_VALID_DAY);

			const result = await skills((service) =>
				service.validateEmployeeForShift(org.organizationId, person.employeeId, {
					subareaId: org.subareaId,
					date: DAY_AFTER,
				}),
			);

			expect(result.isQualified).toBe(true);
			expect(result.expiredSkills).toEqual([
				{
					id: french,
					name: "French",
					expiresAt: LAST_VALID_DAY,
					certificateOnFile: false,
					isRequired: false,
				},
			]);
		});
	});
});
