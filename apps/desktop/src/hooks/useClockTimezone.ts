import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useI18n } from "../lib/i18n";
export function useClockTimezone(savedZone: string | undefined) {
	const { t } = useI18n();
	const [pending, setPending] = useState<{
		deviceZone: string;
		action: () => Promise<boolean>;
	} | null>(null);
	const run = async (action: () => Promise<boolean>) => {
		try {
			const deviceZone = await invoke<string>("get_device_timezone");
			if (savedZone && deviceZone !== savedZone) {
				setPending({ deviceZone, action });
				return;
			}
			await action();
		} catch (error) {
			toast.error(t("Clock action failed"), { description: String(error) });
		}
	};
	return {
		run,
		deviceZone: pending?.deviceZone,
		cancel: () => setPending(null),
		continueOnce: async () => {
			const action = pending?.action;
			setPending(null);
			await action?.();
		},
	};
}
