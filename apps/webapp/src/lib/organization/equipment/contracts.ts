import { z } from "zod";

const request = { requestId: z.uuid() };
const revision = { expectedRevision: z.number().int().nonnegative() };
const typeFields = {
	name: z.string().trim().min(1).max(100),
	trackingMode: z.enum(["individual", "quantity"]),
	defaultReturnRequired: z.boolean(),
};
export const equipmentSetupChangeSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		kind: z.literal("configure_policy"),
		...request,
		...revision,
		retentionMonths: z.number().int().positive().max(2147483647),
	}),
	z.strictObject({ kind: z.literal("create_type"), ...request, ...typeFields }),
	z.strictObject({
		kind: z.literal("update_type"),
		...request,
		...revision,
		id: z.uuid(),
		...typeFields,
	}),
	z.strictObject({
		kind: z.literal("archive_type"),
		...request,
		...revision,
		id: z.uuid(),
	}),
	z.strictObject({
		kind: z.literal("register_item"),
		...request,
		typeId: z.uuid(),
		identifier: z.string().trim().min(1).max(100),
		serialNumber: z.string().trim().max(200).optional(),
	}),
	z.strictObject({
		kind: z.literal("archive_item"),
		...request,
		...revision,
		id: z.uuid(),
	}),
]);
export type EquipmentSetupChange = z.infer<typeof equipmentSetupChangeSchema>;
export const equipmentSetupDetailSchema = z.strictObject({
	kind: z.enum(["type", "item"]),
	id: z.uuid(),
});
export type EquipmentSetupDetailInput = z.infer<
	typeof equipmentSetupDetailSchema
>;
export type EquipmentSetupDetail =
	| { kind: "type"; record: EquipmentTypeView }
	| { kind: "item"; record: EquipmentItemView };
export type EquipmentSetupRefusal =
	| "invalid_input"
	| "not_found"
	| "policy_required"
	| "archived"
	| "tracking_mode_fixed"
	| "individual_required"
	| "identifier_taken"
	| "stale_revision"
	| "request_conflict";
export type EquipmentSetupOutcome =
	| { ok: true; id: string; revision: number }
	| { ok: false; reason: EquipmentSetupRefusal };
export interface EquipmentTypeView {
	id: string;
	name: string;
	trackingMode: "individual" | "quantity";
	defaultReturnRequired: boolean;
	used: boolean;
	archived: boolean;
	revision: number;
}
export interface EquipmentItemView {
	id: string;
	typeId: string;
	identifier: string;
	serialNumber: string | null;
	status: "available" | "unavailable" | "retired";
	archived: boolean;
	revision: number;
}
export interface EquipmentSetupView {
	policy: { retentionMonths: number; revision: number } | null;
	types: EquipmentTypeView[];
	/** Only these types can be selected for registration or future issuance. */
	selectableTypes: EquipmentTypeView[];
	items: EquipmentItemView[];
}
