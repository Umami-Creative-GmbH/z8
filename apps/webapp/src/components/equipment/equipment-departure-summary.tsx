"use client";

import { useTranslate } from "@tolgee/react";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import type { EquipmentDepartureReturn } from "@/lib/organization/equipment/contracts";
import { Link } from "@/navigation";
import { useEquipmentEnabled } from "@/stores/organization-settings-store";

/** Shared presentation for departure and deactivation previews; dates are calendar-only. */
export function EquipmentDepartureSummary({
	equipment,
	employeeId,
	locale,
}: {
	equipment: EquipmentDepartureReturn[];
	employeeId: string;
	locale: string;
}) {
	const { t } = useTranslate();
	const enabled = useEquipmentEnabled();
	// Switched off (#1572): outstanding returns remain real obligations, so they stay
	// visible read-only. With nothing outstanding the section has nothing to say.
	if (!enabled && equipment.length === 0) return null;
	return (
		<section
			aria-label={t("settings.equipment.departure.title", "Outstanding equipment returns")}
			className="space-y-3 rounded-lg border bg-card p-4"
		>
			<h3 className="text-sm font-medium">
				{t("settings.equipment.departure.title", "Outstanding equipment returns")}
			</h3>
			{equipment.length ? (
				<ul className="space-y-3 text-sm">
					{equipment.map((item) => (
						<li
							key={item.assignmentId}
							className="flex flex-wrap justify-between gap-2 [content-visibility:auto]"
						>
							<span className="min-w-0 break-words">
								<span translate="no">{item.identifier}</span>
								{item.identifier !== item.typeName ? ` · ${item.typeName}` : ""} ·{" "}
								{t("settings.equipment.departure.quantity", "{count} outstanding", {
									count: item.outstandingQuantity,
								})}
							</span>
							<span>
								{t("settings.equipment.departure.due", "Due")}{" "}
								{item.effectiveDeadline ? (
									<time dateTime={item.effectiveDeadline}>
										{parsePlainDate(item.effectiveDeadline).toLocaleString(locale, {
											dateStyle: "medium",
										})}
									</time>
								) : (
									t("settings.equipment.departure.noDeadline", "No deadline")
								)}
							</span>
						</li>
					))}
				</ul>
			) : (
				<p className="text-sm text-muted-foreground">
					{t("settings.equipment.departure.empty", "No outstanding required equipment.")}
				</p>
			)}
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.equipment.departure.independent",
					"Outstanding equipment never delays employment, access or paid-seat ending. Returning a key or fob does not restore its credential.",
				)}
			</p>
			{enabled ? (
				<Link
					href={`/equipment/employees/${employeeId}`}
					className="text-sm text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:ring-2 focus-visible:ring-ring"
				>
					{t("settings.equipment.departure.followUp", "Open equipment follow-up")}
				</Link>
			) : (
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.equipment.departure.switchedOff",
						"Equipment is switched off for this organization. These returns stay recorded, but nobody can record receipts until an owner or admin switches it back on.",
					)}
				</p>
			)}
		</section>
	);
}
