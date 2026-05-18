import { IconLogin2, IconLogout2, IconLoader2 } from "@tabler/icons-react";
import { cn } from "@/lib/cn";

interface ClockButtonProps {
  isClockedIn: boolean;
  onClockIn: () => void;
  onClockOut: () => void;
  isLoading: boolean;
  disabled?: boolean;
}

export function ClockButton({
  isClockedIn,
  onClockIn,
  onClockOut,
  isLoading,
  disabled,
}: ClockButtonProps) {
  const handleClick = () => {
    if (isLoading || disabled) return;
    if (isClockedIn) {
      onClockOut();
    } else {
      onClockIn();
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={isLoading || disabled}
      className={cn(
        "w-full py-3 px-4 rounded-lg font-semibold text-white transition-colors",
        "flex items-center justify-center gap-2",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        isClockedIn
          ? "bg-red-500 hover:bg-red-600 active:bg-red-700"
          : "bg-blue-600 hover:bg-blue-700 active:bg-blue-800"
      )}
    >
      {isLoading ? (
        <>
          <IconLoader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          <span>{isClockedIn ? "Clocking Out…" : "Clocking In…"}</span>
        </>
      ) : (
        <>
          {isClockedIn ? (
            <IconLogout2 className="w-5 h-5" aria-hidden="true" />
          ) : (
            <IconLogin2 className="w-5 h-5" aria-hidden="true" />
          )}
          <span>{isClockedIn ? "Clock Out" : "Clock In"}</span>
        </>
      )}
    </button>
  );
}
