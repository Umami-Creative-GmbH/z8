import type { ClockCommand } from "./types";

/**
 * Whether a clock command may record the vehicle use it carries (#1122): only
 * the employee's own clocking, by the signed-in user (web, PWA, store app,
 * desktop, bots) or at a kiosk with their PIN. On-behalf, departure and
 * automatic clock-outs never do, whatever they carry, so they leave the end
 * reading empty. Unlike a position, vehicle use is not limited to the browser:
 * bearer clients such as the desktop record it too.
 */
export function acceptsClockVehicleUse(
	command: Pick<ClockCommand, "principal" | "subject">,
): boolean {
	const { kind } = command.principal;
	return (kind === "user" || kind === "kiosk") && !command.subject.onBehalf;
}
