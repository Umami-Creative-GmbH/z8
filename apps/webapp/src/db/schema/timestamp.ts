// Drizzle Kit loads schema modules through CommonJS, so keep this database boundary dependency-free.
export function currentTimestamp(): Date {
	return new Date();
}
