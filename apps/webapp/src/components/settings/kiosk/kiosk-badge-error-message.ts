import type {
	ActionMessage,
	RefusalOverrides,
} from "@/lib/organization-action/action-error-message";
import type { KioskBadgeErrorCode } from "@/lib/time-tracking/kiosk/badge-errors";

const SIGN_IN: ActionMessage = [
	"settings.kioskBadge.errors.signInRequired",
	"Sign in to continue.",
];
const NOT_ALLOWED: ActionMessage = [
	"settings.kioskBadge.errors.notAllowed",
	"You are not allowed to do this.",
];
const EMPLOYEE_NOT_FOUND: ActionMessage = [
	"settings.kioskBadge.errors.employeeNotFound",
	"This employee was not found.",
];

/**
 * The kiosk badge texts (#1364) for `actionErrorMessage`: the store's refusals,
 * and the module's sign-in, access and not-found failures worded for badges.
 */
export const KIOSK_BADGE_REFUSALS = {
	sign_in_required: SIGN_IN,
	not_allowed: NOT_ALLOWED,
	employee_not_found: EMPLOYEE_NOT_FOUND,
	employee_inactive: [
		"settings.kioskBadge.errors.employeeInactive",
		"Only active employees can receive a kiosk badge.",
	],
	badge_exists: [
		"settings.kioskBadge.errors.badgeExists",
		"This employee already has a kiosk badge. Replace it instead.",
	],
	no_badge: ["settings.kioskBadge.errors.noBadge", "This employee has no kiosk badge."],
	badge_changed: [
		"settings.kioskBadge.errors.badgeChanged",
		"Someone else changed this kiosk badge in the meantime. Check its status and try again.",
	],
	AuthenticationError: SIGN_IN,
	AuthorizationError: NOT_ALLOWED,
	NotFoundError: EMPLOYEE_NOT_FOUND,
} satisfies RefusalOverrides & Partial<Record<KioskBadgeErrorCode, ActionMessage>>;

/** Any other failed kiosk badge action. */
export const KIOSK_BADGE_FAILED: ActionMessage = [
	"settings.kioskBadge.errors.failed",
	"Something went wrong. Please try again.",
];
