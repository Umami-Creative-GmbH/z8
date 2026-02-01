import { useEffect, useState } from "react";

export function useTimer(startTime: string | null) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!startTime) {
      setElapsedSeconds(0);
      return;
    }

    const startDate = new Date(startTime).getTime();

    const updateElapsed = () => {
      const now = Date.now();
      setElapsedSeconds(Math.floor((now - startDate) / 1000));
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);

    return () => clearInterval(interval);
  }, [startTime]);

  return elapsedSeconds;
}

// Hoisted outside component - no recreation per call
const pad = (n: number) => n.toString().padStart(2, "0");

export function formatTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
