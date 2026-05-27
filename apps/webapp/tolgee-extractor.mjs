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
	accessDenied: "common",
	appSearch: "common",
	workBalance: "common",
	colors: "common",
	common: "common",
	employeeSelect: "common",
	generic: "common",
	nav: "common",
	header: "common",
	offline: "common",
	roles: "common",
	status: "common",
	time: "common",
	user: "common",
	table: "common",
	tour: "common",
	validation: "common",
	errors: "common",
	info: "common",
	meta: "common",
	// auth namespace
	auth: "auth",
	profile: "auth",
	sessions: "auth",
	// admin namespace
	admin: "admin",
	analytics: "analytics",
	// approvals namespace
	approvals: "approvals",
	// compliance namespace
	compliance: "compliance",
	// dashboard namespace
	dashboard: "dashboard",
	// calendar namespace
	absences: "calendar",
	calendar: "calendar",
	// timeTracking namespace
	timeTracking: "timeTracking",
	wellness: "timeTracking",
	// reports namespace
	reports: "reports",
	// myRequests namespace
	myRequests: "myRequests",
	// scheduling namespace
	scheduling: "scheduling",
	// setup namespace
	init: "setup",
	setup: "setup",
	// settings namespace
	settings: "settings/generic",
	organization: "organization",
	travelExpenses: "travelExpenses",
	vacation: "settings/generic",
	team: "team",
	today: "today",
	webhooks: "webhooks",
	// onboarding namespace
	onboarding: "onboarding",
	// bot namespace
	bot: "bot",
};

const NESTED_NAMESPACE_PREFIXES = [
	["settings.enterprise.", "settings/enterprise"],
	["settings.enterpriseIdentitySetup.", "settings/enterprise"],
	["settings.branding.", "settings/enterprise"],
	["settings.apiKeys.", "settings/enterprise"],
	["settings.payrollExport.", "settings/payrollExport"],
	["settings.payrollReadiness.", "settings/payrollExport"],
	["settings.scheduledExports.", "settings/scheduledExports"],
	["settings.holidays.", "settings/holidays"],
	["settings.workPolicies.", "settings/workPolicies"],
	["settings.workSchedules.", "settings/workPolicies"],
	["settings.timeRegulations.", "settings/workPolicies"],
	["settings.vacation.", "settings/vacation"],
	["vacation.", "settings/vacation"],
	["settings.auditExport.", "settings/auditExport"],
	["settings.auditLog.", "settings/auditExport"],
	["settings.demo.", "settings/demo"],
	["settings.demoData.", "settings/demo"],
	["settings.surcharges.", "settings/rules"],
	["settings.workCategories.", "settings/rules"],
	["settings.changePolicies.", "settings/rules"],
	["settings.approvalPolicies.", "settings/rules"],
	["settings.absenceCategories.", "settings/rules"],
	["settings.coverageRules.", "settings/rules"],
	["settings.shiftTemplates.", "settings/rules"],
	["settings.employees.", "settings/people"],
	["settings.teams.", "settings/people"],
	["settings.roles.", "settings/people"],
	["settings.permissions.", "settings/people"],
	["settings.inviteCodes.", "settings/people"],
	["settings.pendingMembers.", "settings/people"],
	["settings.employmentHistory.", "settings/people"],
	["settings.employeeGroups.", "settings/people"],
	["settings.managerAssignment.", "settings/people"],
	["settings.skills.", "settings/people"],
	["settings.rateHistory.", "settings/people"],
	["settings.telegram.", "settings/integrations"],
	["settings.slack.", "settings/integrations"],
	["settings.discord.", "settings/integrations"],
	["settings.teamsNotifications.", "settings/integrations"],
	["settings.calendar.", "settings/integrations"],
	["settings.clockodoImport.", "settings/integrations"],
	["settings.clockinImport.", "settings/integrations"],
];

/**
 * Infer namespace from a translation key
 * @param {string} keyName - The full key name (e.g., "settings.employees.title")
 * @returns {string|undefined} - The namespace or undefined for default
 */
