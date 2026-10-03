import {
	IconBuilding,
	IconCompass,
	IconHome,
	IconMapPin,
} from "@tabler/icons-react";
import type { TFnType } from "@tolgee/react";
import { isWorkLocationType } from "@/lib/time-tracking/work-location";

export const workLocationIcons = {
	office: IconBuilding,
	home: IconHome,
	remote: IconMapPin,
	other: IconCompass,
};

export function WorkLocationIndicator({
	value,
	t,
	showLabel = false,
	missingLabel = "Not recorded",
}: {
	value: string | null | undefined;
	t: TFnType;
	showLabel?: boolean;
	missingLabel?: string;
}) {
	const location = value === "field" ? "remote" : value;
	if (!isWorkLocationType(location)) {
		return showLabel ? (
			<span className="text-sm text-muted-foreground">{missingLabel}</span>
		) : null;
	}
	const labels = {
		office: t("timeTracking:timeTracking.workLocationOffice", "Office"),
		home: t("timeTracking:timeTracking.workLocationHome", "Home"),
		remote: t("timeTracking:timeTracking.workLocationRemote", "Remote"),
		other: t("timeTracking:timeTracking.workLocationOther", "Other"),
	};
	const Icon = workLocationIcons[location];
	return (
		<span
			className="inline-flex shrink-0 items-center gap-1.5 text-sm"
			title={labels[location]}
		>
			<Icon className="size-4 shrink-0" aria-hidden="true" />
			<span className={showLabel ? undefined : "sr-only"}>
				{labels[location]}
			</span>
		</span>
	);
}
