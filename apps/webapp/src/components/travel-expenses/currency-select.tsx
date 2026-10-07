"use client";

import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useMemo } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { currencyOptions } from "@/lib/travel-expenses/currency-options";

/**
 * A searchable currency select (#688): "EUR – Euro" in the viewer's locale,
 * found by code or name. It offers what `accepts` (the server's rule for the
 * field) allows; a stored value it no longer allows still shows.
 */
export function CurrencySelect({
	value,
	onValueChange,
	accepts,
	onBlur,
	id,
	className,
	disabled,
	"aria-invalid": ariaInvalid,
	"aria-label": ariaLabel,
	"aria-describedby": ariaDescribedBy,
}: {
	value: string;
	onValueChange: (currency: string) => void;
	/** The server's rule for this field, e.g. `isReimbursementCurrencySupported`. */
	accepts: (code: string) => boolean;
	/** Called when the list closes, so a form field counts as touched. */
	onBlur?: () => void;
	id?: string;
	className?: string;
	disabled?: boolean;
	"aria-invalid"?: boolean;
	"aria-label"?: string;
	"aria-describedby"?: string;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const options = useMemo(() => currencyOptions(locale, accepts, value), [locale, accepts, value]);
	return (
		<SearchableSelect
			id={id}
			className={className}
			disabled={disabled}
			aria-invalid={ariaInvalid}
			aria-label={ariaLabel}
			aria-describedby={ariaDescribedBy}
			options={options}
			value={value}
			onValueChange={onValueChange}
			onOpenChange={(open) => {
				if (!open) onBlur?.();
			}}
			placeholder={t("travelExpenses.currency.placeholder", "Choose a currency")}
			searchPlaceholder={t("travelExpenses.currency.search", "Search currencies")}
			emptyText={t("travelExpenses.currency.empty", "No currency found")}
		/>
	);
}
