import { IconCloud, IconCloudOff } from "@tabler/icons-react";
import { formatActionTime, formatClockTime } from "@/lib/time";
import type { LastAction } from "@/types";

interface StatusCardProps {
  isClockedIn: boolean;
  isOffline: boolean;
  queueLength: number;
  startTime?: string | null;
  lastAction: LastAction | null;
}

function getLastActionText(lastAction: LastAction | null) {
  if (!lastAction) {
    return "No recent clock activity";
  }

  const actionLabel = lastAction.type === "clock_in" ? "Clocked in" : "Clocked out";
  const syncLabel = lastAction.syncState === "queued" ? "queued" : "synced";

  return `${actionLabel} at ${formatActionTime(lastAction.timestamp)} (${syncLabel})`;
}

export function StatusCard({
  isClockedIn,
  isOffline,
  queueLength,
  startTime,
  lastAction,
}: StatusCardProps) {
  const statusLabel = isClockedIn ? "Working now" : "Ready when you are";
  const sessionDetail =
    isClockedIn && startTime
      ? `Started at ${formatClockTime(startTime)}`
      : "Start a shift when your work begins.";
  const connectivityLabel = isOffline ? "Offline" : "Online";
  const queueLabel =
    queueLength > 0
      ? `${queueLength} queued action${queueLength > 1 ? "s" : ""}`
      : "Queue clear";

  return (
    <section className="mb-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-blue-600">
            Current status
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
            {statusLabel}
          </h2>
          <p className="mt-1 text-sm text-slate-500">{sessionDetail}</p>
        </div>

        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-100">
          {isClockedIn ? "Active" : "Idle"}
        </span>
      </div>

      <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-100">
        {getLastActionText(lastAction)}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-xs font-medium text-slate-500">
        <div className="flex items-center gap-1.5">
          {isOffline ? (
            <IconCloudOff className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          ) : (
            <IconCloud className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
          )}
          <span>{connectivityLabel}</span>
        </div>
        <span>{queueLabel}</span>
      </div>
    </section>
  );
}
