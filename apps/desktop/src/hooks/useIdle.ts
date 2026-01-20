import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import type { IdleEvent } from "../types";

export function useIdle() {
  const [idleEvent, setIdleEvent] = useState<IdleEvent | null>(null);
  const [isIdleDialogOpen, setIsIdleDialogOpen] = useState(false);

  useEffect(() => {
    const unlisten = listen<IdleEvent>("idle_detected", (event) => {
      console.log("Idle detected:", event.payload);
      setIdleEvent(event.payload);
      setIsIdleDialogOpen(true);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const dismissIdle = () => {
    setIsIdleDialogOpen(false);
    setIdleEvent(null);
  };

  return {
    idleEvent,
    isIdleDialogOpen,
    dismissIdle,
  };
}
