import { useEffect, useMemo, useState } from "react";
import { Temporal } from "temporal-polyfill";
import { todayTotal } from "../lib/day-total";
import { useI18n } from "../lib/i18n";
import type { DesktopContext, ClockJournal } from "../types";
export function DayTotal({
	context,
	journal,
}: {
	context: DesktopContext | undefined;
	journal: ClockJournal | undefined;
}) {
	const { t, language } = useI18n();
	const updated = useMemo(() => {
        if (!context) return "";
        try {
            return new Intl.DateTimeFormat(language, { dateStyle: "short", timeStyle: "short", timeZone: context.timezone }).format(new Date(context.fetchedAt));
        } catch { return context.fetchedAt; }
    }, [language, context?.timezone, context?.fetchedAt]);
    const [now, setNow] = useState(() => Temporal.Now.instant().toString());
	useEffect(() => {
		const timer = setInterval(
			() => setNow(Temporal.Now.instant().toString()),
			1000,
		);
		return () => clearInterval(timer);
	}, []);
	if (!context?.dayTotalBasis)
		return <p className="field-hint">{t("Day total unavailable")}</p>;
	const pending =
		journal?.commands.filter(
			(command) => command.state === "pending" || command.state === "stalled",
		) ?? [];
	const cached = context.cached || journal?.serverReachable === false;
    const estimated = cached || pending.length > 0;
	// With a fresh server basis, an uncertain command may already be included.
	// Never double-count it: show the server snapshot until the receipt settles.
	const at = pending.length && !cached ? context.fetchedAt : now;
	const minutes = todayTotal(
		context.dayTotalBasis,
		cached ? pending : [],
		at,
	);
	return (
		<section className="day-total" aria-label={t("Today")}>
			<span>{t(cached ? "Estimated today" : pending.length ? "Server total" : "Today")}</span>
			<strong>
				{minutes === null
					? "—"
					: `${Math.floor(minutes / 60)}h ${(minutes % 60).toString().padStart(2, "0")}m`}
			</strong>
			<span className="field-hint">
				{t(estimated ? "Last server update" : "Confirmed by server")}
				{estimated ? `: ${updated}` : ""} · {context.timezone}
			</span>
			{!!pending.length && (
				<span className="pending-label">
					{pending.length} · {t("Saved on this device")}
				</span>
			)}
		</section>
	);
}
