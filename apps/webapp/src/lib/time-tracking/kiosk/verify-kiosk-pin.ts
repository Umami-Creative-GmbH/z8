import "server-only";

import { db } from "@/db";
import { type KioskPinVerification, verifyEmployeeKioskPin } from "./pin-store";

export type { KioskPinVerification } from "./pin-store";

/**
 * Verifies the PIN an employee entered at a kiosk (#857), for the kiosk
 * principal (#860). Records failures and enforces the per-employee lockout in
 * the database: 5 consecutive failures across all kiosks lock the employee for
 * 15 minutes. Answers only `verified`, `wrong_pin`, `locked` (with `until`) or
 * `no_pin`; an employee outside the organization reads as `no_pin`. The
 * per-kiosk attempt limit is the caller's.
 */
export function verifyKioskPin(
	organizationId: string,
	employeeId: string,
	pin: string,
): Promise<KioskPinVerification> {
	return verifyEmployeeKioskPin(db, { organizationId, employeeId, pin });
}
