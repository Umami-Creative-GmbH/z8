import { Play, Square, Loader2 } from "lucide-react";
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

export function ClockButton({
  isClockedIn,
  startTime,
  onClockIn,
  onClockOut,
  isLoading,
  disabled,
}: ClockButtonProps) {
  const elapsedSeconds = useElapsedTimer(startTime);

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
      <div className="clock-display">
        {isClockedIn ? (
          <>
            <div className="clock-timer">{formatDuration(elapsedSeconds)}</div>
            <div className="clock-label">Time elapsed</div>
          </>
        ) : (
          <>
            <div className="clock-ready">Ready to work</div>
            <div className="clock-label">Press the button to start tracking</div>
          </>
        )}
      </div>

      {/* Main clock button */}
      <button
        onClick={handleClick}
        disabled={isLoading || disabled}
        className={`clock-button ${isClockedIn ? "clock-button-stop" : "clock-button-start"} ${isLoading || disabled ? "clock-button-disabled" : ""}`}
      >
        <div className="clock-button-inner">
          {isLoading ? (
            <Loader2 size={48} color="white" className="clock-spinner" />
          ) : isClockedIn ? (
            <Square size={48} color="white" fill="white" />
          ) : (
            <Play size={48} color="white" fill="white" style={{ marginLeft: "6px" }} />
          )}
        </div>
      </button>

      {/* Action label */}
      <div className={`clock-action-label ${isClockedIn ? "clock-action-stop" : "clock-action-start"}`}>
        {isLoading
          ? "Processing..."
          : isClockedIn
          ? "Tap to Clock Out"
          : "Tap to Clock In"}
      </div>
    </div>
  );
}
