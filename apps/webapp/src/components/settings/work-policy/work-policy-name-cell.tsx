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
		<div className="max-w-[300px]">
			<div className="flex items-center gap-2">
				<span className="min-w-0 font-medium truncate">{policy.name}</span>
				{policy.isDefault ? (
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger>
								<IconStar className="size-4 text-yellow-500 fill-yellow-500 shrink-0" />
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
