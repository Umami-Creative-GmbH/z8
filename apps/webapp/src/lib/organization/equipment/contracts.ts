import { z } from "zod";
import { parsePlainDate } from "@/lib/datetime/temporal-core";

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
	inCustody: boolean;
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

const calendarDate = z.string().refine((value) => {
	try {
		parsePlainDate(value);
		return true;
	} catch {
		return false;
	}
}, "Enter a valid calendar date.");
export const equipmentConditionSchema = z.enum([
	"good",
	"worn",
	"damaged",
	"unknown",
]);
export type EquipmentCondition = z.infer<typeof equipmentConditionSchema>;
const handoverFields = {
	...request,
	...revision,
	actualDate: calendarDate,
	condition: equipmentConditionSchema,
	notes: z.string().trim().max(4000).optional(),
};
export const equipmentChangeSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		kind: z.literal("register_and_issue_individual"),
		...handoverFields,
		expectedRevision: z.literal(0),
		typeId: z.uuid(),
		identifier: z.string().trim().min(1).max(100),
		serialNumber: z.string().trim().max(200).optional(),
		employeeId: z.uuid(),
		returnRequired: z.boolean(),
		explicitDeadline: calendarDate.nullable().optional(),
	}),
	z.strictObject({
		kind: z.literal("issue_individual"),
		...handoverFields,
		itemId: z.uuid(),
		employeeId: z.uuid(),
		returnRequired: z.boolean(),
		explicitDeadline: calendarDate.nullable().optional(),
	}),
	z.strictObject({
		kind: z.literal("receive_individual"),
		...handoverFields,
		assignmentId: z.uuid(),
	}),
]);
export type EquipmentChange = z.infer<typeof equipmentChangeSchema>;
export type EquipmentRefusal =
	| EquipmentSetupRefusal
	| "forbidden"
	| "employee_not_current"
	| "item_unavailable"
	| "self_receipt"
	| "already_received"
	| "future_date"
	| "conflicting_history";
export type EquipmentOutcome =
	| { ok: true; id: string; revision: number }
	| { ok: false; reason: EquipmentRefusal };
export const equipmentFiltersSchema = z.strictObject({
	holderId: z.uuid().optional(),
	typeId: z.uuid().optional(),
	outstanding: z.boolean().optional(),
	overdue: z.boolean().optional(),
	former: z.boolean().optional(),
});
export type EquipmentFilters = z.infer<typeof equipmentFiltersSchema>;
export interface EquipmentHandoverView {
	actualDate: string;
	condition: EquipmentCondition;
	notes: string | null;
	actorId: string | null;
	actorName: string | null;
	recordedAt: string;
}
export interface EquipmentAssignmentView {
	id: string;
	itemId: string;
	typeId: string;
	typeName: string;
	identifier: string;
	employeeId: string;
	holderName: string;
	former: boolean;
	returnRequired: boolean;
	explicitDeadline: string | null;
	outstanding: boolean;
	overdue: boolean;
	held: boolean;
	revision: number;
	canReceive: boolean;
	issue: EquipmentHandoverView;
	receipt: EquipmentHandoverView | null;
}
export interface EquipmentView {
	canManage: boolean;
	canAdminister: boolean;
	registrationTypes: {
		id: string;
		name: string;
		defaultReturnRequired: boolean;
	}[];
	policyConfigured: boolean;
	timezone: string;
	today: string;
	assignments: EquipmentAssignmentView[];
	availableItems: {
		id: string;
		identifier: string;
		typeId: string;
		typeName: string;
		defaultReturnRequired: boolean;
		revision: number;
	}[];
	employees: { id: string; name: string; former: boolean }[];
	types: { id: string; name: string }[];
}

export const equipmentOfficerChangeSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		kind: z.literal("set_officer_grant"),
		...request,
		...revision,
		employeeId: z.uuid(),
		scope: z.enum(["all", "selected"]),
		teamIds: z.array(z.uuid()).max(500),
		employeeIds: z.array(z.uuid()).max(1000),
	}),
	z.strictObject({
		kind: z.literal("revoke_officer_grant"),
		...request,
		...revision,
		employeeId: z.uuid(),
	}),
]);
export type EquipmentOfficerChange = z.infer<
	typeof equipmentOfficerChangeSchema
>;
export interface EquipmentOfficerView {
	grants: {
		employeeId: string;
		name: string;
		scope: "all" | "selected";
		teamIds: string[];
		employeeIds: string[];
		revoked: boolean;
		current: boolean;
		revision: number;
	}[];
	employees: { id: string; name: string; current: boolean }[];
	teams: { id: string; name: string }[];
}
