import type { ClockJournal } from "../types";
import { useI18n } from "../lib/i18n";
export function ServerSetupNotice({
	journal,
}: {
	journal: ClockJournal | undefined;
}) {
	const { t } = useI18n();
	if (
		!journal ||
		journal.busy ||
		(journal.commandsEnabled && journal.breaksEnabled)
	)
		return null;
	return (
		<section className="clock-recovery">
			<strong>{t("Server setup required")}</strong>
			<p>
				{t(
					"Ask your administrator to enable reliable offline clocking and atomic breaks for this organization.",
				)}
			</p>
		</section>
	);
}
