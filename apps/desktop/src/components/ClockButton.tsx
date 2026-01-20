import { Play, Square, Loader2 } from "lucide-react";
import { useElapsedTimer } from "../hooks/useElapsedTimer";
import { formatDuration, cn } from "../lib/utils";

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
    <div className="flex flex-col items-center gap-3">
      {/* Timer display */}
      <div className="text-center">
        {isClockedIn ? (
          <>
            <div className="text-3xl font-mono font-bold text-foreground">
              {formatDuration(elapsedSeconds)}
            </div>
            <div className="text-sm text-muted-foreground">Working time</div>
          </>
        ) : (
          <>
            <div className="text-2xl font-semibold text-muted-foreground">
              Ready to start
            </div>
            <div className="text-sm text-muted-foreground">
              Click to clock in
            </div>
          </>
        )}
      </div>

      {/* Main clock button */}
      <button
        onClick={handleClick}
        disabled={isLoading || disabled}
        className={cn(
          "relative w-24 h-24 rounded-full transition-all duration-200",
          "flex items-center justify-center",
          "shadow-lg hover:shadow-xl",
          "focus:outline-none focus:ring-4 focus:ring-offset-2",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          isClockedIn
            ? "bg-destructive hover:bg-destructive/90 focus:ring-destructive/50"
            : "bg-success hover:bg-success/90 focus:ring-success/50"
        )}
      >
        {isLoading ? (
          <Loader2 className="w-10 h-10 text-white animate-spin" />
        ) : isClockedIn ? (
          <Square className="w-10 h-10 text-white" fill="currentColor" />
        ) : (
          <Play className="w-10 h-10 text-white ml-1" fill="currentColor" />
        )}
      </button>

      {/* Status text */}
      <div className="text-sm font-medium">
        {isLoading ? (
          <span className="text-muted-foreground">Processing...</span>
        ) : isClockedIn ? (
          <span className="text-destructive">Click to clock out</span>
        ) : (
          <span className="text-success">Click to clock in</span>
        )}
      </div>
    </div>
  );
}
