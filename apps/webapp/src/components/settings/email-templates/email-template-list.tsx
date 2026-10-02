"use client";

import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EmailTemplateOverride } from "./email-template-settings-client";

type EmailTemplateListDefinition = {
	key: string;
	category: string;
	label: string;
	description: string;
};

interface EmailTemplateListProps {
	templates: Array<{
		definition: EmailTemplateListDefinition;
		override: EmailTemplateOverride | null;
	}>;
	selectedKey: string;
	onSelect: (key: string) => void;
}

function getCategoryLabels(
	t: ReturnType<typeof useTranslate>["t"],
): Record<string, string> {
	return {
		auth: t("settings.emailTemplates.categories.auth", "Account access"),
		absences: t("settings.emailTemplates.categories.absences", "Absences"),
		billing: t("settings.emailTemplates.categories.billing", "Billing"),
		"time-corrections": t(
			"settings.emailTemplates.categories.timecorrections",
			"Time corrections",
		),
		teams: t("settings.emailTemplates.categories.teams", "Teams"),
		security: t("settings.emailTemplates.categories.security", "Security"),
		exports: t("settings.emailTemplates.categories.exports", "Exports"),
	};
}

export function EmailTemplateList({
	templates,
	selectedKey,
	onSelect,
}: EmailTemplateListProps) {
	const { t } = useTranslate();
	const groups = templates.reduce<Record<string, typeof templates>>(
		(accumulator, template) => {
			const category = template.definition.category;
			accumulator[category] = accumulator[category] ?? [];
			accumulator[category].push(template);
			return accumulator;
		},
		{},
	);

	return (
		<nav
			aria-label={t(
				"settings.emailTemplates.emailTemplates",
				"Email templates",
			)}
			className="space-y-5"
		>
			{Object.entries(groups).map(([category, entries]) => (
				<section
					key={category}
					className="space-y-2"
					aria-labelledby={`email-template-${category}`}
				>
					<h2
						id={`email-template-${category}`}
						className="px-1 font-medium text-muted-foreground text-xs uppercase tracking-wide"
					>
						{getCategoryLabels(t)[category] ?? category}
					</h2>
					<div className="space-y-2">
						{entries.map(({ definition, override }) => {
							const selected = definition.key === selectedKey;
							const disabled = override?.isEnabled === false;
							const status = disabled
								? t("settings.notifications.status.disabled", "Disabled")
								: override
									? t("settings.emailTemplates.status.customized", "Customized")
									: t("settings.emailTemplates.status.default", "Default");

							return (
								<Button
									key={definition.key}
									type="button"
									variant="ghost"
									aria-current={selected ? "true" : undefined}
									className={cn(
										"h-auto min-h-14 w-full justify-start rounded-xl border px-3 py-3 text-left",
										"hover:bg-muted/60 focus-visible:ring-ring/50",
										selected
											? "border-primary/45 bg-primary/5 shadow-xs"
											: "border-border/70 bg-card",
									)}
									onClick={() => onSelect(definition.key)}
								>
									<span className="flex w-full min-w-0 items-start justify-between gap-3">
										<span className="min-w-0 space-y-1">
											<span className="block truncate font-medium text-sm">
												{definition.label}
											</span>
											<span className="line-clamp-2 block whitespace-normal text-muted-foreground text-xs leading-5">
												{definition.description}
											</span>
										</span>
										<Badge
											variant={
												disabled
													? "destructive"
													: override
														? "secondary"
														: "outline"
											}
										>
											{status}
										</Badge>
									</span>
								</Button>
							);
						})}
					</div>
				</section>
			))}
		</nav>
	);
}
