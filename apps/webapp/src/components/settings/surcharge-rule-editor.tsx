"use client";

import { IconTrash } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
	type SurchargeFormApi,
	SurchargeRuleBaseFields,
	SurchargeRuleConditionalFields,
} from "./surcharge-rule-fields";

export type { SurchargeRuleFormValues } from "./surcharge-rule-fields";

interface SurchargeRuleEditorProps {
	ruleIndex: number;
	form: SurchargeFormApi;
	onRemove: () => void;
}

export function SurchargeRuleEditor({
	ruleIndex,
	form,
	onRemove,
}: SurchargeRuleEditorProps) {
	const { t } = useTranslate();

	return (
		<Card>
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between">
					<span className="text-sm font-medium">
						{t("settings.surcharges.rule", "Rule")} {ruleIndex + 1}
					</span>
					<Button
						aria-label={t(
							"settings.surcharges.removeRule",
							"Remove surcharge rule",
						)}
						type="button"
						variant="ghost"
						size="sm"
						onClick={onRemove}
						className="text-destructive hover:text-destructive"
					>
						<IconTrash className="size-4" />
					</Button>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<SurchargeRuleBaseFields form={form} ruleIndex={ruleIndex} />
				<SurchargeRuleConditionalFields form={form} ruleIndex={ruleIndex} />
			</CardContent>
		</Card>
	);
}
