import { LANGUAGE_CONFIG } from "@/lib/language-config";
import { ALL_LANGUAGES } from "@/tolgee/shared";

const NEUTRAL_LANGUAGE_ICON = "\u{1F310}";

// A flag emoji is the country code spelled in regional indicator symbols.
function flagEmoji(country: string): string {
	return String.fromCodePoint(
		...[...country.toUpperCase()].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65),
	);
}

/** The /language button label: flag (or a globe) and native name. */
export function telegramLanguageLabel(code: string): string {
	const config = LANGUAGE_CONFIG[code];
	if (!config) return code;
	const icon = config.country ? flagEmoji(config.country) : NEUTRAL_LANGUAGE_ICON;
	return `${icon} ${config.name}`;
}

/** Language display config for the /language inline keyboard. */
export const TELEGRAM_LANGUAGE_BUTTONS: ReadonlyArray<{ code: string; label: string }> =
	ALL_LANGUAGES.map((code) => ({ code, label: telegramLanguageLabel(code) }));
