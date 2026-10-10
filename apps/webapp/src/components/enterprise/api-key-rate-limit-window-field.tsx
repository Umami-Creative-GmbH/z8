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
import { RATE_LIMIT_WINDOW_OPTIONS, type RateLimitWindow } from "@/lib/validations/api-key";

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
	const labels: Record<RateLimitWindow, string> = {
		1000: t("settings.apiKeys.form.rateLimitWindowSecond", "per second"),
		60000: t("settings.apiKeys.form.rateLimitWindowMinute", "per minute"),
		3600000: t("settings.apiKeys.form.rateLimitWindowHour", "per hour"),
	};
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
					{RATE_LIMIT_WINDOW_OPTIONS.map((option) => (
						<SelectItem key={option.value} value={String(option.value)}>
							{labels[option.value]}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
