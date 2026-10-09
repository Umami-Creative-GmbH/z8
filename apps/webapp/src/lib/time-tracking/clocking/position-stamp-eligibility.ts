import { CLOCK_COMMAND_VERSION } from "../clock-command";
import type { ClockCommand, ClockPosition } from "./types";

/**
 * The position a clock command may be stamped with, or null (#826). Only the
 * employee's own clock-in, clock-out and break through the web app carry one: a
 * web server action, or a stamped version 3 frozen command, which the commands
 * route admits only from a cookie-authenticated browser. On-behalf, departure
 * and automatic clock-outs, legacy route commands, the native mobile app, bots
 * and the desktop never do, whatever they send.
 */
export function stampablePosition(command: ClockCommand): ClockPosition | null {
	const { position } = command;
	if (!position) return null;
	if (command.principal.kind !== "user" || command.subject.onBehalf || command.legacy) {
		return null;
	}
	if (command.channel === "web") return position;
	if (command.channel === "api" && command.payload?.version === CLOCK_COMMAND_VERSION) {
		return position;
	}
	return null;
}
