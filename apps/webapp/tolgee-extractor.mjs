/**
 * Custom Tolgee extractor for handling:
 * 1. Re-exported getTranslate from @/tolgee/server
 * 2. Re-exported useTranslate from @tolgee/react
 * 3. Parallelized Promise.all patterns
 * 4. Multi-line t() calls
 * 5. i18n key mapping objects
 * 6. Namespace inference from key prefixes
 *
 * @type {import('@tolgee/cli/extractor').Extractor}
 */

// Map of top-level key prefixes to their namespace
// Must match the NAMESPACE_MAP in scripts/split-translations.mjs
const NAMESPACE_PREFIXES = {
	// common namespace
	common: 'common',
	generic: 'common',
	nav: 'common',
	header: 'common',
	user: 'common',
	table: 'common',
	validation: 'common',
	errors: 'common',
	info: 'common',
	meta: 'common',
	// auth namespace
	auth: 'auth',
	profile: 'auth',
	sessions: 'auth',
	// dashboard namespace
	dashboard: 'dashboard',
	// calendar namespace
	absences: 'calendar',
	calendar: 'calendar',
	// timeTracking namespace
	timeTracking: 'timeTracking',
	wellness: 'timeTracking',
	// reports namespace
	reports: 'reports',
	// settings namespace
	settings: 'settings',
	organization: 'settings',
	vacation: 'settings',
	team: 'settings',
	// onboarding namespace
	onboarding: 'onboarding',
};

/**
 * Infer namespace from a translation key
 * @param {string} keyName - The full key name (e.g., "settings.employees.title")
 * @returns {string|undefined} - The namespace or undefined for default
 */
function inferNamespace(keyName) {
	// Get the top-level prefix (first segment before the dot)
	const firstDot = keyName.indexOf('.');
	const prefix = firstDot > 0 ? keyName.substring(0, firstDot) : keyName;
	return NAMESPACE_PREFIXES[prefix];
}

export default function extractor(code, fileName) {
	const keys = [];
	const warnings = [];

	// Track if file has valid t-function sources
	let hasValidTSource = false;

	// Check for imports that provide t-function
	const validImportPatterns = [
		// Server: import { getTranslate } from "@/tolgee/server"
		/import\s+\{[^}]*\bgetTranslate\b[^}]*\}\s+from\s+["']@\/tolgee\/server["']/,
		// Client: import { useTranslate } from "@tolgee/react"
		/import\s+\{[^}]*\buseTranslate\b[^}]*\}\s+from\s+["']@tolgee\/react["']/,
		// Direct SDK imports (fallback)
		/import\s+\{[^}]*\b(getTranslate|useTranslate)\b[^}]*\}\s+from\s+["']@tolgee\/(react|next|web)(\/server)?["']/,
	];

	for (const pattern of validImportPatterns) {
		if (pattern.test(code)) {
			hasValidTSource = true;
			break;
		}
	}

	// Also check for T component import
	const hasTComponent = /import\s+\{[^}]*\bT\b[^}]*\}\s+from\s+["'](@\/tolgee\/server|@tolgee\/(react|next|web)(\/server)?)["']/.test(code);

	if (!hasValidTSource && !hasTComponent) {
		// No valid translation imports, skip this file
		return { keys, warnings };
	}

	// Extract all t() calls
	keys.push(...extractTCalls(code));

	// Extract all <T> components
	keys.push(...extractTComponents(code));

	// Extract keys from i18n key mapping objects
	keys.push(...extractKeyMappingObjects(code));

	return { keys, warnings };
}

/**
 * Get line number for a position in the code
 */
function getLineNumber(code, position) {
	let line = 1;
	for (let i = 0; i < position && i < code.length; i++) {
		if (code[i] === '\n') line++;
	}
	return line;
}

/**
 * Extract a quoted string starting at position, handling the quote type properly
 * Returns { value, endIndex } or null if not a valid string
 */
function extractString(str, startIndex) {
	const quoteChar = str[startIndex];
	if (quoteChar !== '"' && quoteChar !== "'" && quoteChar !== '`') {
		return null;
	}

	let value = '';
	let i = startIndex + 1;

	while (i < str.length) {
		const char = str[i];

		// Handle escape sequences
		if (char === '\\' && i + 1 < str.length) {
			value += str[i + 1];
			i += 2;
			continue;
		}

		// End of string
		if (char === quoteChar) {
			return { value, endIndex: i };
		}

		value += char;
		i++;
	}

	return null; // Unterminated string
}

/**
 * Parse t() function calls from the entire code (handles multi-line)
 */
