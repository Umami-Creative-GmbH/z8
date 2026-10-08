import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import type { IdleEvent } from "../types";

export function useIdle() {
	const [idleEvent, setIdleEvent] = useState<IdleEvent | null>(null);
	const [isIdleDialogOpen, setIsIdleDialogOpen] = useState(false);

	useEffect(() => {
		const unlisten = listen<IdleEvent>("idle_detected", (event) => {
			setIdleEvent(event.payload);
			setIsIdleDialogOpen(true);
		});

		const unlistenCancelled = listen("idle_cancelled", () => {
			setIdleEvent(null);
			setIsIdleDialogOpen(false);
		});
		return () => {
			unlisten.then((fn) => fn());
			unlistenCancelled.then((fn) => fn());
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
