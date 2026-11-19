"use client";

import { useTranslate } from "@tolgee/react";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import { FEATURE_SWITCH_HREFS, type FeatureFlag } from "./settings-config";

/**
 * Explains a setting whose organization feature is switched off, and where it
 * is switched on. Viewers who reach Organization settings get a link to the
 * feature's switch; everyone else is told to ask an organization admin.
 */
export function SettingsFeatureOffNotice({
	feature,
	settingTitle,
	canChangeFeatures,
	compact = false,
	className,
}: {
	feature: FeatureFlag;
	/** Names the setting for screen readers, so every link is distinct. */
	settingTitle: string;
	canChangeFeatures: boolean;
	compact?: boolean;
	className?: string;
}) {
	const { t } = useTranslate();

	return (
		<div className={cn(compact ? "space-y-0.5 text-xs" : "space-y-1 text-sm", className)}>
			<p className="font-medium text-muted-foreground">
				{t("settings.featureOff.status", "Turned off for this organization")}
			</p>
			{canChangeFeatures ? (
				<Link
					href={FEATURE_SWITCH_HREFS[feature]}
					className="inline-block rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
				>
					{t("settings.featureOff.turnOn", "Turn on in Organization settings")}{" "}
					<span className="sr-only">({settingTitle})</span>
				</Link>
			) : (
				<p className="text-muted-foreground">
					{t("settings.featureOff.askAdmin", "Ask an organization admin to turn this on.")}
				</p>
			)}
		</div>
	);
}
