import {
	formatNumberInput,
	type NumberInputKind,
} from "@/lib/travel-expenses/number-input-display";

/** The part of a TanStack field an amount or distance input reformats. */
interface NumberField {
	state: { value: string };
	setValue: (value: string, options: { dontRunListeners: boolean }) => void;
}

/**
 * Shows a field's entered number in the viewer's locale once it loses focus
 * (#688). The stored value is unchanged, so the form's listeners (autosave)
 * do not run for it.
 */
export function reformatNumberField(field: NumberField, locale: string, input: NumberInputKind) {
	const shown = formatNumberInput(locale, field.state.value, input);
	if (shown !== field.state.value) field.setValue(shown, { dontRunListeners: true });
}
