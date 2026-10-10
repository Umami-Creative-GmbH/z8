import {
	IconPlayerPlay,
	IconSquare,
	IconLoader2,
	IconCoffee,
} from "@tabler/icons-react";
import { useElapsedTimer } from "../hooks/useElapsedTimer";
import { clockPresentation } from "../lib/clock-presentation";
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
	const blocked = isLoading || !!disabled;
	const { mode, action, title, subtitle, secondary } = clockPresentation(
		isClockedIn,
		isOnBreak,
		!!disabled,
		elapsed,
	);
	return (
		<div className="clock-container">
			<div className="clock-display">
				<div className={isClockedIn ? "clock-timer" : "clock-ready"}>
					{t(title)}
				</div>
				{(isClockedIn || disabled) && (
					<div className="clock-label">{t(subtitle)}</div>
				)}
			</div>
			<div className="clock-actions">
				<button
					type="button"
					aria-label={t(action)}
					onClick={isClockedIn ? onClockOut : onClockIn}
					disabled={blocked}
					className={`clock-button ${isClockedIn ? "clock-button-stop" : "clock-button-start"} ${blocked ? "clock-button-disabled" : ""}`}
				>
					<span className="clock-button-inner">
						<ClockGlyph loading={isLoading} working={isClockedIn} />
					</span>
					<span>{t(isLoading ? "Processing…" : action)}</span>
				</button>
				{secondary && (
					<button
						type="button"
						className="secondary-action"
						disabled={blocked}
						onClick={mode === "working" ? onStartBreak : onEndDay}
					>
						{mode === "working" && <IconCoffee size={18} aria-hidden="true" />}
						{t(secondary)}
					</button>
				)}
			</div>
		</div>
	);
}

function ClockGlyph({
	loading,
	working,
}: {
	loading: boolean;
	working: boolean;
}) {
	if (loading)
		return (
			<IconLoader2 size={20} className="clock-spinner" aria-hidden="true" />
		);
	if (working) return <IconSquare size={20} aria-hidden="true" />;
	return <IconPlayerPlay size={20} aria-hidden="true" />;
}
