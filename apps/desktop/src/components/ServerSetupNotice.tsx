import { IconInfoCircle } from "@tabler/icons-react";
import type { ClockJournal } from "../types";
import { useI18n } from "../lib/i18n";
export function ServerSetupNotice({
	journal,
}: {
	journal: ClockJournal | undefined;
}) {
	const { t } = useI18n();
	if (!journal || journal.busy || journal.commandsEnabled) return null;
	const online = journal.onlineClockingEnabled === true;
	return (
		<section
			className={`server-setup-notice${online ? " online-clock-notice" : ""}`}
			role="status"
		>
			<IconInfoCircle size={16} aria-hidden="true" />
			<div>
				<strong>
					{t(
						online
							? "Online mode"
							: journal.serverUpdateRequired
								? "Z8 update required"
								: "Connection required",
					)}
				</strong>
				<p>
					{t(
						online
							? "Internet required. Offline recording and automatic idle breaks are not available yet."
							: journal.serverUpdateRequired
								? "The Z8 webapp needs an update for online desktop clocking. Use the dashboard icon above until it is deployed; no setup is needed on your computer."
								: "Connect to Z8 and refresh status to use the clock. You can also open your dashboard using the icon above.",
					)}
				</p>
			</div>
		</section>
	);
}
