import type { DocumentCategory } from "./document.types";

/**
 * Entry names of a personnel file ZIP (#871): `<category>/<document date>_<title>.<ext>`.
 * Titles are made safe for every common file system and can never leave their
 * category folder; names that would collide (ignoring letter case, as Windows
 * and macOS do) get a ` (2)`, ` (3)`, ... suffix in input order.
 */

export interface ZipEntryDocument {
	category: DocumentCategory;
	title: string;
	documentDate: string;
	mimeType: string;
	fileName: string;
}

const MAX_TITLE_LENGTH = 120;
const FALLBACK_TITLE = "document";

const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
	"application/pdf": "pdf",
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
};

function safeTitle(title: string): string {
	const cleaned = title
		// Control characters become spaces; path separators and reserved characters underscores.
		// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is removed.
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replace(/[/\\:*?"<>|]/g, "_")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, MAX_TITLE_LENGTH)
		// Windows drops trailing dots and spaces.
		.replace(/[. ]+$/, "");
	return cleaned || FALLBACK_TITLE;
}

function extensionOf(document: ZipEntryDocument): string | null {
	const known = EXTENSION_BY_MIME[document.mimeType.toLowerCase()];
	if (known) return known;
	const match = /\.([A-Za-z0-9]{1,10})$/.exec(document.fileName);
	return match?.[1] ? match[1].toLowerCase() : null;
}

/** The download name of an employee's personnel file ZIP. */
export function personnelFileZipFileName(employeeName: string): string {
	return `personnel-file_${safeTitle(employeeName)}.zip`;
}

export function personnelFileZipEntryNames(documents: readonly ZipEntryDocument[]): string[] {
	const taken = new Set<string>();
	return documents.map((document) => {
		const base = `${document.category}/${document.documentDate}_${safeTitle(document.title)}`;
		const extension = extensionOf(document);
		const withExtension = (stem: string) => (extension ? `${stem}.${extension}` : stem);
		let name = withExtension(base);
		for (let attempt = 2; taken.has(name.toLowerCase()); attempt += 1) {
			name = withExtension(`${base} (${attempt})`);
		}
		taken.add(name.toLowerCase());
		return name;
	});
}
