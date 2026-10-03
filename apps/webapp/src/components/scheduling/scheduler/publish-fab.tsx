"use client";

import { IconAlertTriangle, IconLoader2, IconSend } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
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
	const { t } = useTranslate();
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
							<IconLoader2 className="size-5 mr-2 animate-spin" />
							{t("scheduling.publish.publishing", "Publishing…")}
						</>
					) : (
						<>
							{hasWarnings ? (
								<IconAlertTriangle className="size-5 mr-2" aria-hidden="true" />
							) : (
								<IconSend className="size-5 mr-2" aria-hidden="true" />
							)}
							{t("scheduling.publish.button", "Publish ({count})", {
								count: draftCount,
							})}
						</>
					)}
				</Button>
			</TooltipTrigger>
			<TooltipContent side="left" className="max-w-xs">
				{hasWarnings ? (
					<div className="space-y-1">
						<p className="font-medium text-amber-600 dark:text-amber-400">
							{t(
								"scheduling.publish.warningsDetectedBeforePublish",
								"Warnings detected before publish",
							)}
						</p>
						{hasCoverageGaps && (
							<p className="text-sm">
								{t(
									"scheduling.publish.coverageWarning",
									"Some time blocks don't meet minimum staffing requirements.",
								)}
							</p>
						)}
						{hasComplianceWarnings && (
							<p className="text-sm">
								{t(
									"scheduling.publish.complianceWarnings",
									"{count, plural, one {Compliance checks found # warning; you will need to acknowledge it before publishing.} other {Compliance checks found # warnings; you will need to acknowledge them before publishing.}}",
									{ count: complianceFindingsCount },
								)}
							</p>
						)}
					</div>
				) : (
					<p>
						{t(
							"scheduling.publish.notifyEmployees",
							"{count, plural, one {Publish # draft shift and notify employees} other {Publish # draft shifts and notify employees}}",
							{ count: draftCount },
						)}
					</p>
				)}
			</TooltipContent>
		</Tooltip>
	);
}
