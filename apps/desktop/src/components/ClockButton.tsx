import { IconPlayerPlay, IconSquare, IconLoader2 } from "@tabler/icons-react";
import { useElapsedTimer } from "../hooks/useElapsedTimer";
import { formatDuration } from "../lib/utils";

interface ClockButtonProps {
  isClockedIn: boolean;
  startTime: string | null;
  onClockIn: () => Promise<void>;
  onClockOut: () => Promise<void>;
  isLoading: boolean;
  disabled?: boolean;
}

function ClockDisplay({ isClockedIn, disabled, startTime }: Pick<ClockButtonProps, "isClockedIn" | "disabled" | "startTime">) {
  const elapsedSeconds = useElapsedTimer(startTime);
  if (isClockedIn) {
    return (
      <div className="clock-display">
        <div className="clock-timer">{formatDuration(elapsedSeconds)}</div>
        <div className="clock-label">Time elapsed</div>
      </div>
    );
  }
  return (
    <div className="clock-display">
      <div className="clock-ready">{disabled ? "Clock actions paused" : "Ready to work"}</div>
      <div className="clock-label">{disabled ? "Check clock status and recovery details" : "Press the button to start tracking"}</div>
    </div>
  );
}

export function ClockButton({
  isClockedIn,
  startTime,
  onClockIn,
  onClockOut,
  isLoading,
  disabled,
}: ClockButtonProps) {
  const handleClick = async () => {
    if (isClockedIn) {
      await onClockOut();
    } else {
      await onClockIn();
    }
  };

  return (
    <div className="clock-container">
      {/* Timer display */}
      <ClockDisplay isClockedIn={isClockedIn} disabled={disabled} startTime={startTime} />

      {/* Main clock button */}
      <button
        type="button"
        aria-label={isClockedIn ? "Clock out" : "Clock in"}
        onClick={handleClick}
        disabled={isLoading || disabled}
        className={`clock-button ${isClockedIn ? "clock-button-stop" : "clock-button-start"} ${isLoading || disabled ? "clock-button-disabled" : ""}`}
      >
        <div className="clock-button-inner">
          {isLoading ? (
            <IconLoader2 size={48} color="white" className="clock-spinner" />
          ) : isClockedIn ? (
            <IconSquare size={48} color="white" fill="white" />
          ) : (
            <IconPlayerPlay size={48} color="white" fill="white" style={{ marginLeft: "6px" }} />
          )}
        </div>
      </button>

      {/* Action label */}
      <div className={`clock-action-label ${isClockedIn ? "clock-action-stop" : "clock-action-start"}`}>
        {isLoading
          ? "Processing…"
          : disabled
          ? "Clock actions paused"
          : isClockedIn
          ? "Tap to Clock Out"
          : "Tap to Clock In"}
      </div>
    </div>
  );
}
