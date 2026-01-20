import { useEffect, useState } from "react";

/**
 * Hook for tracking elapsed time with per-second updates.
 * Isolated to prevent unnecessary re-renders in parent components.
 */
export function useElapsedTimer(startTime: string | null): number {
  const [elapsedSeconds, setElapsedSeconds] = useState(() => {
    if (!startTime) return 0;
    return Math.floor((Date.now() - new Date(startTime).getTime()) / 1000);
  });

  useEffect(() => {
    if (!startTime) {
      setElapsedSeconds(0);
      return;
    }

    const calculateElapsed = () => {
      const start = new Date(startTime);
      return Math.floor((Date.now() - start.getTime()) / 1000);
    };

    setElapsedSeconds(calculateElapsed());

    const interval = setInterval(() => {
      setElapsedSeconds(calculateElapsed());
    }, 1000);

    return () => clearInterval(interval);
  }, [startTime]);

  return elapsedSeconds;
}
