import {
	IconPlayerPlay,
	IconSquare,
	IconLoader2,
	IconCoffee,
} from "@tabler/icons-react";
import { useElapsedTimer } from "../hooks/useElapsedTimer";
import { formatDuration } from "../lib/utils";
import { useI18n } from "../lib/i18n";
interface ClockButtonProps {
	isClockedIn: boolean;
	isOnBreak: boolean;
	startTime: string | null;
	onClockIn: () => Promise<void>;
	onClockOut: () => Promise<void>;
	onStartBreak: () => Promise<void>;
	onEndDay: () => Promise<void>;
	isLoading: boolean;
	disabled?: boolean;
}
export function ClockButton({
	isClockedIn,
	isOnBreak,
	startTime,
	onClockIn,
	onClockOut,
	onStartBreak,
	onEndDay,
	isLoading,
	disabled,
}: ClockButtonProps) {
	const { t } = useI18n();
	const elapsed = useElapsedTimer(startTime);
	const action = isClockedIn
		? "Clock out"
		: isOnBreak
			? "Resume work"
			: "Clock in";
	return (
		<div className="clock-container">
			<div className="clock-display">
				<div className={isClockedIn ? "clock-timer" : "clock-ready"}>
					{isClockedIn
						? formatDuration(elapsed)
						: t(
								isOnBreak
									? "On break"
									: disabled
										? "Clock actions paused"
										: "Ready to work",
							)}
				</div>
				<div className="clock-label">
					{t(
						isClockedIn
							? "Time elapsed"
							: disabled
								? "Check status and saved actions"
								: action,
					)}
				</div>
			</div>
			<button
				type="button"
				aria-label={t(action)}
				onClick={isClockedIn ? onClockOut : onClockIn}
				disabled={isLoading || disabled}
				className={`clock-button ${isClockedIn ? "clock-button-stop" : "clock-button-start"} ${isLoading || disabled ? "clock-button-disabled" : ""}`}
			>
				<span className="clock-button-inner">
					{isLoading ? (
						<IconLoader2
							size={48}
							className="clock-spinner"
							aria-hidden="true"
						/>
					) : isClockedIn ? (
						<IconSquare size={48} aria-hidden="true" />
					) : (
						<IconPlayerPlay size={48} aria-hidden="true" />
					)}
				</span>
			</button>
			<div className="clock-action-label">
				{t(isLoading ? "Processing…" : action)}
			</div>
			{isClockedIn && (
				<button
					type="button"
					className="secondary-action"
					disabled={isLoading || disabled}
					onClick={onStartBreak}
				>
					<IconCoffee size={18} aria-hidden="true" />
					{t("Start break")}
				</button>
			)}
			{isOnBreak && !isClockedIn && (
				<button
					type="button"
					className="secondary-action"
					disabled={isLoading || disabled}
					onClick={onEndDay}
				>
					{t("End day")}
				</button>
			)}
		</div>
	);
}