function inferNamespace(keyName) {
	if (keyName.startsWith("billing.suspended.") || keyName.startsWith("billing.trialBanner.")) {
		return "common";
	}

	if (keyName.startsWith("billing.")) {
		return "billing";
	}

	for (const [prefix, namespace] of NESTED_NAMESPACE_PREFIXES) {
		if (keyName.startsWith(prefix)) {
			return namespace;
		}
	}

	// Get the top-level prefix (first segment before the dot)
	const firstDot = keyName.indexOf(".");
	const prefix = firstDot > 0 ? keyName.substring(0, firstDot) : keyName;
	return NAMESPACE_PREFIXES[prefix];
}

function resolveKeyAndNamespace(keyName, namespace) {
	let finalKeyName = keyName;
	let finalNamespace = namespace;

	if (keyName.includes(":") && !keyName.startsWith("http")) {
		const colonIndex = keyName.indexOf(":");
		const beforeColon = keyName.substring(0, colonIndex);
		if (!beforeColon.includes(".")) {
			finalNamespace = finalNamespace || beforeColon;
			finalKeyName = keyName.substring(colonIndex + 1);
		}
	}

	return {
		keyName: finalKeyName,
		namespace: finalNamespace || inferNamespace(finalKeyName),
	};
}

/**
 * Check if a key is dynamic (contains template literal interpolation)
 * Dynamic keys like `settings.${category}.label` cannot be statically extracted
 * @param {string} keyName - The key to check
 * @returns {boolean} - True if the key is dynamic
 */
function isDynamicKey(keyName) {
	return keyName.includes("${") || keyName.includes("}");
}

