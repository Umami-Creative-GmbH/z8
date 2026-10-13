/**
 * PostgreSQL contract (#1135): every SkillService method is scoped to the
 * caller's organization. Ids of another organization's skills, employees,
 * subareas and shift templates behave as if they did not exist, and nothing
 * of the other organization is read or written.
 */
import { randomUUID } from "node:crypto";
import { Effect, Layer } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NotFoundError } from "@/lib/effect/errors";
import {
	createShiftDatabaseFixture,
	type ShiftDatabaseFixture,
	type ShiftTestOrganization,
} from "@/lib/scheduling/testing/shift-database.test.fixture";
import { DatabaseServiceLive } from "./database.service";
import { SkillService, SkillServiceLive } from "./skill.service";

const layer = SkillServiceLive.pipe(Layer.provide(DatabaseServiceLive));

const run = <A, E>(program: (service: SkillService["Service"]) => Effect.Effect<A, E>) =>
	Effect.runPromise(
		Effect.gen(function* () {
			return yield* program(yield* SkillService);
		}).pipe(Effect.provide(layer)),
	);

const runResult = <A, E>(program: (service: SkillService["Service"]) => Effect.Effect<A, E>) =>
	run((service) => Effect.result(program(service)));

/** An `Effect.result` failure with a NotFoundError for exactly this entity. */
const notFound = (entityType: string, entityId: string) => ({
	_tag: "Failure",
	failure: {
		asymmetricMatch: (error: unknown) =>
			error instanceof NotFoundError &&
			error.entityType === entityType &&
			error.entityId === entityId,
		toString: () => `NotFoundError(${entityType}, ${entityId})`,
	},
});

type Tenant = ShiftTestOrganization & {
	employeeId: string;
	skillId: string;
	templateId: string;
};

