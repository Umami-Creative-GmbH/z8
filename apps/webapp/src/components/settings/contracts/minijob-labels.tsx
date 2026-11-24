"use client";

import type { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import type { StatutoryUsageTier } from "@/lib/statutory/finding";
import type { MinijobExceedanceStatus } from "@/lib/statutory/minijob/minijob-months";

// Shared Minijob monitor labels (#1989): Employee Detail card and Reviews & Conflicts.

type Translate = ReturnType<typeof useTranslate>["t"];

export function formatMinijobMonth(month: string, locale: string): string {
	const [year, monthNumber] = month.split("-").map(Number);
	return new Intl.DateTimeFormat(locale, {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}).format(new Date(Date.UTC(year ?? 1970, (monthNumber ?? 1) - 1, 1)));
}

export function formatEuroCents(cents: number, locale: string, currency = "EUR"): string {
	return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

function tierLabel(tier: StatutoryUsageTier, t: Translate): string {
	switch (tier) {
		case "ok":
			return t("settings.contracts.minijob.tier.ok", "Within limit");
		case "warning":
			return t("settings.contracts.minijob.tier.warning", "Approaching limit");
		case "critical":
			return t("settings.contracts.minijob.tier.critical", "Close to limit");
		case "exceeded":
			return t("settings.contracts.minijob.tier.exceeded", "Over limit");
	}
}

export function MinijobTierBadge({
	tier,
	documented = false,
	t,
}: {
	tier: StatutoryUsageTier | null;
	/** An exceeded month documented as unforeseeable: within the law, so not shown as a breach. */
	documented?: boolean;
	t: Translate;
}) {
	if (tier === null) {
		return <span className="text-muted-foreground">—</span>;
	}
	if (tier === "exceeded" && documented) {
		return (
			<Badge variant="outline">
				{t(
					"settings.contracts.minijob.tier.exceededDocumented",
					"Exceeded (documented as unforeseeable)",
				)}
			</Badge>
		);
	}
	const variant =
		tier === "exceeded" ? "destructive" : tier === "ok" ? "secondary" : ("outline" as const);
	return (
		<Badge
			variant={variant}
			className={
				tier === "warning" || tier === "critical" ? "border-warning/50 text-warning" : undefined
			}
		>
			{tierLabel(tier, t)}
		</Badge>
	);
}

export function minijobExceedanceLabel(status: MinijobExceedanceStatus, t: Translate): string {
	switch (status) {
		case "acknowledged":
			return t("settings.contracts.minijob.exceedance.acknowledged", "Documented as unforeseeable");
		case "unacknowledged":
			return t("settings.contracts.minijob.exceedance.unacknowledged", "Not documented");
		case "stale":
			return t(
				"settings.contracts.minijob.exceedance.stale",
				"Documentation outdated: work or shifts changed",
			);
		case "over_double_cap":
			return t("settings.contracts.minijob.exceedance.overDoubleCap", "More than twice the limit");
		case "too_many_exceedances":
			return t(
				"settings.contracts.minijob.exceedance.tooMany",
				"Too many exceedance months within 12 months",
			);
	}
}
