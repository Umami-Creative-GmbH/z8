export type Translate = (
	key: string,
	defaultValue: string,
	values?: Record<string, string | number>,
) => string;

export const defaultTranslate: Translate = (_key, defaultValue) => defaultValue;
