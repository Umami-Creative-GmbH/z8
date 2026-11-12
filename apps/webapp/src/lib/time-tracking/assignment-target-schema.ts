import { z } from "zod";
import { isUuid } from "@/lib/validations/uuid";

/**
 * Whom a scoped feature assignment applies to (position capture, vehicle use):
 * the whole organization, one team or one employee. The settings actions of
 * both features validate their `target` with this one schema (#1618).
 */
export const assignmentTargetSchema = z.discriminatedUnion(
	"type",
	[
		z.strictObject({ type: z.literal("organization") }),
		z.strictObject({
			type: z.literal("team"),
			teamId: z.string().refine(isUuid, "Invalid selection: teamId."),
		}),
		z.strictObject({
			type: z.literal("employee"),
			employeeId: z.string().refine(isUuid, "Invalid selection: employeeId."),
		}),
	],
	"Choose who the assignment applies to.",
);

export type AssignmentTarget = z.output<typeof assignmentTargetSchema>;

/** An assignment's ID, as the remove actions take it. */
export const assignmentIdSchema = z.string().refine(isUuid, "Invalid selection: assignmentId.");