describe("skill service organization scoping", () => {
	let fixture: ShiftDatabaseFixture;
	let a: Tenant;
	let b: Tenant;

	async function tenant(name: string): Promise<Tenant> {
		const org = await fixture.organization("UTC");
		const { employeeId } = await fixture.seedEmployee({ organizationId: org.organizationId });
		const created = await run((service) =>
			service.createSkill({
				organizationId: org.organizationId,
				name: `Forklift ${name}`,
				category: "equipment",
				requiresExpiry: false,
				createdBy: org.creator.userId,
			}),
		);
		const templateId = randomUUID();
		await fixture.pool.query(
			`insert into shift_template (id, organization_id, name, start_time, end_time, created_by, updated_at)
			 values ($1, $2, 'Early', '06:00', '14:00', $3, now())`,
			[templateId, org.organizationId, org.creator.userId],
		);
		return { ...org, employeeId, skillId: created.id, templateId };
	}

	async function skillRow(id: string) {
		const { rows } = await fixture.pool.query<{ name: string; is_active: boolean }>(
			"select name, is_active from skill where id = $1",
			[id],
		);
		return rows[0];
	}

	async function assignmentCount(employeeId: string, skillId: string) {
		const { rows } = await fixture.pool.query<{ count: string }>(
			"select count(*) from employee_skill where employee_id = $1 and skill_id = $2",
			[employeeId, skillId],
		);
		return Number(rows[0]?.count);
	}

	async function requirementSkillIds(table: string, column: string, targetId: string) {
		const { rows } = await fixture.pool.query<{ skill_id: string }>(
			`select skill_id from ${table} where ${column} = $1`,
			[targetId],
		);
		return rows.map((row) => row.skill_id);
	}

	beforeAll(async () => {
		fixture = await createShiftDatabaseFixture();
		a = await tenant("A");
		b = await tenant("B");
		// Organization B's own data, which A must neither see nor change.
		await run((service) =>
			service.assignSkillToEmployee({
				organizationId: b.organizationId,
				employeeId: b.employeeId,
				skillId: b.skillId,
				assignedBy: b.creator.userId,
			}),
		);
		await run((service) =>
			service.setSubareaSkillRequirements({
				organizationId: b.organizationId,
				targetId: b.subareaId,
				requirements: [{ skillId: b.skillId, isRequired: true }],
				createdBy: b.creator.userId,
			}),
		);
		await run((service) =>
			service.setTemplateSkillRequirements({
				organizationId: b.organizationId,
				targetId: b.templateId,
				requirements: [{ skillId: b.skillId, isRequired: true }],
				createdBy: b.creator.userId,
			}),
		);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	describe("skill catalog", () => {
		it("does not update another organization's skill", async () => {
			const result = await runResult((service) =>
				service.updateSkill(a.organizationId, b.skillId, {
					name: "Renamed by A",
					isActive: false,
					updatedBy: a.creator.userId,
				}),
			);

			expect(result).toMatchObject(notFound("skill", b.skillId));
			expect(await skillRow(b.skillId)).toEqual({ name: "Forklift B", is_active: true });
		});

		it("updates the organization's own skill", async () => {
			const updated = await run((service) =>
				service.updateSkill(a.organizationId, a.skillId, {
					description: "Counterbalance trucks",
					updatedBy: a.creator.userId,
				}),
			);

			expect(updated).toMatchObject({ id: a.skillId, description: "Counterbalance trucks" });
		});

		it("does not deactivate another organization's skill", async () => {
			const result = await runResult((service) => service.deleteSkill(a.organizationId, b.skillId));

			expect(result).toMatchObject(notFound("skill", b.skillId));
			expect(await skillRow(b.skillId)).toMatchObject({ is_active: true });
		});

		it("does not read another organization's skill by id", async () => {
			expect(await run((service) => service.getSkillById(a.organizationId, b.skillId))).toBeNull();
			expect(
				await run((service) => service.getSkillById(b.organizationId, b.skillId)),
			).toMatchObject({ id: b.skillId });
		});
	});

	describe("employee assignments", () => {
		it("does not assign another organization's skill to the organization's employee", async () => {
			const result = await runResult((service) =>
				service.assignSkillToEmployee({
					organizationId: a.organizationId,
					employeeId: a.employeeId,
					skillId: b.skillId,
					assignedBy: a.creator.userId,
				}),
			);

			expect(result).toMatchObject(notFound("skill", b.skillId));
			expect(await assignmentCount(a.employeeId, b.skillId)).toBe(0);
		});

		it("does not assign a skill to another organization's employee", async () => {
			const result = await runResult((service) =>
				service.assignSkillToEmployee({
					organizationId: a.organizationId,
					employeeId: b.employeeId,
					skillId: a.skillId,
					assignedBy: a.creator.userId,
				}),
			);

			expect(result).toMatchObject(notFound("employee", b.employeeId));
			expect(await assignmentCount(b.employeeId, a.skillId)).toBe(0);
		});

		it("does not remove or list another organization's assignments", async () => {
			const removed = await runResult((service) =>
				service.removeSkillFromEmployee(a.organizationId, b.employeeId, b.skillId),
			);
			const listed = await runResult((service) =>
				service.getEmployeeSkills(a.organizationId, b.employeeId),
			);

			expect(removed).toMatchObject(notFound("employee", b.employeeId));
			expect(listed).toMatchObject(notFound("employee", b.employeeId));
			expect(await assignmentCount(b.employeeId, b.skillId)).toBe(1);
		});

		it("ignores pre-existing assignments of another organization's skill", async () => {
			// Written before #1135, when assignment did not check the skill's organization.
			await fixture.pool.query(
				`insert into employee_skill (id, employee_id, skill_id, assigned_by)
				 values ($1, $2, $3, $4)`,
				[randomUUID(), a.employeeId, b.skillId, a.creator.userId],
			);
			await run((service) =>
				service.assignSkillToEmployee({
					organizationId: a.organizationId,
					employeeId: a.employeeId,
					skillId: a.skillId,
					assignedBy: a.creator.userId,
				}),
			);

			const skills = await run((service) =>
				service.getEmployeeSkills(a.organizationId, a.employeeId),
			);
			const qualified = await run((service) =>
				service.getQualifiedEmployeesForSkills(a.organizationId, [b.skillId]),
			);

			expect(skills.map((row) => row.skillId)).toEqual([a.skillId]);
			expect(qualified).toEqual([]);
		});
	});

	describe("requirements", () => {
		it("does not replace another organization's subarea requirements", async () => {
			const result = await runResult((service) =>
				service.setSubareaSkillRequirements({
					organizationId: a.organizationId,
					targetId: b.subareaId,
					requirements: [],
					createdBy: a.creator.userId,
				}),
			);

			expect(result).toMatchObject(notFound("locationSubarea", b.subareaId));
			expect(
				await requirementSkillIds("subarea_skill_requirement", "subarea_id", b.subareaId),
			).toEqual([b.skillId]);
		});

		it("does not require another organization's skill on the organization's subarea", async () => {
			const result = await runResult((service) =>
				service.setSubareaSkillRequirements({
					organizationId: a.organizationId,
					targetId: a.subareaId,
					requirements: [
						{ skillId: a.skillId, isRequired: true },
						{ skillId: b.skillId, isRequired: true },
					],
					createdBy: a.creator.userId,
				}),
			);

			expect(result).toMatchObject(notFound("skill", b.skillId));
			expect(
				await requirementSkillIds("subarea_skill_requirement", "subarea_id", a.subareaId),
			).toEqual([]);
		});

		it("does not replace another organization's template requirements", async () => {
			const result = await runResult((service) =>
				service.setTemplateSkillRequirements({
					organizationId: a.organizationId,
					targetId: b.templateId,
					requirements: [],
					createdBy: a.creator.userId,
				}),
			);

			expect(result).toMatchObject(notFound("shiftTemplate", b.templateId));
			expect(
				await requirementSkillIds("shift_template_skill_requirement", "template_id", b.templateId),
			).toEqual([b.skillId]);
		});

		it("does not require another organization's skill on the organization's template", async () => {
			const result = await runResult((service) =>
				service.setTemplateSkillRequirements({
					organizationId: a.organizationId,
					targetId: a.templateId,
					requirements: [{ skillId: b.skillId, isRequired: true }],
					createdBy: a.creator.userId,
				}),
			);

			expect(result).toMatchObject(notFound("skill", b.skillId));
		});

		it("does not read another organization's requirements", async () => {
			expect(
				await runResult((service) =>
					service.getSubareaSkillRequirements(a.organizationId, b.subareaId),
				),
			).toMatchObject(notFound("locationSubarea", b.subareaId));
			expect(
				await runResult((service) =>
					service.getTemplateSkillRequirements(a.organizationId, b.templateId),
				),
			).toMatchObject(notFound("shiftTemplate", b.templateId));
		});
	});

	describe("validation", () => {
		it("does not validate another organization's employee or subarea", async () => {
			expect(
				await runResult((service) =>
					service.validateEmployeeForShift(a.organizationId, b.employeeId, {
						subareaId: b.subareaId,
						templateId: b.templateId,
					}),
				),
			).toMatchObject(notFound("employee", b.employeeId));
			expect(
				await runResult((service) =>
					service.validateEmployeeForShift(a.organizationId, a.employeeId, {
						subareaId: b.subareaId,
					}),
				),
			).toMatchObject(notFound("locationSubarea", b.subareaId));
			expect(
				await runResult((service) =>
					service.validateEmployeeForShift(a.organizationId, a.employeeId, {
						subareaId: a.subareaId,
						templateId: b.templateId,
					}),
				),
			).toMatchObject(notFound("shiftTemplate", b.templateId));
			expect(
				await runResult((service) =>
					service.validateEmployeeForSubarea(a.organizationId, a.employeeId, b.subareaId),
				),
			).toMatchObject(notFound("locationSubarea", b.subareaId));
		});

		it("validates the organization's own employee for its own subarea", async () => {
			const result = await run((service) =>
				service.validateEmployeeForShift(b.organizationId, b.employeeId, {
					subareaId: b.subareaId,
					templateId: b.templateId,
				}),
			);

			expect(result).toEqual({ isQualified: true, missingSkills: [], expiredSkills: [] });
		});
	});
});
