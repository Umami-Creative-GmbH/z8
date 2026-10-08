import { formatDuration } from "./utils";
export function clockPresentation(
	isClockedIn: boolean,
	isOnBreak: boolean,
	disabled: boolean,
	elapsed: number,
) {
	const mode = isClockedIn ? "working" : isOnBreak ? "break" : "ready";
	const action = {
		working: "Clock out",
		break: "Resume work",
		ready: "Clock in",
	}[mode];
	return {
		mode,
		action,
		title: isClockedIn
			? formatDuration(elapsed)
			: isOnBreak
				? "On break"
				: disabled
					? "Clock actions paused"
					: "Ready to work",
		subtitle: isClockedIn
			? "Time elapsed"
			: disabled
				? "Check status and saved actions"
				: action,
		secondary: { working: "Start break", break: "End day", ready: null }[mode],
	};
}
