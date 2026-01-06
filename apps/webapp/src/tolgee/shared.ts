import { FormatIcu } from "@tolgee/format-icu";
import { DevTools, Tolgee } from "@tolgee/web";

const apiKey = process.env.NEXT_PUBLIC_TOLGEE_API_KEY;
const apiUrl = process.env.NEXT_PUBLIC_TOLGEE_API_URL;

export const ALL_LANGUAGES = ["de", "en"];

export const DEFAULT_LANGUAGE = "de";

export function TolgeeBase() {
	return Tolgee()
		.use(FormatIcu())
		.use(DevTools())
		.updateDefaults({
			apiKey,
			apiUrl,
			staticData: {
				de: () => import("../../messages/de.json"),
				en: () => import("../../messages/en.json"),
			},
		});
}
