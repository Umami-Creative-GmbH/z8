import { useEffect, useState } from "react";
import { DateTime } from "luxon";
import { formatElapsedTime } from "@/lib/time";

export function useTimer(startTime: string | null) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!startTime) {
      setElapsedSeconds(0);
      return;
    }

    const startDate = DateTime.fromISO(startTime);
    if (!startDate.isValid) {
      setElapsedSeconds(0);
      return;
    }

    const updateElapsed = () => {
      setElapsedSeconds(Math.floor(DateTime.now().diff(startDate, "seconds").seconds));
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);

    return () => clearInterval(interval);
  }, [startTime]);

  return elapsedSeconds;
}

export const formatTime = formatElapsedTime;
