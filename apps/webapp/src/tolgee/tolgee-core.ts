import { FormatIcu } from "@tolgee/format-icu";
import { Tolgee } from "@tolgee/web";

/** Tolgee with ICU formatting and no catalogs; callers decide where translations come from. */
export function createTolgee() {
	return Tolgee().use(FormatIcu());
}

/** The catalog-free instance the providers use: they inject each slice they render. */
export function createProviderTolgee() {
	return createTolgee().updateDefaults({ staticData: {} });
}
