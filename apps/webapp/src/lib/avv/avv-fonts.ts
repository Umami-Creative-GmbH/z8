type FontStore = typeof import("@react-pdf/renderer").Font;

const primaryFamily = "AvvNotoSans";
const fallbackFamily = "AvvDroidSansFallback";

async function loadFont(Font: FontStore, family: string, filename: string) {
	if (!Font.getRegisteredFontFamilies().includes(family)) {
		// The supported download runs in the browser. Node document consumers run
		// from apps/webapp, using the same public assets without a network request.
		const directory =
			typeof window === "undefined"
				? `${process.cwd()}/public/fonts/avv`
				: "/fonts/avv";
		Font.register({ family, src: `${directory}/${filename}` });
	}
	await Font.load({ fontFamily: family });
	const font = Font.getFont({ fontFamily: family }).data;
	if (!font) throw new Error("Could not load the AVV font");
	// Seed Unicode mappings before subsetting can cache composite components
	// without code points (e.g. Latin a inside Cyrillic а). Otherwise a later
	// download can render correctly but lose those letters in extracted text.
	for (const codePoint of font.characterSet) font.glyphForCodePoint(codePoint);
	return font;
}

/** Loaded only on export; fonts are self-hosted and embedded as PDF subsets. */
export async function loadAvvControllerFonts(
	Font: FontStore,
	values: string[],
) {
	const primary = await loadFont(Font, primaryFamily, "NotoSans-Regular.ttf");
	const missing = [...new Set(values.join(""))].filter(
		(character) => !primary.hasGlyphForCodePoint(character.codePointAt(0) ?? 0),
	);
	if (!missing.length) return [primaryFamily];

	const fallback = await loadFont(
		Font,
		fallbackFamily,
		"DroidSansFallbackFull.ttf",
	);
	const unsupported = missing.filter(
		(character) =>
			!fallback.hasGlyphForCodePoint(character.codePointAt(0) ?? 0),
	);
	if (unsupported.length) {
		const codePoints = unsupported
			.slice(0, 8)
			.map(
				(character) =>
					`U+${character.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}`,
			);
		throw new Error(
			`The AVV fonts cannot render ${codePoints.join(", ")}. Your profile has not been changed. Contact support to add font coverage.`,
		);
	}
	return [primaryFamily, fallbackFamily];
}
