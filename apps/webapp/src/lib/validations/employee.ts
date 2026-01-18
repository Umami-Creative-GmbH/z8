import * as z from "zod";

// Gender enum matching database enum
export const genderSchema = z.enum(["male", "female", "other"]);

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
			return !isNaN(num) && num > 0;
		},
		{ message: "Hourly rate must be a positive number" },
	)
	.optional()
	.nullable();

// Rate history entry schema
export const createRateHistorySchema = z.object({
	hourlyRate: z.string().refine(
		(val) => {
			const num = parseFloat(val);
			return !isNaN(num) && num > 0;
		},
		{ message: "Hourly rate must be a positive number" },
	),
	currency: z.string().default("EUR"),
	effectiveFrom: z.date(),
	reason: z.string().max(500, "Reason is too long").optional().nullable(),
});

// Personal information schema (for self-service profile updates)
export const personalInformationSchema = z.object({
	firstName: z
		.string()
		.min(1, "First name is required")
		.max(100, "First name is too long")
		.optional(),
	lastName: z.string().min(1, "Last name is required").max(100, "Last name is too long").optional(),
	gender: genderSchema.optional(),
	birthday: z.date().max(new Date(), "Birthday must be in the past").optional().nullable(),
});

// Full employee creation schema
export const createEmployeeSchema = z.object({
	userId: z.string().uuid("Invalid user ID"),
	organizationId: z.string().min(1, "Organization ID is required"),
	teamId: z.string().uuid("Invalid team ID").optional().nullable(),
	role: employeeRoleSchema,
	position: z
		.string()
		.min(1, "Position is required")
		.max(100, "Position is too long")
		.optional()
		.nullable(),

	// Personal information
	firstName: z
		.string()
		.min(1, "First name is required")
		.max(100, "First name is too long")
		.optional()
		.nullable(),
	lastName: z
		.string()
		.min(1, "Last name is required")
		.max(100, "Last name is too long")
		.optional()
		.nullable(),
	gender: genderSchema.optional().nullable(),
	birthday: z.date().max(new Date(), "Birthday must be in the past").optional().nullable(),

	// Dates
	startDate: z.date().optional().nullable(),
	endDate: z.date().optional().nullable(),

	// Contract type and hourly rate
	contractType: contractTypeSchema.optional(),
	hourlyRate: hourlyRateSchema,
});

// Employee update schema (more permissive, all fields optional)
export const updateEmployeeSchema = z
	.object({
		teamId: z.string().uuid("Invalid team ID").optional().nullable(),
		role: employeeRoleSchema.optional(),
		position: z.string().max(100, "Position is too long").optional().nullable(),
		employeeNumber: z.string().max(50, "Employee number is too long").optional().nullable(),

		// Personal information
		firstName: z
			.string()
			.min(1, "First name is required")
			.max(100, "First name is too long")
			.optional()
			.nullable(),
		lastName: z
			.string()
			.min(1, "Last name is required")
			.max(100, "Last name is too long")
			.optional()
			.nullable(),
		gender: genderSchema.optional().nullable(),
		birthday: z.date().max(new Date(), "Birthday must be in the past").optional().nullable(),

		// Dates
		startDate: z.date().optional().nullable(),
		endDate: z.date().optional().nullable(),
		isActive: z.boolean().optional(),

		// Contract type and hourly rate
		contractType: contractTypeSchema.optional(),
		hourlyRate: hourlyRateSchema,
	})
	.refine(
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

// Manager assignment schema
export const managerAssignmentSchema = z.object({
	managerId: z.string().uuid("Invalid manager ID"),
	isPrimary: z.boolean(),
});

// Multiple managers assignment schema
export const assignManagersSchema = z
	.object({
		managers: z.array(managerAssignmentSchema).min(1, "At least one manager is required"),
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
export type ManagerAssignment = z.infer<typeof managerAssignmentSchema>;
export type AssignManagers = z.infer<typeof assignManagersSchema>;
export type CreateRateHistory = z.infer<typeof createRateHistorySchema>;
