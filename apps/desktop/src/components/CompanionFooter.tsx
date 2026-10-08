import { useI18n } from "../lib/i18n";
export function CompanionFooter({
	onBreak,
	isClockedIn,
	statusKnown,
}: {
	onBreak: boolean;
	isClockedIn: boolean;
	statusKnown: boolean;
}) {
	const { t } = useI18n();
	const status = onBreak
		? "On break"
		: isClockedIn
			? "Currently working"
			: statusKnown
				? "Not clocked in"
				: "Clock status unavailable";
	return (
		<footer className="app-footer">
			<div
				className={
					"status-badge " + (isClockedIn ? "status-active" : "status-inactive")
				}
			>
				<span className="status-dot" />
				<span>{t(status)}</span>
			</div>
		</footer>
	);
}
