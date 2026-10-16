"use client";

import { IconReload } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { useViewRefreshAction } from "@/components/providers/view-refresh-provider";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function HeaderRefreshButton({
	children,
	className,
}: {
	children?: ReactNode;
	className?: string;
} = {}) {
	const { t } = useTranslate();
	const { refresh, isRefreshing } = useViewRefreshAction();
	const label = t("common.refreshData", "Refresh data");

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="button"
						size={children ? "default" : "icon"}
						variant="ghost"
						className={cn("h-9 shrink-0", !children && "w-9", className)}
						aria-label={label}
						aria-busy={isRefreshing}
						disabled={isRefreshing}
						onClick={refresh}
					>
						<span
							className={isRefreshing ? "motion-safe:animate-spin" : undefined}
						>
							<IconReload className="size-4" aria-hidden="true" />
						</span>
						{children}
					</Button>
				}
			/>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}
