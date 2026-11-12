import { refusalCodeOf } from "@/lib/effect/refusal-code";

/**
 * Why a kiosk management action was refused (#859). The client translates the
 * code; the English message is a diagnostic for logs only. Shared by the server
 * actions and the client, so this file has no server-only imports.
 */
const KIOSK_SETTINGS_ERROR_CODES = [
	"admin_only",
	"invalid_name",
	"invalid_timezone",
	"invalid_selection",
	"location_not_found",
	"kiosk_not_found",
	"kiosk_revoked",
	/** Offline mode was switched on in a `legacy` organization (#1287, ADR 0002). */
	"offline_needs_adoption",
	/** Anything unexpected: the action failed for a reason the user cannot act on. */
	"failed",
] as const;

export type KioskSettingsErrorCode = (typeof KIOSK_SETTINGS_ERROR_CODES)[number];

function isKioskSettingsErrorCode(value: string): value is KioskSettingsErrorCode {
	return (KIOSK_SETTINGS_ERROR_CODES as readonly string[]).includes(value);
}

/** A refusal the user can act on; thrown by the kiosk store and actions. */
export class KioskSettingsRefusal extends Error {
	readonly code: KioskSettingsErrorCode;

	constructor(code: KioskSettingsErrorCode, message: string) {
		super(message);
		this.name = "KioskSettingsRefusal";
		this.code = code;
	}
}

/**
 * The stable code of a failed kiosk settings action (#1592): the store's
 * refusal, `admin_only` when settings access was refused, else `failed`.
 */
export function kioskSettingsRefusalCode(result: {
	code?: string;
	refusal?: string;
}): KioskSettingsErrorCode {
	return refusalCodeOf(result, isKioskSettingsErrorCode, "admin_only");
}