function extractTCalls(code) {
	const results = [];
	let i = 0;

	while (i < code.length) {
		// Find 't(' pattern (with word boundary check)
		const tMatch = code.slice(i).match(/\bt\s*\(/);
		if (!tMatch) break;

		const tStart = i + tMatch.index;
		const lineNumber = getLineNumber(code, tStart);
		let pos = tStart + tMatch[0].length;

		// Skip whitespace (including newlines)
		while (pos < code.length && /\s/.test(code[pos])) pos++;

		// Extract key name (first argument)
		const keyResult = extractString(code, pos);
		if (!keyResult) {
			i = tStart + 1;
			continue;
		}

		const keyName = keyResult.value;
		pos = keyResult.endIndex + 1;

		// Skip whitespace
		while (pos < code.length && /\s/.test(code[pos])) pos++;

		let defaultValue = undefined;
		let namespace = undefined;

		// Check for comma (second argument)
		if (code[pos] === ',') {
			pos++;
			// Skip whitespace
			while (pos < code.length && /\s/.test(code[pos])) pos++;

			// Check if it's a string (simple default) or object
			if (code[pos] === '"' || code[pos] === "'" || code[pos] === '`') {
				const defaultResult = extractString(code, pos);
				if (defaultResult) {
					defaultValue = defaultResult.value;
					pos = defaultResult.endIndex + 1;
				}
			} else if (code[pos] === '{') {
				// Parse object argument for defaultValue and ns
				const objectStart = pos;
				let braceCount = 1;
				pos++;
				while (pos < code.length && braceCount > 0) {
					if (code[pos] === '{') braceCount++;
					else if (code[pos] === '}') braceCount--;
					else if (code[pos] === '"' || code[pos] === "'" || code[pos] === '`') {
						// Skip over strings inside the object to avoid counting braces in strings
						const strResult = extractString(code, pos);
						if (strResult) {
							pos = strResult.endIndex;
						}
					}
					pos++;
				}
				const objectStr = code.slice(objectStart, pos);

				// Extract defaultValue from object
				const defaultMatch = objectStr.match(/defaultValue\s*:\s*(["'`])/);
				if (defaultMatch) {
					const defaultStart = objectStr.indexOf(defaultMatch[0]) + defaultMatch[0].length - 1;
					const defaultResult = extractString(objectStr, defaultStart);
					if (defaultResult) {
						defaultValue = defaultResult.value;
					}
				}

				// Extract namespace from object
				const nsMatch = objectStr.match(/ns\s*:\s*(["'`])/);
				if (nsMatch) {
					const nsStart = objectStr.indexOf(nsMatch[0]) + nsMatch[0].length - 1;
					const nsResult = extractString(objectStr, nsStart);
					if (nsResult) {
						namespace = nsResult.value;
					}
				}
			}
		}

		// Handle namespace:key format
		let finalKeyName = keyName;
		if (keyName.includes(':') && !keyName.startsWith('http')) {
			const colonIndex = keyName.indexOf(':');
			// Only treat as namespace if it looks like a namespace (no dots before colon)
			const beforeColon = keyName.substring(0, colonIndex);
			if (!beforeColon.includes('.')) {
				namespace = namespace || beforeColon;
				finalKeyName = keyName.substring(colonIndex + 1);
			}
		}

		// If namespace not explicitly set, infer from key prefix
		const finalNamespace = namespace || inferNamespace(finalKeyName);

		results.push({
			keyName: finalKeyName,
			defaultValue,
			namespace: finalNamespace,
			line: lineNumber,
		});

		i = pos;
	}

	return results;
}

/**
 * Parse <T> component calls from the entire code (handles multi-line)
 */
function extractTComponents(code) {
	const results = [];

	// Match <T with attributes, handling multi-line
	const tComponentRegex = /<T\s+([\s\S]*?)(?:\/>|>)/g;

	let match;
	while ((match = tComponentRegex.exec(code)) !== null) {
		const attrs = match[1];
		const lineNumber = getLineNumber(code, match.index);

		// Extract keyName attribute
		const keyNameMatch = attrs.match(/keyName\s*=\s*(["'`])/);
		if (!keyNameMatch) continue;

		const keyStart = attrs.indexOf(keyNameMatch[0]) + keyNameMatch[0].length - 1;
		const keyResult = extractString(attrs, keyStart);
		if (!keyResult) continue;

		let keyName = keyResult.value;
		let namespace = undefined;

		// Handle namespace:key format
		if (keyName.includes(':') && !keyName.startsWith('http')) {
			const colonIndex = keyName.indexOf(':');
			const beforeColon = keyName.substring(0, colonIndex);
			if (!beforeColon.includes('.')) {
				namespace = beforeColon;
				keyName = keyName.substring(colonIndex + 1);
			}
		}

		// Extract defaultValue attribute
		let defaultValue = undefined;
		const defaultMatch = attrs.match(/defaultValue\s*=\s*(["'`])/);
		if (defaultMatch) {
			const defaultStart = attrs.indexOf(defaultMatch[0]) + defaultMatch[0].length - 1;
			const defaultResult = extractString(attrs, defaultStart);
			if (defaultResult) {
				defaultValue = defaultResult.value;
			}
		}

		// Extract ns attribute
		const nsMatch = attrs.match(/ns\s*=\s*(["'`])/);
		if (nsMatch) {
			const nsStart = attrs.indexOf(nsMatch[0]) + nsMatch[0].length - 1;
			const nsResult = extractString(attrs, nsStart);
			if (nsResult) {
				namespace = nsResult.value;
			}
		}

		// If namespace not explicitly set, infer from key prefix
		const finalNamespace = namespace || inferNamespace(keyName);

		results.push({
			keyName,
			defaultValue,
			namespace: finalNamespace,
			line: lineNumber,
		});
	}

	return results;
}

/**
 * Extract translation keys from i18n key mapping objects
 * Detects patterns like:
 *   const STEP_I18N_KEYS = { foo: "some.translation.key", bar: "another.key" }
 *   const STEP_I18N_KEYS = { foo: { key: "some.key", default: "Default" } }
 *
 * Heuristics:
 * - Variable name contains I18N, KEY, TRANSLATION, etc.
 * - Values look like translation keys (lowercase with dots)
 */
function extractKeyMappingObjects(code) {
	const results = [];

	// Match objects that are likely i18n key maps
	// Look for: variable assignment followed by object with string values
	const objectPattern = /(?:const|let|var)\s+(\w*(?:I18N|KEY|TRANSLATION|i18n|key|translation|Keys|KEYS)\w*)\s*(?::\s*[^=]+)?\s*=\s*\{([\s\S]*?)\};/g;

	let match;
	while ((match = objectPattern.exec(code)) !== null) {
		const objectContent = match[2];
		const lineNumber = getLineNumber(code, match.index);

		// Pattern 1: Nested objects with { key: "...", default: "..." }
		const nestedPattern = /(\w+)\s*:\s*\{\s*key\s*:\s*["']([a-z][a-z0-9]*(?:\.[a-z][a-z0-9A-Z]*)*)["']\s*,\s*default\s*:\s*["']([^"']+)["']\s*\}/g;

		let nestedMatch;
		while ((nestedMatch = nestedPattern.exec(objectContent)) !== null) {
			const keyValue = nestedMatch[2];
			const defaultValue = nestedMatch[3];

			if (keyValue.includes('.')) {
				results.push({
					keyName: keyValue,
					defaultValue,
					namespace: inferNamespace(keyValue),
					line: lineNumber,
				});
			}
		}

		// Pattern 2: Simple string values - key: "value" or "key": "value"
		const valuePattern = /["']?(\w+)["']?\s*:\s*["']([a-z][a-z0-9]*(?:\.[a-z][a-z0-9A-Z]*)*)["']/g;

		let valueMatch;
		while ((valueMatch = valuePattern.exec(objectContent)) !== null) {
			const keyValue = valueMatch[2];

			// Skip if this looks like it's part of a nested object (key: or default:)
			if (valueMatch[1] === 'key' || valueMatch[1] === 'default') continue;

			// Only include if it looks like a translation key (has at least one dot)
			if (keyValue.includes('.')) {
				// Check if we already added this from nested pattern
				const alreadyAdded = results.some(r => r.keyName === keyValue && r.line === lineNumber);
				if (!alreadyAdded) {
					results.push({
						keyName: keyValue,
						defaultValue: undefined,
						namespace: inferNamespace(keyValue),
						line: lineNumber,
					});
				}
			}
		}
	}

	// Also look for arrays of translation keys
	// Pattern: const KEYS = ["some.key", "another.key"]
	const arrayPattern = /(?:const|let|var)\s+(\w*(?:I18N|KEY|TRANSLATION|i18n|key|translation|Keys|KEYS)\w*)\s*(?::\s*[^=]+)?\s*=\s*\[([\s\S]*?)\]/g;

	while ((match = arrayPattern.exec(code)) !== null) {
		const arrayContent = match[2];
		const lineNumber = getLineNumber(code, match.index);

		// Extract all string values
		const stringPattern = /["']([a-z][a-z0-9]*(?:\.[a-z][a-z0-9A-Z]*)*)["']/g;

		let stringMatch;
		while ((stringMatch = stringPattern.exec(arrayContent)) !== null) {
			const keyValue = stringMatch[1];

			if (keyValue.includes('.')) {
				results.push({
					keyName: keyValue,
					defaultValue: undefined,
					namespace: inferNamespace(keyValue),
					line: lineNumber,
				});
			}
		}
	}

	return results;
}
