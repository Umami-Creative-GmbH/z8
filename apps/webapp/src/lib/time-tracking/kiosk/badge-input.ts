import type { KioskBadgeInput } from "./protocol";

/** A kiosk's two badge input switches (#1366 scanner, #1367 camera), each off by default. */
export type KioskBadgeInputSwitches = {
	badgeScannerEnabled?: boolean | null;
	badgeCameraEnabled?: boolean | null;
};

/**
 * Whether a kiosk accepts a badge read by `input` (#1367): only while that
 * input's own switch is on. The other switch never stands in for it, so an
 * admin who turns one input off turns off exactly that one. A badge body
 * without an input means the attached scanner (#1366); the request schema
 * (`clock-service.ts`) settles that once. Client-safe: the kiosk uses it to
 * show its inputs, the server to enforce them.
 */
export function kioskAcceptsBadgeInput(
	switches: KioskBadgeInputSwitches,
	input: KioskBadgeInput,
): boolean {
	return input === "camera"
		? switches.badgeCameraEnabled === true
		: switches.badgeScannerEnabled === true;
}
