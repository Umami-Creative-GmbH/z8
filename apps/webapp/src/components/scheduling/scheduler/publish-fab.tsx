"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface PublishFabProps {
	draftCount: number;
	onPublish: () => void;
	isPublishing: boolean;
	hasCoverageGaps?: boolean;
	hasComplianceWarnings?: boolean;
	complianceFindingsCount?: number;
}

export function PublishFab({
	draftCount,
	onPublish,
	isPublishing,
	hasCoverageGaps = false,
	hasComplianceWarnings = false,
	complianceFindingsCount = 0,
}: PublishFabProps) {
	const hasWarnings = hasCoverageGaps || hasComplianceWarnings;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					size="lg"
					onClick={onPublish}
					disabled={isPublishing}
					className={cn(
						"fixed bottom-6 right-6 h-14 rounded-full shadow-lg",
						"hover:shadow-xl transition-shadow",
						hasWarnings
							? "bg-amber-500 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700"
							: "bg-primary hover:bg-primary/90",
						draftCount > 0 && !hasWarnings && "motion-safe:animate-pulse",
					)}
				>
					{isPublishing ? (
						<>
							<Loader2 className="h-5 w-5 mr-2 animate-spin" />
							Publishing…
						</>
					) : (
						<>
							{hasWarnings ? (
								<IconAlertTriangle className="h-5 w-5 mr-2" aria-hidden="true" />
							) : (
								<Send className="h-5 w-5 mr-2" aria-hidden="true" />
							)}
							Publish ({draftCount})
						</>
					)}
				</Button>
			</TooltipTrigger>
			<TooltipContent side="left" className="max-w-xs">
				{hasWarnings ? (
					<div className="space-y-1">
						<p className="font-medium text-amber-600 dark:text-amber-400">
							Warnings detected before publish
						</p>
						{hasCoverageGaps && (
							<p className="text-sm">
								Some time blocks don&apos;t meet minimum staffing requirements.
							</p>
						)}
						{hasComplianceWarnings && (
							<p className="text-sm">
								Compliance checks found {complianceFindingsCount} warning
								{complianceFindingsCount === 1 ? "" : "s"}; you will need to acknowledge
								them before publishing.
							</p>
						)}
					</div>
				) : (
					<p>
						Publish {draftCount} draft shift{draftCount !== 1 ? "s" : ""} and notify employees
					</p>
				)}
			</TooltipContent>
		</Tooltip>
	);
}
