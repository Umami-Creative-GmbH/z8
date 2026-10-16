import type { ClockOutCommand } from "./types";

/**
 * Whether someone at this clock-out can pick a task (#884, Projects ADR 0002):
 * the employee's own online web clock-out and a clock-out on behalf. Only such
 * a clock-out is refused with `task_required`. Bots, kiosks, automatic and
 * departure clock-outs, legacy-route commands and frozen commands replayed
 * later have nobody to answer, so they are accepted without a task.
 */
export function clockOutCanPickTask(
	command: Pick<ClockOutCommand, "channel" | "payload" | "legacy">,
): boolean {
	return command.channel === "web" && command.payload === undefined && command.legacy !== true;
}
