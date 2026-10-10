/**
 * A travel expense notification's stored message: the English default of its
 * Tolgee key with every `{name}` placeholder filled from `params`. A
 * placeholder without a value stays as written.
 */
export function fillMessageDefault(
	template: string,
	params: Readonly<Record<string, string | number | null | undefined>>,
): string {
	return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
		const value = params[name];
		return value === undefined || value === null ? placeholder : String(value);
	});
}
