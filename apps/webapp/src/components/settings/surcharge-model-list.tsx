"use client";

import {
	IconPencil,
	IconPercentage,
	IconPlus,
	IconTrash,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { SurchargeModelWithRules } from "@/lib/surcharges/validation";

interface SurchargeModelListProps {
	canManage: boolean;
	models: SurchargeModelWithRules[];
	onCreate: () => void;
	onDelete: (modelId: string) => void;
	onEdit: (model: SurchargeModelWithRules) => void;
}

function formatPercentage(percentage: string) {
	// Round away binary float noise such as 0.07 * 100 = 7.000000000000001.
	return `${Math.round(parseFloat(percentage) * 10000) / 100}%`;
}

export function SurchargeModelList({
	canManage,
	models,
	onCreate,
	onDelete,
	onEdit,
}: SurchargeModelListProps) {
	const { t } = useTranslate();
	const activeModels = models.filter((model) => model.isActive);
	const getRuleTypeLabel = (ruleType: string) => {
		switch (ruleType) {
			case "day_of_week":
				return t("settings.surcharges.dayOfWeek", "Day of Week");
			case "time_window":
				return t("settings.surcharges.timeWindow", "Time Window");
			case "date_based":
				return t("settings.surcharges.dateBased", "Date-Based");
			default:
				return ruleType;
		}
	};

	// Inactive (deleted) models are never listed, so they cannot fill the catalog either.
	if (activeModels.length === 0) {
		return (
			<Card>
				<CardContent className="flex flex-col items-center justify-center py-10 text-center">
					<IconPercentage
						aria-hidden="true"
						className="text-muted-foreground mb-3 size-8"
					/>
					<h2 className="mb-1 text-base font-semibold">
						{t("settings.surcharges.noModels", "No surcharge models")}
					</h2>
					<p className="text-muted-foreground mb-4 max-w-md text-sm">
						{t(
							"settings.surcharges.noModelsDescription",
							"Create a surcharge model to define rules for overtime, night work, and weekend premiums.",
						)}
					</p>
					{canManage ? (
						<Button onClick={onCreate}>
							<IconPlus className="mr-2 size-4" />
							{t("settings.surcharges.createFirstModel", "Create First Model")}
						</Button>
					) : null}
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
			{activeModels.map((model) => (
				<Card key={model.id} className="relative min-w-0">
					<CardHeader>
						<div className="flex items-start justify-between">
							<div className="flex-1 min-w-0">
								<CardTitle className="text-lg truncate" title={model.name}>
									{model.name}
								</CardTitle>
								{model.description && (
									<CardDescription className="mt-1 line-clamp-2">
										{model.description}
									</CardDescription>
								)}
							</div>
							{canManage ? (
								<div className="flex items-center gap-1 ml-2">
									<Button
										aria-label={`${t(
											"settings.surcharges.editModel",
											"Edit Surcharge Model",
										)}: ${model.name}`}
										variant="ghost"
										size="icon"
										className="size-8"
										onClick={() => onEdit(model)}
									>
										<IconPencil aria-hidden="true" className="size-4" />
									</Button>
									<Button
										aria-label={`${t(
											"settings.surcharges.deleteModel",
											"Delete surcharge model",
										)}: ${model.name}`}
										variant="ghost"
										size="icon"
										className="size-8 text-destructive hover:text-destructive"
										onClick={() => onDelete(model.id)}
									>
										<IconTrash aria-hidden="true" className="size-4" />
									</Button>
								</div>
							) : null}
						</div>
					</CardHeader>
					<CardContent>
						<div className="space-y-2">
							<div className="text-muted-foreground text-sm">
								{t(
									"settings.surcharges.ruleCountLabel",
									"{count, plural, one {# rule} other {# rules}}",
									{ count: model.rules.length },
								)}
							</div>
							<div className="space-y-1">
								{model.rules.slice(0, 3).map((rule) => (
									<div
										key={rule.id}
										className="flex min-w-0 items-center justify-between text-sm"
									>
										<span className="min-w-0 truncate mr-2" title={rule.name}>
											{rule.name}
										</span>
										<div className="flex items-center gap-2 flex-shrink-0">
											<Badge variant="outline" className="text-xs">
												{getRuleTypeLabel(rule.ruleType)}
											</Badge>
											<span className="font-medium tabular-nums">
												+{formatPercentage(rule.percentage)}
											</span>
										</div>
									</div>
								))}
								{model.rules.length > 3 && (
									<div className="text-muted-foreground text-xs">
										+{model.rules.length - 3}{" "}
										{t("settings.surcharges.moreRules", "more rules")}
									</div>
								)}
							</div>
						</div>
					</CardContent>
				</Card>
			))}
		</div>
	);
}
