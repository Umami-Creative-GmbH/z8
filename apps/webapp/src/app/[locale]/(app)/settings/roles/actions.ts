"use server";

import { Effect } from "effect";
import { z } from "zod";
import { CustomRoleService } from "@/lib/effect/services/custom-role.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";

const baseTierSchema = z.enum(["admin", "manager", "employee"]);
const roleIdSchema = z.string().min(1, "Role is required");
const employeeIdSchema = z.string().min(1, "Employee is required");

const createCustomRoleSchema = z.strictObject({
	name: z.string(),
	description: z.string().optional(),
	color: z.string().optional(),
	baseTier: baseTierSchema,
});

const updateCustomRoleSchema = z.strictObject({
	roleId: roleIdSchema,
	input: z.strictObject({
		name: z.string().optional(),
		description: z.string().optional(),
		color: z.string().optional(),
		baseTier: baseTierSchema.optional(),
	}),
});

const roleAssignmentSchema = z.strictObject({
	employeeId: employeeIdSchema,
	roleId: roleIdSchema,
});

// =============================================================================
// CRUD Actions
// =============================================================================

export const listCustomRoles = organizationAction(
	{ name: "customRoles.list", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const customRoleService = yield* CustomRoleService;
			return yield* customRoleService.listRoles(organizationId);
		}),
);

export const getCustomRole = organizationAction(
	{
		name: "customRoles.get",
		requires: "orgAdmin",
		schema: z.strictObject({ roleId: roleIdSchema }),
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const customRoleService = yield* CustomRoleService;
			return yield* customRoleService.getRole(input.roleId, organizationId);
		}),
);

export const createCustomRole = organizationAction(
	{ name: "customRoles.create", requires: "orgAdmin", schema: createCustomRoleSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const customRoleService = yield* CustomRoleService;
			const id = yield* customRoleService.createRole(organizationId, input, actor.userId);
			return { id };
		}),
);

export const updateCustomRole = organizationAction(
	{ name: "customRoles.update", requires: "orgAdmin", schema: updateCustomRoleSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const customRoleService = yield* CustomRoleService;
			yield* customRoleService.updateRole(input.roleId, organizationId, input.input, actor.userId);
		}),
);

export const deleteCustomRole = organizationAction(
	{
		name: "customRoles.delete",
		requires: "orgAdmin",
		schema: z.strictObject({ roleId: roleIdSchema }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const customRoleService = yield* CustomRoleService;
			yield* customRoleService.deleteRole(input.roleId, organizationId, actor.userId);
		}),
);

export const setRolePermissions = organizationAction(
	{
		name: "customRoles.setPermissions",
		requires: "orgAdmin",
		schema: z.strictObject({
			roleId: roleIdSchema,
			permissions: z.array(z.strictObject({ action: z.string(), subject: z.string() })),
		}),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const customRoleService = yield* CustomRoleService;
			yield* customRoleService.setPermissions(
				input.roleId,
				organizationId,
				input.permissions,
				actor.userId,
			);
		}),
);

export const assignRoleToEmployee = organizationAction(
	{
		name: "customRoles.assign",
		requires: "orgAdmin",
		schema: roleAssignmentSchema,
		addsEmployees: (input) => [input.employeeId],
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const customRoleService = yield* CustomRoleService;
			yield* customRoleService.assignRole(
				input.employeeId,
				input.roleId,
				organizationId,
				actor.userId,
			);
		}),
);

export const unassignRoleFromEmployee = organizationAction(
	{ name: "customRoles.unassign", requires: "orgAdmin", schema: roleAssignmentSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const customRoleService = yield* CustomRoleService;
			yield* customRoleService.unassignRole(
				input.employeeId,
				input.roleId,
				organizationId,
				actor.userId,
			);
		}),
);

export const getEmployeeCustomRoles = organizationAction(
	{
		name: "customRoles.getEmployeeRoles",
		requires: "orgAdmin",
		schema: z.strictObject({ employeeId: employeeIdSchema }),
	},
	({ organizationId, input }) =>
		Effect.gen(function* () {
			const customRoleService = yield* CustomRoleService;
			return yield* customRoleService.getEmployeeRoles(input.employeeId, organizationId);
		}),
);
