import type { KioskFrozenRefusalReason } from "./frozen-command";

/**
 * What a refused frozen kiosk command's reason means to the people told about it
 * (#1290): the employee or their managers in the notification, owners and admins
 * in the kiosk settings, and the kiosk's own notice. Several reasons read the
 * same to them; the record keeps the exact `KioskFrozenRefusalReason`.
 */
export const KIOSK_REFUSAL_EXPLANATIONS = [
	"wrong_pin",
	"pin_locked",
	"no_pin",
	"pin_unchecked",
	"kiosk_retired",
	"contact_unverifiable",
	"outside_window",
	"clock_untrusted",
	"not_assigned",
	"not_adopted",
	"month_closed",
	"holiday",
	"conflict",
	"other",
] as const;
export type KioskRefusalExplanation = (typeof KIOSK_REFUSAL_EXPLANATIONS)[number];

/** How Z8 answers a refusal (its HTTP status, all final for the kiosk) and how it reads to people. */
export type KioskFrozenRefusalTreatment = {
	status: 400 | 402 | 403 | 409 | 422 | 423;
	explanation: KioskRefusalExplanation;
};

/**
 * Every refusal reason's treatment, in one place: the submit endpoint's status,
 * the notification, the kiosk settings list and the kiosk's notice all read it,
 * so a new reason cannot be left out of any of them. Client-safe.
 */
export const KIOSK_FROZEN_REFUSALS = {
	kiosk_revoked: { status: 403, explanation: "kiosk_retired" },
	kiosk_rotated: { status: 403, explanation: "kiosk_retired" },
	contact_unverifiable: { status: 403, explanation: "contact_unverifiable" },
	not_adopted: { status: 409, explanation: "not_adopted" },
	admission_window: { status: 422, explanation: "outside_window" },
	clock_out_of_bounds: { status: 422, explanation: "clock_untrusted" },
	employee_not_assigned: { status: 403, explanation: "not_assigned" },
	pin_unsealable: { status: 403, explanation: "pin_unchecked" },
	no_pin: { status: 403, explanation: "no_pin" },
	wrong_pin: { status: 403, explanation: "wrong_pin" },
	pin_locked: { status: 423, explanation: "pin_locked" },
	already_clocked_in: { status: 409, explanation: "conflict" },
	occupancy_conflict: { status: 409, explanation: "conflict" },
	not_clocked_in: { status: 409, explanation: "conflict" },
	target_unknown: { status: 409, explanation: "conflict" },
	target_not_active: { status: 409, explanation: "conflict" },
	already_on_break: { status: 409, explanation: "conflict" },
	on_break: { status: 409, explanation: "conflict" },
	no_break_in_progress: { status: 409, explanation: "conflict" },
	invalid_interval: { status: 422, explanation: "conflict" },
	under_review: { status: 409, explanation: "conflict" },
	holiday_blocked: { status: 422, explanation: "holiday" },
	month_closed: { status: 409, explanation: "month_closed" },
	append_review_required: { status: 409, explanation: "conflict" },
	billing_required: { status: 402, explanation: "other" },
	collision: { status: 409, explanation: "conflict" },
	// The kiosk's or the employee's standing changed while the command was judged.
	access_denied: { status: 403, explanation: "not_assigned" },
	invalid_command: { status: 400, explanation: "other" },
} as const satisfies Record<KioskFrozenRefusalReason, KioskFrozenRefusalTreatment>;

export function kioskRefusalExplanation(reason: KioskFrozenRefusalReason): KioskRefusalExplanation {
	return KIOSK_FROZEN_REFUSALS[reason].explanation;
}

export function kioskRefusalStatus(reason: KioskFrozenRefusalReason): number {
	return KIOSK_FROZEN_REFUSALS[reason].status;
}
