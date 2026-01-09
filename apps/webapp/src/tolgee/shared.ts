import { FormatIcu } from "@tolgee/format-icu";
import { DevTools, Tolgee } from "@tolgee/web";

const isDevelopment = process.env.NODE_ENV === "development";

// Only use Tolgee API in development for in-context editing
// In production, local JSON files (pulled via CLI before build) are used
const apiKey = isDevelopment ? process.env.NEXT_PUBLIC_TOLGEE_API_KEY : undefined;
const apiUrl = isDevelopment ? process.env.NEXT_PUBLIC_TOLGEE_API_URL : undefined;

export const ALL_LANGUAGES = ["de", "en"];

export const DEFAULT_LANGUAGE = "de";

export function TolgeeBase() {
	const tolgee = Tolgee().use(FormatIcu());

	// Only load DevTools in development
	if (isDevelopment) {
		tolgee.use(DevTools());
	}

	return tolgee.updateDefaults({
		apiKey,
		apiUrl,
		// Disable invisible character encoding to prevent broken strings in HTML
		observerOptions: {
			fullKeyEncode: false,
		},
		staticData: {
			de: () => import("../../messages/de.json"),
			en: () => import("../../messages/en.json"),
		},
	});
}
