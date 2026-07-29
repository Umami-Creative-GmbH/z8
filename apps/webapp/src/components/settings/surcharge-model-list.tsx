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
	return `${parseFloat(percentage) * 100}%`;
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

	if (models.length === 0) {
		return (
			<Card>
				<CardContent className="flex flex-col items-center justify-center py-12">
					<IconPercentage className="text-muted-foreground mb-4 size-12" />
					<h3 className="mb-2 text-lg font-semibold">
						{t("settings.surcharges.noModels", "No surcharge models")}
					</h3>
					<p className="text-muted-foreground mb-4 text-center">
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
				<Card key={model.id} className="relative">
					<CardHeader>
						<div className="flex items-start justify-between">
							<div className="flex-1 min-w-0">
								<CardTitle className="text-lg truncate">{model.name}</CardTitle>
								{model.description && (
									<CardDescription className="mt-1 line-clamp-2">
										{model.description}
									</CardDescription>
								)}
							</div>
							{canManage ? (
								<div className="flex items-center gap-1 ml-2">
									<Button
										aria-label={t(
											"settings.surcharges.editModel",
											"Edit Surcharge Model",
										)}
										variant="ghost"
										size="icon"
										className="size-8"
										onClick={() => onEdit(model)}
									>
										<IconPencil className="size-4" />
									</Button>
									<Button
										aria-label={t(
											"settings.surcharges.deleteModel",
											"Delete surcharge model",
										)}
										variant="ghost"
										size="icon"
										className="size-8 text-destructive hover:text-destructive"
										onClick={() => onDelete(model.id)}
									>
										<IconTrash className="size-4" />
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
										className="flex items-center justify-between text-sm"
									>
										<span className="truncate mr-2">{rule.name}</span>
										<div className="flex items-center gap-2 flex-shrink-0">
											<Badge variant="outline" className="text-xs">
												{getRuleTypeLabel(rule.ruleType)}
											</Badge>
											<span className="font-medium text-green-600">
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
