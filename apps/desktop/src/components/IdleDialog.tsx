import { Coffee, Briefcase } from "lucide-react";
import { formatIdleDuration, cn } from "../lib/utils";
import type { IdleEvent } from "../types";

interface IdleDialogProps {
  isOpen: boolean;
  idleEvent: IdleEvent | null;
  onBreak: () => void;
  onResume: () => void;
  isLoading?: boolean;
}

export function IdleDialog({
  isOpen,
  idleEvent,
  onBreak,
  onResume,
  isLoading,
}: IdleDialogProps) {
  if (!isOpen || !idleEvent) return null;

  const idleDuration = formatIdleDuration(idleEvent.idleDurationMs);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Dialog */}
      <div className="relative bg-background rounded-lg shadow-xl p-5 mx-4 max-w-sm w-full border border-border">
        <div className="text-center">
          <h2 className="text-lg font-semibold mb-2">You were away</h2>
          <p className="text-sm text-muted-foreground mb-4">
            You were idle for <span className="font-medium">{idleDuration}</span>.
            <br />
            What were you doing?
          </p>

          <div className="flex flex-col gap-3">
            {/* Break button */}
            <button
              onClick={onBreak}
              disabled={isLoading}
              className={cn(
                "flex items-center justify-center gap-2 w-full py-3 px-4",
                "bg-amber-500 hover:bg-amber-600 text-white rounded-lg",
                "transition-colors font-medium",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              <Coffee className="w-5 h-5" />
              I was on break
            </button>

            {/* Working button */}
            <button
              onClick={onResume}
              disabled={isLoading}
              className={cn(
                "flex items-center justify-center gap-2 w-full py-3 px-4",
                "bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg",
                "transition-colors font-medium",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              <Briefcase className="w-5 h-5" />
              I was still working
            </button>
          </div>

          <p className="text-xs text-muted-foreground mt-4">
            {isLoading
              ? "Processing..."
              : "Selecting 'break' will insert a break period for the idle time."}
          </p>
        </div>
      </div>
    </div>
  );
}
