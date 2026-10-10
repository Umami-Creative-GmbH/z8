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
import { RATE_LIMIT_WINDOW_OPTIONS } from "@/lib/validations/api-key";

const WINDOW_KEYS: Record<(typeof RATE_LIMIT_WINDOW_OPTIONS)[number]["value"], string> = {
	1000: "settings.apiKeys.form.rateLimitWindow.second",
	60000: "settings.apiKeys.form.rateLimitWindow.minute",
	3600000: "settings.apiKeys.form.rateLimitWindow.hour",
};

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
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{t("settings.apiKeys.form.rateLimitWindow", "Time window")}</Label>
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
							{t(WINDOW_KEYS[option.value], option.label)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
