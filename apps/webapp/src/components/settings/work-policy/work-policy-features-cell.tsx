import { IconCalendar, IconGavel, IconMapPin } from "@tabler/icons-react";
import type { TFnType } from "@tolgee/react";
import type { WorkPolicyWithDetails } from "@/app/[locale]/(app)/settings/work-policies/actions";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function WorkPolicyFeaturesCell({
	policy,
	t,
}: {
	policy: WorkPolicyWithDetails;
	t: TFnType;
}) {
	return (
		<div className="flex justify-center gap-1">
			{policy.scheduleEnabled ? (
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger>
							<Badge variant="outline" className="gap-1">
								<IconCalendar className="size-3" />
								{t("settings.workPolicies.schedule", "Schedule")}
							</Badge>
						</TooltipTrigger>
						<TooltipContent>
							{t("settings.workPolicies.scheduleEnabled", "Work schedule enabled")}
						</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			) : null}
			{policy.regulationEnabled ? (
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger>
							<Badge variant="outline" className="gap-1">
								<IconGavel className="size-3" />
								{t("settings.workPolicies.regulation", "Regulation")}
							</Badge>
						</TooltipTrigger>
						<TooltipContent>
							{t("settings.workPolicies.regulationEnabled", "Time regulation enabled")}
						</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			) : null}
			{policy.presenceEnabled ? (
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger>
							<Badge variant="outline" className="gap-1">
								<IconMapPin className="size-3" />
								{t("settings.workPolicies.presenceEnabled", "Presence")}
							</Badge>
						</TooltipTrigger>
						<TooltipContent>
							{policy.presence
								? policy.presence.presenceMode === "minimum_count"
									? t(
											"settings.workPolicies.presenceSummaryDaysPerWeek",
											"{count} days/{period} on-site",
											{
												count: policy.presence.requiredOnsiteDays,
												period: policy.presence.evaluationPeriod,
											},
										)
									: t("settings.workPolicies.presenceSummaryFixedDays", "Fixed days on-site")
								: t("settings.workPolicies.presenceEnabledTooltip", "On-site presence required")}
						</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			) : null}
		</div>
	);
}
