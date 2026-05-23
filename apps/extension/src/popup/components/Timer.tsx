import IconClock from "@tabler/icons-react/dist/esm/icons/IconClock.mjs";
import { useTimer, formatTime } from "../hooks/useTimer";

interface TimerProps {
  startTime: string;
}

export function Timer({ startTime }: TimerProps) {
  const elapsedSeconds = useTimer(startTime);
  const formatted = formatTime(elapsedSeconds);

  return (
    <div
      className="mb-3 flex items-center justify-center gap-2 rounded-2xl bg-slate-950 p-4 font-mono text-3xl font-semibold tracking-tight text-slate-50 shadow-sm"
      role="timer"
    >
      <IconClock className="size-5 text-blue-300" aria-hidden="true" />
      <span>{formatted}</span>
    </div>
  );
}
