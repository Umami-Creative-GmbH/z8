import { Clock } from "lucide-react";
import { useTimer, formatTime } from "../hooks/useTimer";

interface TimerProps {
  startTime: string;
}

export function Timer({ startTime }: TimerProps) {
  const elapsedSeconds = useTimer(startTime);
  const formatted = formatTime(elapsedSeconds);

  return (
    <div
      className="flex items-center justify-center gap-2 py-3 text-2xl font-mono font-semibold text-emerald-600"
      role="timer"
      aria-live="polite"
      aria-atomic="true"
    >
      <Clock className="w-5 h-5" aria-hidden="true" />
      <span>{formatted}</span>
    </div>
  );
}
