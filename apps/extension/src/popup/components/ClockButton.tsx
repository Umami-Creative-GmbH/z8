import { LogIn, LogOut, Loader2 } from "lucide-react";
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
        "w-full py-3 px-4 rounded-lg font-semibold text-white transition-all",
        "flex items-center justify-center gap-2",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        isClockedIn
          ? "bg-red-500 hover:bg-red-600 active:bg-red-700"
          : "bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700"
      )}
    >
      {isLoading ? (
        <>
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          <span>{isClockedIn ? "Clocking Out…" : "Clocking In…"}</span>
        </>
      ) : (
        <>
          {isClockedIn ? (
            <LogOut className="w-5 h-5" aria-hidden="true" />
          ) : (
            <LogIn className="w-5 h-5" aria-hidden="true" />
          )}
          <span>{isClockedIn ? "Clock Out" : "Clock In"}</span>
        </>
      )}
    </button>
  );
}
