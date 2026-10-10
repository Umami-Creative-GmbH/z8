/**
 * Why a kiosk management action was refused (#859). The client translates the
 * code; the English message is a diagnostic for logs only. Shared by the server
 * actions and the client, so this file has no server-only imports.
 */
export type KioskSettingsErrorCode =
	| "admin_only"
	| "invalid_name"
	| "invalid_timezone"
	| "invalid_selection"
	| "location_not_found"
	| "kiosk_not_found"
	| "kiosk_revoked"
	/** Anything unexpected: the action failed for a reason the user cannot act on. */
	| "failed";

/** A refusal the user can act on; thrown by the kiosk store and actions. */
export class KioskSettingsRefusal extends Error {
	readonly code: KioskSettingsErrorCode;

	constructor(code: KioskSettingsErrorCode, message: string) {
		super(message);
		this.name = "KioskSettingsRefusal";
		this.code = code;
	}
}

/** A kiosk server action's result; a failure always carries a stable code. */
export type KioskSettingsActionResult<T> =
	| { success: true; data: T }
	| { success: false; error: string; code: KioskSettingsErrorCode };
