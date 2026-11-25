"use client";

import type { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import type { StatutoryUsageTier } from "@/lib/statutory/finding";

// Shared Minijob monitor labels (#1989): Employee Detail card and Reviews & Conflicts.
// Formatting helpers live in ./minijob-format.

type Translate = ReturnType<typeof useTranslate>["t"];

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
