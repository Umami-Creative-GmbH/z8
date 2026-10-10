"use client";

import { useTranslate } from "@tolgee/react";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { RATE_LIMIT_WINDOWS } from "@/lib/validations/api-key";
import { useRateLimitWindowLabels } from "./api-key-labels";

/** The time window a key's request limit counts in (#763). Values are milliseconds as strings. */
export function RateLimitWindowField({
	id,
	value,
	onChange,
	onBlur,
}: {
	id: string;
	value: string;
	onChange: (value: string) => void;
	onBlur: () => void;
}) {
	const { t } = useTranslate();
	const labels = useRateLimitWindowLabels();

	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{t("settings.apiKeys.form.rateLimitWindowLabel", "Time window")}</Label>
			<Select<string>
				value={value}
				onValueChange={(next) => {
					if (next !== null) onChange(next);
				}}
			>
				<SelectTrigger id={id} onBlur={onBlur} className="w-40">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{RATE_LIMIT_WINDOWS.map((windowMs) => (
						<SelectItem key={windowMs} value={String(windowMs)}>
							{labels[windowMs]}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
