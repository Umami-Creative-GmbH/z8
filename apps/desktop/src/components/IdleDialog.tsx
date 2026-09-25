import { IconCoffee, IconBriefcase } from "@tabler/icons-react";
import { formatIdleDuration, cn } from "../lib/utils";
import type { BreakReview, IdleEvent } from "../types";

interface IdleDialogProps {
  isOpen: boolean;
  idleEvent: IdleEvent | null;
  onBreak: () => void;
  onResume: () => void;
  isLoading?: boolean;
}

const timeFormatter = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

const REVIEW_REASON: Record<BreakReview, string> = {
  clockDiscontinuity: "The device clock changed while you were away.",
  startZoneUnavailable: "The device time zone could not be read while you were away.",
  returnZoneUnavailable: "The device time zone could not be read when you returned.",
};

export function IdleDialog({
  isOpen,
  idleEvent,
  onBreak,
  onResume,
  isLoading,
}: IdleDialogProps) {
  if (!isOpen || !idleEvent) return null;

  const idleDuration = formatIdleDuration(idleEvent.idleDurationMs);
  // The proposed break ends when you came back, not when you answer.
  const from = timeFormatter.format(new Date(idleEvent.idleStartTime));
  const until = timeFormatter.format(new Date(idleEvent.returnedAt));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" />

      {/* Dialog */}
      <div className="relative bg-background rounded-lg shadow-xl p-5 mx-4 max-w-sm w-full border border-border">
        <div className="text-center">
          <h2 className="text-lg font-semibold mb-2">You were away</h2>
          <p className="text-sm text-muted-foreground mb-4">
            You were idle for <span className="font-medium">{idleDuration}</span>, from {from} until {until}.
            <br />
            What were you doing?
          </p>

          {idleEvent.review && (
            <p className="text-sm mb-4" role="alert">
              {REVIEW_REASON[idleEvent.review]} This break cannot be recorded automatically. If it was a
              break, enter it as a time correction in Z8.
            </p>
          )}

          <div className="flex flex-col gap-3">
            {/* Break button */}
            {!idleEvent.review && (
              <button
                type="button"
                onClick={onBreak}
                disabled={isLoading}
                className={cn(
                  "flex items-center justify-center gap-2 w-full py-3 px-4",
                  "bg-amber-500 hover:bg-amber-600 text-white rounded-lg",
                  "transition-colors font-medium",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                <IconCoffee className="w-5 h-5" />
                I was on break
              </button>
            )}

            {/* Working button */}
            <button
              type="button"
              onClick={onResume}
              disabled={isLoading}
              className={cn(
                "flex items-center justify-center gap-2 w-full py-3 px-4",
                "bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg",
                "transition-colors font-medium",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              <IconBriefcase className="w-5 h-5" />
              {idleEvent.review ? "Continue" : "I was still working"}
            </button>
          </div>

          {!idleEvent.review && (
            <p className="text-xs text-muted-foreground mt-4">
              {isLoading
                ? "Processing..."
                : `Selecting 'break' records a break from ${from} to ${until}; work resumes at ${until}.`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
