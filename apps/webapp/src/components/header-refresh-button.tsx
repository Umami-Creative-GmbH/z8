"use client";

import { IconReload } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useViewRefreshAction } from "@/components/providers/view-refresh-provider";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function HeaderRefreshButton() {
	const { t } = useTranslate();
	const { refresh, isRefreshing } = useViewRefreshAction();
	const label = t("common.refreshData", "Refresh data");

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="button"
						size="icon"
						variant="ghost"
						className="size-9 shrink-0"
						aria-label={label}
						aria-busy={isRefreshing}
						disabled={isRefreshing}
						onClick={refresh}
					>
						<span className={isRefreshing ? "motion-safe:animate-spin" : undefined}>
							<IconReload className="size-4" aria-hidden="true" />
						</span>
					</Button>
				}
			/>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}
