"use client";

import { IconCloudUpload } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { kioskOfflineQueue } from "@/lib/time-tracking/kiosk/offline-queue";

/** Read-only presentation of the existing queue, never a second sender or receipt owner. */
export function KioskQueueStatus({
	kioskId,
	reloadKey,
	unresolved,
}: {
	kioskId: string;
	reloadKey: string;
	unresolved: number;
}) {
	const { t } = useTranslate();
	const [queue, setQueue] = useState({ reloadKey, waiting: 0 });
	useEffect(() => {
		let active = true;
		async function read() {
			const commands = await kioskOfflineQueue.commands();
			if (active)
				setQueue({
					reloadKey,
					waiting: commands.filter((command) => command.kioskId === kioskId)
						.length,
				});
		}
		void read();
		const timer = window.setInterval(() => void read(), 5_000);
		return () => {
			active = false;
			window.clearInterval(timer);
		};
	}, [kioskId, reloadKey]);
	const waiting = queue.reloadKey === reloadKey ? queue.waiting : 0;
	if (waiting === 0 && unresolved === 0) return null;
	return (
		<div
			role="status"
			className="flex items-start gap-3 rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-100"
		>
			<IconCloudUpload className="size-6 shrink-0" aria-hidden="true" />
			<div className="space-y-1">
				{waiting > 0 ? (
					<p className="text-lg font-medium">
						{t(
							"timeTracking.kiosk.queue.awaiting",
							"Clockings awaiting confirmation: {count}",
							{ count: waiting },
						)}
					</p>
				) : null}
				{unresolved > 0 ? (
					<p className="text-lg font-medium">
						{t(
							"timeTracking.kiosk.queue.checking",
							"Checking submitted actions: {count}",
							{ count: unresolved },
						)}
					</p>
				) : null}
				<p>
					{t(
						"timeTracking.kiosk.queue.recovery",
						"The kiosk checks again automatically when it can reach Z8. Do not repeat an action whose outcome is unknown.",
					)}
				</p>
			</div>
		</div>
	);
}
