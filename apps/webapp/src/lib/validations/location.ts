import * as z from "zod";

// ============================================
// LOCATION SCHEMAS
// ============================================

// Base location fields
export const locationSchema = z.object({
	name: z
		.string()
		.min(1, "Location name is required")
		.max(100, "Location name must be less than 100 characters"),
	street: z.string().max(200, "Street must be less than 200 characters").optional().nullable(),
	city: z.string().max(100, "City must be less than 100 characters").optional().nullable(),
	postalCode: z
		.string()
		.max(20, "Postal code must be less than 20 characters")
		.optional()
		.nullable(),
	country: z
		.string()
		.length(2, "Country code must be 2 characters (ISO 3166-1 alpha-2)")
		.optional()
		.nullable(),
});

// Create location (includes organizationId)
export const createLocationSchema = locationSchema.extend({
	organizationId: z.string().min(1, "Organization ID is required"),
});

// Update location (all fields optional, plus isActive)
export const updateLocationSchema = locationSchema.partial().extend({
	isActive: z.boolean().optional(),
});

// ============================================
// SUBAREA SCHEMAS
// ============================================

// Base subarea fields
export const subareaSchema = z.object({
	name: z
		.string()
		.min(1, "Subarea name is required")
		.max(100, "Subarea name must be less than 100 characters"),
});

// Create subarea (includes locationId)
export const createSubareaSchema = subareaSchema.extend({
	locationId: z.string().uuid("Invalid location ID"),
});

// Update subarea (all fields optional, plus isActive)
export const updateSubareaSchema = subareaSchema.partial().extend({
	isActive: z.boolean().optional(),
});

// ============================================
// EMPLOYEE ASSIGNMENT SCHEMAS
// ============================================

// Assign employee to location
export const assignLocationEmployeeSchema = z.object({
	locationId: z.string().uuid("Invalid location ID"),
	employeeId: z.string().uuid("Invalid employee ID"),
	isPrimary: z.boolean().default(false),
});

// Assign employee to subarea
export const assignSubareaEmployeeSchema = z.object({
	subareaId: z.string().uuid("Invalid subarea ID"),
	employeeId: z.string().uuid("Invalid employee ID"),
	isPrimary: z.boolean().default(false),
});

// Update assignment (only isPrimary can change)
export const updateAssignmentSchema = z.object({
	isPrimary: z.boolean(),
});

// ============================================
// TYPES
// ============================================

export type LocationFormValues = z.infer<typeof locationSchema>;
export type CreateLocation = z.infer<typeof createLocationSchema>;
export type UpdateLocation = z.infer<typeof updateLocationSchema>;

export type SubareaFormValues = z.infer<typeof subareaSchema>;
export type CreateSubarea = z.infer<typeof createSubareaSchema>;
export type UpdateSubarea = z.infer<typeof updateSubareaSchema>;

export type AssignLocationEmployee = z.infer<typeof assignLocationEmployeeSchema>;
export type AssignSubareaEmployee = z.infer<typeof assignSubareaEmployeeSchema>;
export type UpdateAssignment = z.infer<typeof updateAssignmentSchema>;
