import type {
	ActionMessage,
	RefusalOverrides,
} from "@/lib/organization-action/action-error-message";
import type { KioskFobManagementErrorCode } from "@/lib/time-tracking/kiosk/fob-errors";
import type { KioskFobViewState } from "@/lib/time-tracking/kiosk/fob-management";
import { kioskDateLabel } from "./kiosk-date-labels";

type Translate = (key: string, defaultValue: string, values?: Record<string, string>) => string;

/** An active fob as people see it (#1508): the last four characters, when and where it was registered. */
export function kioskFobDetails(
	t: Translate,
	fob: KioskFobViewState,
	zone: string,
	locale: string,
): string {
	const values = {
		lastFour: fob.lastFour,
		date: kioskDateLabel(fob.registeredAt, zone, locale),
	};
	return fob.kioskName
		? t("settings.kioskFob.details", "Fob ending in {lastFour}, registered on {date} at {kiosk}.", {
				...values,
				kiosk: fob.kioskName,
			})
		: t(
				"settings.kioskFob.detailsKioskGone",
				"Fob ending in {lastFour}, registered on {date} at a kiosk that no longer exists.",
				values,
			);
}

const SIGN_IN: ActionMessage = ["settings.kioskFob.errors.signInRequired", "Sign in to continue."];
const NOT_ALLOWED: ActionMessage = [
	"settings.kioskFob.errors.notAllowed",
	"You are not allowed to do this.",
];
const EMPLOYEE_NOT_FOUND: ActionMessage = [
	"settings.kioskFob.errors.employeeNotFound",
	"This employee was not found.",
];

/**
 * The kiosk fob texts (#1508) for `actionErrorMessage`: a refused removal, or
 * the employee's own fob status that could not be read, and the module's
 * sign-in, access and not-found failures worded for fobs.
 */
export const KIOSK_FOB_REFUSALS = {
	sign_in_required: SIGN_IN,
	not_allowed: NOT_ALLOWED,
	employee_not_found: EMPLOYEE_NOT_FOUND,
	no_fob: ["settings.kioskFob.errors.noFob", "There is no kiosk fob to remove."],
	fob_changed: [
		"settings.kioskFob.errors.fobChanged",
		"This kiosk fob changed in the meantime. Check its status and try again.",
	],
	AuthenticationError: SIGN_IN,
	AuthorizationError: NOT_ALLOWED,
	NotFoundError: EMPLOYEE_NOT_FOUND,
} satisfies RefusalOverrides & Partial<Record<KioskFobManagementErrorCode, ActionMessage>>;

/** Any other failed kiosk fob action. */
export const KIOSK_FOB_FAILED: ActionMessage = [
	"settings.kioskFob.errors.failed",
	"Something went wrong. Please try again.",
];
