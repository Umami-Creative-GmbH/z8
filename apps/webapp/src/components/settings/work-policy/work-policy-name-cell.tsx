import { IconStar } from "@tabler/icons-react";
import type { TFnType } from "@tolgee/react";
import type { WorkPolicyWithDetails } from "@/app/[locale]/(app)/settings/work-policies/actions";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function WorkPolicyNameCell({
	policy,
	t,
}: {
	policy: WorkPolicyWithDetails;
	t: TFnType;
}) {
	return (
		<div className="max-w-[300px] min-w-0">
			<div className="flex min-w-0 items-center gap-2">
				<span className="min-w-0 font-medium truncate" title={policy.name}>
					{policy.name}
				</span>
				{policy.isDefault ? (
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger
								className="shrink-0 rounded-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								aria-label={t("settings.workPolicies.defaultPolicy", "Default policy")}
							>
								<IconStar className="size-4 fill-current" aria-hidden="true" />
							</TooltipTrigger>
							<TooltipContent>
								{t("settings.workPolicies.defaultPolicy", "Default policy")}
							</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				) : null}
			</div>
			{policy.description ? (
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger asChild>
							<p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
								{policy.description}
							</p>
						</TooltipTrigger>
						<TooltipContent className="max-w-sm">
							<p>{policy.description}</p>
						</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			) : null}
		</div>
	);
}
