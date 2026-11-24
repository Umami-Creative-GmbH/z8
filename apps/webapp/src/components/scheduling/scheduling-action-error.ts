import {
	actionErrorMessage,
	type RefusalOverrides,
	type Translate,
} from "@/lib/organization-action/action-error-message";

/**
 * Words a failed scheduling action through `actionErrorMessage`: the feature's text for a refusal
 * it words (`overrides`, e.g. the JArbSchG publish block), else the action's own message, since
 * the scheduling actions still word their other failures themselves.
 */
export function schedulingActionErrorMessage(
	t: Translate,
	result: { readonly error: string; readonly refusal?: string | null },
	overrides: RefusalOverrides,
): string {
	return actionErrorMessage(t, { refusal: result.refusal }, overrides, () => result.error);
}
