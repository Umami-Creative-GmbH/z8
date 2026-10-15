/**
 * A Tolgee `t` as server and client code pass it to message helpers: the
 * client's `useTranslate().t` or the server's `getTranslate()`. Name the
 * parameter `t` so the key extractor finds the calls.
 */
export type MessageTranslate = (
	key: string,
	defaultValue: string,
	params?: Record<string, string>,
) => string;