export default function extractor(code, _fileName) {
	const keys = [];
	const warnings = [];

	// Extract translation keys from properties ending in "Key" (e.g. titleKey: "tour.sidebar.title")
	// This runs for ALL files, not just those with translation imports, since these
	// keys are defined in data files and consumed dynamically via t(step.titleKey).
	keys.push(...extractKeyProperties(code));
	keys.push(...extractKeyMappingObjects(code));

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
		// Bot: import { getBotTranslate } from "@/lib/bot-platform/i18n"
		/import\s+\{[^}]*\bgetBotTranslate\b[^}]*\}\s+from\s+["']@\/lib\/bot-platform\/i18n["']/,
	];

	for (const pattern of validImportPatterns) {
		if (pattern.test(code)) {
			hasValidTSource = true;
			break;
		}
	}

	// Also check for T component import
	const hasTComponent =
		/import\s+\{[^}]*\bT\b[^}]*\}\s+from\s+["'](@\/tolgee\/server|@tolgee\/(react|next|web)(\/server)?)["']/.test(
			code,
		);
	const hasNamespacedInjectedTranslator = /\bt\s*\(\s*["'`]teamsBot:/.test(code);

	if (!hasValidTSource && !hasTComponent && !hasNamespacedInjectedTranslator) {
		// No valid translation imports, skip this file
		return { keys, warnings };
	}

	// Extract all t() calls
	keys.push(...extractTCalls(code));

	// Extract all <T> components
	keys.push(...extractTComponents(code));

	return { keys, warnings };
}

/**
 * Get line number for a position in the code
 */
function getLineNumber(code, position) {
	let line = 1;
	for (let i = 0; i < position && i < code.length; i++) {
		if (code[i] === "\n") line++;
	}
	return line;
}

/**
 * Extract a quoted string starting at position, handling the quote type properly
 * Returns { value, endIndex } or null if not a valid string
 */
function extractString(str, startIndex) {
	const quoteChar = str[startIndex];
	if (quoteChar !== '"' && quoteChar !== "'" && quoteChar !== "`") {
		return null;
	}

	let value = "";
	let i = startIndex + 1;

	while (i < str.length) {
		const char = str[i];

		// Handle escape sequences
		if (char === "\\" && i + 1 < str.length) {
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

		let defaultValue;
		let namespace;

		// Check for comma (second argument)
		if (code[pos] === ",") {
			pos++;
			// Skip whitespace
			while (pos < code.length && /\s/.test(code[pos])) pos++;

			// Check if it's a string (simple default) or object
			if (code[pos] === '"' || code[pos] === "'" || code[pos] === "`") {
				const defaultResult = extractString(code, pos);
				if (defaultResult) {
					defaultValue = defaultResult.value;
					pos = defaultResult.endIndex + 1;
				}
			} else if (code[pos] === "{") {
				// Parse object argument for defaultValue and ns
				const objectStart = pos;
				let braceCount = 1;
				pos++;
				while (pos < code.length && braceCount > 0) {
					if (code[pos] === "{") braceCount++;
					else if (code[pos] === "}") braceCount--;
					else if (code[pos] === '"' || code[pos] === "'" || code[pos] === "`") {
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

		const resolved = resolveKeyAndNamespace(keyName, namespace);
		const finalKeyName = resolved.keyName;

		// Skip dynamic keys with template literal interpolation
		if (isDynamicKey(finalKeyName)) {
			i = pos;
			continue;
		}

		results.push({
			keyName: finalKeyName,
			defaultValue,
			namespace: resolved.namespace,
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

	for (let match = tComponentRegex.exec(code); match !== null; match = tComponentRegex.exec(code)) {
		const attrs = match[1];
		const lineNumber = getLineNumber(code, match.index);

		// Extract keyName attribute
		const keyNameMatch = attrs.match(/keyName\s*=\s*(["'`])/);
		if (!keyNameMatch) continue;

		const keyStart = attrs.indexOf(keyNameMatch[0]) + keyNameMatch[0].length - 1;
		const keyResult = extractString(attrs, keyStart);
		if (!keyResult) continue;

		let keyName = keyResult.value;
		let namespace;

		const resolved = resolveKeyAndNamespace(keyName, namespace);
		keyName = resolved.keyName;
		namespace = resolved.namespace;

		// Extract defaultValue attribute
		let defaultValue;
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

		// Skip dynamic keys with template literal interpolation
		if (isDynamicKey(keyName)) {
			continue;
		}

		results.push({
			keyName,
			defaultValue,
			namespace,
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
	const objectPattern =
		/(?:export\s+)?(?:const|let|var)\s+(\w*(?:I18N|KEY|TRANSLATION|i18n|key|translation|Keys|KEYS)\w*)\s*(?::\s*[^=]+)?\s*=\s*\{/g;

	for (let match = objectPattern.exec(code); match !== null; match = objectPattern.exec(code)) {
		const objectStart = objectPattern.lastIndex - 1;
		let pos = objectStart + 1;
		let braceCount = 1;

		while (pos < code.length && braceCount > 0) {
			if (code[pos] === "{") braceCount++;
			else if (code[pos] === "}") braceCount--;
			else if (code[pos] === '"' || code[pos] === "'" || code[pos] === "`") {
				const strResult = extractString(code, pos);
				if (strResult) {
					pos = strResult.endIndex;
				}
			}
			pos++;
		}

		if (braceCount !== 0) continue;

		const objectContent = code.slice(objectStart + 1, pos - 1);
		const lineNumber = getLineNumber(code, match.index);
		objectPattern.lastIndex = pos;

		// Pattern 1: Nested objects with { key: "...", default: "..." }
		const nestedPattern =
			/(\w+)\s*:\s*\{\s*key\s*:\s*["']([a-z][a-z0-9A-Z]*(?::[a-z][a-z0-9A-Z]*)?(?:\.[a-z][a-z0-9A-Z]*)*)["']\s*,\s*(?:default|fallback)\s*:\s*["']([^"']+)["']\s*,?\s*\}/g;

		for (
			let nestedMatch = nestedPattern.exec(objectContent);
			nestedMatch !== null;
			nestedMatch = nestedPattern.exec(objectContent)
		) {
			const keyValue = nestedMatch[2];
			const defaultValue = nestedMatch[3];

			const resolved = resolveKeyAndNamespace(keyValue);

			if (resolved.keyName.includes(".") && !isDynamicKey(resolved.keyName)) {
				results.push({
					keyName: resolved.keyName,
					defaultValue,
					namespace: resolved.namespace,
					line: lineNumber,
				});
			}
		}

		// Pattern 2: Simple string values - key: "value" or "key": "value"
		const valuePattern =
			/["']?(\w+)["']?\s*:\s*["']([a-z][a-z0-9A-Z]*(?::[a-z][a-z0-9A-Z]*)?(?:\.[a-z][a-z0-9A-Z]*)*)["']/g;

		for (
			let valueMatch = valuePattern.exec(objectContent);
			valueMatch !== null;
			valueMatch = valuePattern.exec(objectContent)
		) {
			const keyValue = valueMatch[2];

			// Skip if this looks like it's part of a nested object (key: or default:)
			if (valueMatch[1] === "key" || valueMatch[1] === "default") continue;

			const resolved = resolveKeyAndNamespace(keyValue);

			// Only include if it looks like a translation key (has at least one dot) and is not dynamic
			if (resolved.keyName.includes(".") && !isDynamicKey(resolved.keyName)) {
				// Check if we already added this from nested pattern
				const alreadyAdded = results.some(
					(r) => r.keyName === resolved.keyName && r.line === lineNumber,
				);
				if (!alreadyAdded) {
					results.push({
						keyName: resolved.keyName,
						defaultValue: undefined,
						namespace: resolved.namespace,
						line: lineNumber,
					});
				}
			}
		}
	}

	// Also look for arrays of translation keys
	// Pattern: const KEYS = ["some.key", "another.key"]
	const arrayPattern =
		/(?:export\s+)?(?:const|let|var)\s+(\w*(?:I18N|KEY|TRANSLATION|i18n|key|translation|Keys|KEYS)\w*)\s*(?::\s*[^=]+)?\s*=\s*\[([\s\S]*?)\]/g;

	for (let match = arrayPattern.exec(code); match !== null; match = arrayPattern.exec(code)) {
		const arrayContent = match[2];
		const lineNumber = getLineNumber(code, match.index);

		// Extract all string values
		const stringPattern =
			/["']([a-z][a-z0-9A-Z]*(?::[a-z][a-z0-9A-Z]*)?(?:\.[a-z][a-z0-9A-Z]*)*)["']/g;

		for (
			let stringMatch = stringPattern.exec(arrayContent);
			stringMatch !== null;
			stringMatch = stringPattern.exec(arrayContent)
		) {
			const keyValue = stringMatch[1];

			const resolved = resolveKeyAndNamespace(keyValue);

			if (resolved.keyName.includes(".") && !isDynamicKey(resolved.keyName)) {
				results.push({
					keyName: resolved.keyName,
					defaultValue: undefined,
					namespace: resolved.namespace,
					line: lineNumber,
				});
			}
		}
	}

	return results;
}

/**
 * Extract translation keys from properties whose names end with "Key"
 * (e.g. titleKey: "tour.sidebar.title", descriptionKey: "tour.sidebar.description").
 * This handles data-driven patterns where keys are stored in objects/arrays
 * and later passed to t() dynamically.
 */
function extractKeyProperties(code) {
	const results = [];
	// Match properties like: titleKey: "some.dotted.key" or descriptionKey: 'some.dotted.key'
	const pattern =
		/(\w+Key)\s*:\s*["']([a-z][a-z0-9A-Z]*(?::[a-z][a-z0-9A-Z]*)?(?:\.[a-z][a-z0-9A-Z]*)*)["']/g;

	for (let match = pattern.exec(code); match !== null; match = pattern.exec(code)) {
		const keyValue = match[2];

		// Must have at least one dot to be a translation key
		if (!keyValue.includes(".") || isDynamicKey(keyValue)) continue;

		const resolved = resolveKeyAndNamespace(keyValue);
		const defaultValue = extractAdjacentDefaultValue(code, match.index, match[1]);

		results.push({
			keyName: resolved.keyName,
			defaultValue,
			namespace: resolved.namespace,
			line: getLineNumber(code, match.index),
		});
	}

	return results;
}

function extractAdjacentDefaultValue(code, keyPosition, keyPropertyName) {
	const objectStart = code.lastIndexOf("{", keyPosition);
	if (objectStart < 0) return undefined;

	let pos = objectStart + 1;
	let braceCount = 1;
	while (pos < code.length && braceCount > 0) {
		if (code[pos] === "{") braceCount++;
		else if (code[pos] === "}") braceCount--;
		else if (code[pos] === '"' || code[pos] === "'" || code[pos] === "`") {
			const strResult = extractString(code, pos);
			if (strResult) {
				pos = strResult.endIndex;
			}
		}
		pos++;
	}

	if (braceCount !== 0) return undefined;

	const objectContent = code.slice(objectStart, pos);
	const fallbackPropertyName = `${keyPropertyName.slice(0, -3)}Default`;
	const fallbackMatch = objectContent.match(new RegExp(`${fallbackPropertyName}\\s*:\\s*["']`));
	if (!fallbackMatch) return undefined;

	const fallbackStart = objectContent.indexOf(fallbackMatch[0]) + fallbackMatch[0].length - 1;
	const fallbackResult = extractString(objectContent, fallbackStart);
	return fallbackResult?.value;
}
