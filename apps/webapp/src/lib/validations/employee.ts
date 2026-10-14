import { Temporal } from "temporal-polyfill";
import * as z from "zod";
import { normalizePersonnelNumber } from "@/lib/organization/personnel-number";

// Gender enum matching database enum
export const genderSchema = z.enum(["male", "female", "other"]);

export const pronounsSchema = z.preprocess(
	(value) => (typeof value === "string" ? value.trim() : value),
	z
		.string()
		.max(50, "Pronouns must be 50 characters or less")
		.transform((value) => value || null)
		.optional()
		.nullable(),
);

/**
 * A personnel number as saved: trimmed with its case kept, an empty or blank
 * field stored as no number (`null`) — the shared rule in
 * `@/lib/organization/personnel-number` (#881). Not sent means unchanged.
 */
export const personnelNumberSchema = z.preprocess(
	(value) => (typeof value === "string" ? normalizePersonnelNumber(value) : value),
	z.string().max(50, "Personnel number is too long").optional().nullable(),
);

// Employee role enum
export const employeeRoleSchema = z.enum(["employee", "manager", "admin"]);

// Contract type enum
export const contractTypeSchema = z.enum(["fixed", "hourly"]);

// Hourly rate schema (optional positive decimal)
export const hourlyRateSchema = z
	.string()
	.refine(
		(val) => {
			if (!val || val === "") return true; // optional
			const num = parseFloat(val);
			return !Number.isNaN(num) && num > 0;
		},
		{ message: "Hourly rate must be a positive number" },
	)
	.optional()
	.nullable();

const authUserNamePartSchema = z.preprocess(
	(value) => (typeof value === "string" ? value.trim() : value),
	z.string().min(1, "Name is required").max(100, "Name is too long").optional(),
);

const birthdaySchema = z.date().refine((date) => {
	const birthday = Temporal.Instant.from(date.toISOString())
		.toZonedDateTimeISO("UTC")
		.toPlainDate();
	return (
		Temporal.PlainDate.compare(birthday, Temporal.Now.plainDateISO("UTC")) <= 0
	);
}, "Birthday must be in the past");

// Personal information schema (for self-service profile updates)
export const personalInformationSchema = z.object({
	firstName: z
		.string()
		.min(1, "First name is required")
		.max(100, "First name is too long")
		.optional(),
	lastName: z
		.string()
		.min(1, "Last name is required")
		.max(100, "Last name is too long")
		.optional(),
	gender: genderSchema.optional(),
	pronouns: pronounsSchema,
	birthday: birthdaySchema.optional().nullable(),
});

// Full employee creation schema
export const createEmployeeSchema = z.object({
	userId: z.uuid("Invalid user ID"),
	organizationId: z.string().min(1, "Organization ID is required"),
	teamId: z.uuid("Invalid team ID").optional().nullable(),
	role: employeeRoleSchema,
	position: z
		.string()
		.min(1, "Position is required")
		.max(100, "Position is too long")
		.optional()
		.nullable(),

	// Personal information owned by the employee record
	gender: genderSchema.optional().nullable(),
	pronouns: pronounsSchema,
	birthday: birthdaySchema.optional().nullable(),

	// Dates
	startDate: z.date().optional().nullable(),
	endDate: z.date().optional().nullable(),

	// Contract type and hourly rate
	contractType: contractTypeSchema.optional(),
	hourlyRate: hourlyRateSchema,
});

// Employee update schema (more permissive, all fields optional). Contract type
// and wage are not employee fields: they change only through employment terms
// (Organization ADR 0002), so a save never carries them.
const updateEmployeeFieldsSchema = z.object({
	teamId: z.uuid("Invalid team ID").optional().nullable(),
	role: employeeRoleSchema.optional(),
	position: z.string().max(100, "Position is too long").optional().nullable(),
	employeeNumber: personnelNumberSchema,

	// Personal information owned by the employee record
	gender: genderSchema.optional().nullable(),
	pronouns: pronounsSchema,
	birthday: birthdaySchema.optional().nullable(),

	// Dates
	startDate: z.date().optional().nullable(),
	endDate: z.date().optional().nullable(),
	isActive: z.boolean().optional(),

	// Auth user identity fields (admin-only)
	firstName: authUserNamePartSchema,
	lastName: authUserNamePartSchema,
});

export const updateEmployeeSchema = updateEmployeeFieldsSchema.refine(
	(data) => {
		// If both startDate and endDate are provided, endDate must be after startDate
		if (data.startDate && data.endDate) {
			return data.endDate > data.startDate;
		}
		return true;
	},
	{
		message: "End date must be after start date",
		path: ["endDate"],
	},
);

export const updateEmployeeInvitationDraftSchema =
	updateEmployeeFieldsSchema.pick({
		teamId: true,
		role: true,
		position: true,
		employeeNumber: true,
		gender: true,
		pronouns: true,
		birthday: true,
		startDate: true,
		endDate: true,
		firstName: true,
		lastName: true,
	})
	// An invitation draft still carries the contract type and wage that become
	// the employee's first terms.
	.extend({
		contractType: contractTypeSchema.optional(),
		hourlyRate: hourlyRateSchema,
	});

// Manager assignment schema
export const managerAssignmentSchema = z.object({
	managerId: z.uuid("Invalid manager ID"),
	isPrimary: z.boolean(),
});

// Multiple managers assignment schema
export const assignManagersSchema = z
	.object({
		managers: z
			.array(managerAssignmentSchema)
			.min(1, "At least one manager is required"),
	})
	.refine(
		(data) => {
			// Ensure exactly one primary manager
			const primaryCount = data.managers.filter((m) => m.isPrimary).length;
			return primaryCount === 1;
		},
		{
			message: "Exactly one manager must be designated as primary",
			path: ["managers"],
		},
	)
	.refine(
		(data) => {
			// Ensure no duplicate managers
			const managerIds = data.managers.map((m) => m.managerId);
			const uniqueIds = new Set(managerIds);
			return uniqueIds.size === managerIds.length;
		},
		{
			message: "Duplicate managers are not allowed",
			path: ["managers"],
		},
	);

// Types derived from schemas
export type Gender = z.infer<typeof genderSchema>;
export type EmployeeRole = z.infer<typeof employeeRoleSchema>;
export type ContractType = z.infer<typeof contractTypeSchema>;
export type PersonalInformation = z.infer<typeof personalInformationSchema>;
export type CreateEmployee = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployee = z.infer<typeof updateEmployeeSchema>;
export type UpdateEmployeeInvitationDraft = z.infer<
	typeof updateEmployeeInvitationDraftSchema
>;
export type ManagerAssignment = z.infer<typeof managerAssignmentSchema>;
export type AssignManagers = z.infer<typeof assignManagersSchema>;
