import ts from "typescript";

export type ApprovalWriteOperation = "insert" | "update" | "delete";

export const PROTECTED_APPROVAL_TABLES = [
	"approval_request",
	"approval_chain_instance",
	"approval_chain_stage_instance",
	"approval_workflow",
	"approval_workflow_stage",
	"approval_stage_assignment",
	"approval_workflow_event",
	"approval_workflow_command",
	"approval_requester_projection",
	"approval_inbox_projection",
	"approval_outbox",
	"approval_outbox_delivery",
	"approval_workflow_rollout",
	"approval_workflow_migration_issue",
] as const;

export type ProtectedApprovalTable = (typeof PROTECTED_APPROVAL_TABLES)[number];

export const TARGETED_APPROVAL_SOURCE_TABLES = [
	"time_entry",
	"work_period",
	"time_record",
	"time_record_work",
	"time_record_allocation",
] as const;
export type TargetedApprovalSourceTable =
	(typeof TARGETED_APPROVAL_SOURCE_TABLES)[number];
export type ProtectedWriteTable =
	| ProtectedApprovalTable
	| TargetedApprovalSourceTable;
export type ApprovalSourceMutationSemantic =
	| "correction"
	| "correction_lifecycle"
	| "inactive_correction"
	| "ordinary_finalization"
	| "policy_clock_out_terminal_break"
	| "synthetic_time_entry";
export type ApprovalSourceMutationUncertainty =
	| "dynamic_payload"
	| "dynamic_sql";

export interface ApprovalTableMutation {
	columns?: readonly string[];
	operation: ApprovalWriteOperation;
	semantic?: ApprovalSourceMutationSemantic;
	table: ProtectedWriteTable;
	uncertainty?: ApprovalSourceMutationUncertainty;
}

export interface ApprovalSqlTableMutation extends ApprovalTableMutation {
	offset: number;
}

export type ApprovalWriteBoundaryAnalysisLimit =
	| "constant_evaluator_output_length"
	| "constant_evaluator_work"
	| "constant_evaluator_depth"
	| "sql_command_depth"
	| "sql_statement_count"
	| "sql_text_length"
	| "sql_token_count"
	| "template_expanded_sql_length"
	| "template_variant_count"
	| "typescript_helper_call_count"
	| "typescript_helper_propagation_iterations"
	| "typescript_reaching_write_count";

export class ApprovalWriteBoundaryAnalysisLimitError extends Error {
	readonly code = "APPROVAL_WRITE_BOUNDARY_ANALYSIS_LIMIT";

	constructor(readonly limit: ApprovalWriteBoundaryAnalysisLimit) {
		super(`Approval write boundary analysis limit exceeded: ${limit}`);
		this.name = "ApprovalWriteBoundaryAnalysisLimitError";
	}
}

interface SqlToken {
	kind: "identifier" | "punctuation";
	quoted: boolean;
	start: number;
	text: string;
}

const PROTECTED_TABLE_SET = new Set<string>(PROTECTED_APPROVAL_TABLES);
const TIME_ENTRY_LIFECYCLE_COLUMNS = new Set([
	"is_superseded",
	"replaces_entry_id",
	"superseded_by_id",
]);
const WORK_PERIOD_APPROVAL_COLUMNS = new Set([
	"approval_status",
	"pending_changes",
	"approval_workflow_id",
	"canonical_record_id",
	"clock_in_id",
	"clock_out_id",
	"start_time",
	"end_time",
	"duration_minutes",
]);
const TIME_RECORD_APPROVAL_COLUMNS = new Set([
	"approval_state",
	"employee_id",
	"organization_id",
	"start_at",
	"end_at",
	"duration_minutes",
]);
const SYNTHETIC_TIME_ENTRY_COLUMNS = [
	"created_by",
	"hash",
	"previous_entry_id",
	"previous_hash",
	"timestamp",
	"timezone",
	"timezone_source",
	"type",
	"utc_offset_minutes",
] as const;
const MAX_SQL_COMMAND_NESTING = 64;
const MAX_SQL_STATEMENTS = 1_024;
const MAX_SQL_TEXT_LENGTH = 1_000_000;
const MAX_SQL_TOKENS = 100_000;
export const APPROVAL_DYNAMIC_SQL_MARKER = "__dynamic_expression__";

function isWhitespace(character: string | undefined): boolean {
	return character !== undefined && /[ \t\n\r\f\v]/.test(character);
}

function isIdentifierStart(character: string | undefined): boolean {
	return (
		character !== undefined &&
		(/[A-Za-z_]/.test(character) || (character.codePointAt(0) ?? 0) >= 0x80)
	);
}

function isIdentifierPart(character: string | undefined): boolean {
	return (
		character !== undefined &&
		(/[A-Za-z0-9_$]/.test(character) || (character.codePointAt(0) ?? 0) >= 0x80)
	);
}

function characterAt(text: string, position: number): string | undefined {
	const codePoint = text.codePointAt(position);
	return codePoint === undefined ? undefined : String.fromCodePoint(codePoint);
}

function decodeUnicodeIdentifier(
	text: string,
	escapeCharacter: string,
): string | null {
	let decoded = "";
	let position = 0;
	while (position < text.length) {
		if (!text.startsWith(escapeCharacter, position)) {
			const character = characterAt(text, position);
			if (character === undefined) break;
			decoded += character;
			position += character.length;
			continue;
		}
		const markerPosition = position + escapeCharacter.length;
		if (text.startsWith(escapeCharacter, markerPosition)) {
			decoded += escapeCharacter;
			position = markerPosition + escapeCharacter.length;
			continue;
		}
		const isLongEscape = text[markerPosition] === "+";
		const digitStart = markerPosition + (isLongEscape ? 1 : 0);
		const digitCount = isLongEscape ? 6 : 4;
		const digits = text.slice(digitStart, digitStart + digitCount);
		if (digits.length !== digitCount || !/^[0-9A-Fa-f]+$/.test(digits))
			return null;
		const codePoint = Number.parseInt(digits, 16);
		position = digitStart + digitCount;
		if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
			if (!text.startsWith(escapeCharacter, position)) return null;
			const lowMarkerPosition = position + escapeCharacter.length;
			const isLongLowEscape = text[lowMarkerPosition] === "+";
			const lowDigitStart = lowMarkerPosition + (isLongLowEscape ? 1 : 0);
			const lowDigitCount = isLongLowEscape ? 6 : 4;
			const lowDigits = text.slice(
				lowDigitStart,
				lowDigitStart + lowDigitCount,
			);
			if (
				lowDigits.length !== lowDigitCount ||
				!/^[0-9A-Fa-f]+$/.test(lowDigits)
			)
				return null;
			const lowSurrogate = Number.parseInt(lowDigits, 16);
			if (lowSurrogate < 0xdc00 || lowSurrogate > 0xdfff) return null;
			decoded += String.fromCodePoint(
				0x10000 + ((codePoint - 0xd800) << 10) + (lowSurrogate - 0xdc00),
			);
			position = lowDigitStart + lowDigitCount;
			continue;
		}
		if (
			codePoint === 0 ||
			codePoint > 0x10ffff ||
			(codePoint >= 0xd800 && codePoint <= 0xdfff)
		) {
			return null;
		}
		decoded += String.fromCodePoint(codePoint);
	}
	return decoded;
}

function readQuotedText(
	sqlText: string,
	quotePosition: number,
): { end: number; text: string } {
	let position = quotePosition + 1;
	let text = "";
	while (position < sqlText.length) {
		if (sqlText[position] === '"' && sqlText[position + 1] === '"') {
			text += '"';
			position += 2;
			continue;
		}
		if (sqlText[position] === '"') return { end: position + 1, text };
		text += sqlText[position];
		position += 1;
	}
	return { end: position, text };
}

function skipSqlTrivia(sqlText: string, start: number): number {
	let position = start;
	while (position < sqlText.length) {
		if (isWhitespace(sqlText[position])) {
			position += 1;
			continue;
		}
		if (sqlText[position] === "-" && sqlText[position + 1] === "-") {
			position += 2;
			while (
				position < sqlText.length &&
				sqlText[position] !== "\n" &&
				sqlText[position] !== "\r"
			) {
				position += 1;
			}
			continue;
		}
		if (sqlText[position] === "/" && sqlText[position + 1] === "*") {
			position += 2;
			let depth = 1;
			while (position < sqlText.length && depth > 0) {
				if (sqlText[position] === "/" && sqlText[position + 1] === "*") {
					depth += 1;
					position += 2;
				} else if (sqlText[position] === "*" && sqlText[position + 1] === "/") {
					depth -= 1;
					position += 2;
				} else position += 1;
			}
			continue;
		}
		break;
	}
	return position;
}

function unicodeEscapeClauseAt(
	sqlText: string,
	start: number,
): { end: number; escapeCharacter: string | null } | null {
	const keywordPosition = skipSqlTrivia(sqlText, start);
	const keyword = sqlText.slice(keywordPosition, keywordPosition + 7);
	if (
		keyword.toLowerCase() !== "uescape" ||
		isIdentifierPart(characterAt(sqlText, keywordPosition + keyword.length))
	) {
		return null;
	}
	let position = skipSqlTrivia(sqlText, keywordPosition + keyword.length);
	if (sqlText[position] !== "'")
		return { end: position, escapeCharacter: null };
	position += 1;
	let escapeCharacter = "";
	while (position < sqlText.length && sqlText[position] !== "'") {
		escapeCharacter += sqlText[position];
		position += 1;
	}
	if (sqlText[position] === "'") position += 1;
	const prohibited =
		/[0-9A-Fa-f+'"]/.test(escapeCharacter) || isWhitespace(escapeCharacter);
	return [...escapeCharacter].length === 1 && !prohibited
		? { end: position, escapeCharacter }
		: { end: position, escapeCharacter: null };
}

function dollarDelimiterAt(sqlText: string, position: number): string | null {
	if (sqlText[position] !== "$") return null;
	let end = position + 1;
	if (sqlText[end] === "$") return "$$";
	let character = characterAt(sqlText, end);
	if (!isIdentifierStart(character)) return null;
	end += character?.length ?? 0;
	character = characterAt(sqlText, end);
	while (
		character !== undefined &&
		character !== "$" &&
		isIdentifierPart(character)
	) {
		end += character.length;
		character = characterAt(sqlText, end);
	}
	return sqlText[end] === "$" ? sqlText.slice(position, end + 1) : null;
}

function pushToken(tokens: SqlToken[], token: SqlToken): void {
	if (tokens.length >= MAX_SQL_TOKENS) {
		throw new ApprovalWriteBoundaryAnalysisLimitError("sql_token_count");
	}
	tokens.push(token);
}

function tokenizeSql(sqlText: string): SqlToken[] {
	const tokens: SqlToken[] = [];
	let position = 0;
	while (position < sqlText.length) {
		const character = sqlText[position];
		const next = sqlText[position + 1];
		if (isWhitespace(character)) {
			position += 1;
			continue;
		}
		if (character === "-" && next === "-") {
			position += 2;
			while (
				position < sqlText.length &&
				!/\r|\n/.test(sqlText[position] ?? "")
			) {
				position += 1;
			}
			continue;
		}
		if (character === "/" && next === "*") {
			position += 2;
			let depth = 1;
			while (position < sqlText.length && depth > 0) {
				if (sqlText[position] === "/" && sqlText[position + 1] === "*") {
					depth += 1;
					position += 2;
				} else if (sqlText[position] === "*" && sqlText[position + 1] === "/") {
					depth -= 1;
					position += 2;
				} else {
					position += 1;
				}
			}
			continue;
		}
		const unicodeQuotedIdentifier =
			(character === "U" || character === "u") &&
			next === "&" &&
			sqlText[position + 2] === '"';
		if (unicodeQuotedIdentifier) {
			const start = position;
			const quoted = readQuotedText(sqlText, position + 2);
			const escapeClause = unicodeEscapeClauseAt(sqlText, quoted.end);
			const escapeCharacter = escapeClause
				? escapeClause.escapeCharacter
				: "\\";
			const decoded =
				escapeCharacter === null
					? null
					: decodeUnicodeIdentifier(quoted.text, escapeCharacter);
			pushToken(
				tokens,
				decoded === null
					? {
							kind: "punctuation",
							quoted: false,
							start,
							text: "invalid_unicode_identifier",
						}
					: { kind: "identifier", quoted: true, start, text: decoded },
			);
			position = escapeClause?.end ?? quoted.end;
			continue;
		}
		const escapeString =
			(character === "E" || character === "e") && next === "'";
		if (character === "'" || escapeString) {
			const start = position;
			if (escapeString) position += 1;
			position += 1;
			while (position < sqlText.length) {
				if (escapeString && sqlText[position] === "\\") {
					position = Math.min(position + 2, sqlText.length);
				} else if (sqlText[position] === "'" && sqlText[position + 1] === "'") {
					position += 2;
				} else if (sqlText[position] === "'") {
					position += 1;
					break;
				} else {
					position += 1;
				}
			}
			pushToken(tokens, {
				kind: "punctuation",
				quoted: false,
				start,
				text: "literal",
			});
			continue;
		}
		const dollarDelimiter = dollarDelimiterAt(sqlText, position);
		if (dollarDelimiter) {
			const start = position;
			const closing = sqlText.indexOf(
				dollarDelimiter,
				position + dollarDelimiter.length,
			);
			position =
				closing === -1 ? sqlText.length : closing + dollarDelimiter.length;
			pushToken(tokens, {
				kind: "punctuation",
				quoted: false,
				start,
				text: "literal",
			});
			continue;
		}
		if (character === '"') {
			const start = position;
			position += 1;
			let text = "";
			while (position < sqlText.length) {
				if (sqlText[position] === '"' && sqlText[position + 1] === '"') {
					text += '"';
					position += 2;
				} else if (sqlText[position] === '"') {
					position += 1;
					break;
				} else {
					text += sqlText[position];
					position += 1;
				}
			}
			pushToken(tokens, { kind: "identifier", quoted: true, start, text });
			continue;
		}
		const identifierStart = characterAt(sqlText, position);
		if (isIdentifierStart(identifierStart)) {
			const start = position;
			position += identifierStart?.length ?? 0;
			let part = characterAt(sqlText, position);
			while (isIdentifierPart(part)) {
				position += part?.length ?? 0;
				part = characterAt(sqlText, position);
			}
			pushToken(tokens, {
				kind: "identifier",
				quoted: false,
				start,
				text: sqlText.slice(start, position).toLowerCase(),
			});
			continue;
		}
		pushToken(tokens, {
			kind: "punctuation",
			quoted: false,
			start: position,
			text: character ?? "",
		});
		position += 1;
	}
	return tokens;
}

function isKeyword(token: SqlToken | undefined, keyword: string): boolean {
	return (
		token?.kind === "identifier" && !token.quoted && token.text === keyword
	);
}

function punctuationAt(
	tokens: SqlToken[],
	position: number,
	value: string,
): boolean {
	return (
		tokens[position]?.kind === "punctuation" && tokens[position]?.text === value
	);
}

function matchingParenthesis(
	tokens: SqlToken[],
	open: number,
	end: number,
): number | null {
	let depth = 0;
	for (let position = open; position < end; position += 1) {
		if (punctuationAt(tokens, position, "(")) depth += 1;
		if (punctuationAt(tokens, position, ")") && --depth === 0) return position;
	}
	return null;
}

function explainExecutionTarget(
	tokens: SqlToken[],
	start: number,
	end: number,
): number | null {
	let position = start + 1;
	let analyzes = false;
	if (punctuationAt(tokens, position, "(")) {
		const optionsEnd = matchingParenthesis(tokens, position, end);
		if (optionsEnd === null) return null;
		for (position += 1; position < optionsEnd; position += 1) {
			if (
				!isKeyword(tokens[position], "analyze") &&
				!isKeyword(tokens[position], "analyse")
			) {
				continue;
			}
			const value = tokens[position + 1];
			analyzes =
				punctuationAt(tokens, position + 1, ",") ||
				position + 1 === optionsEnd ||
				(!isKeyword(value, "false") &&
					!isKeyword(value, "off") &&
					!isKeyword(value, "no") &&
					value?.text !== "0");
		}
		return analyzes ? optionsEnd + 1 : null;
	}
	while (
		isKeyword(tokens[position], "analyze") ||
		isKeyword(tokens[position], "analyse") ||
		isKeyword(tokens[position], "verbose")
	) {
		if (
			isKeyword(tokens[position], "analyze") ||
			isKeyword(tokens[position], "analyse")
		) {
			analyzes = true;
		}
		position += 1;
	}
	return analyzes ? position : null;
}

function cteSuffixEnd(
	tokens: SqlToken[],
	start: number,
	end: number,
): number | null {
	let position = start;
	if (isKeyword(tokens[position], "search")) {
		position += 1;
		if (
			!isKeyword(tokens[position], "breadth") &&
			!isKeyword(tokens[position], "depth")
		)
			return null;
		position += 1;
		if (!isKeyword(tokens[position], "first")) return null;
		position += 1;
		if (!isKeyword(tokens[position], "by")) return null;
		position += 1;
		let sawColumn = false;
		while (position < end && !isKeyword(tokens[position], "set")) {
			if (tokens[position]?.kind === "identifier") sawColumn = true;
			else if (!punctuationAt(tokens, position, ",")) return null;
			position += 1;
		}
		if (!sawColumn || !isKeyword(tokens[position], "set")) return null;
		position += 1;
		if (tokens[position]?.kind !== "identifier") return null;
		position += 1;
	}
	if (isKeyword(tokens[position], "cycle")) {
		position += 1;
		let sawColumn = false;
		while (position < end && !isKeyword(tokens[position], "set")) {
			if (tokens[position]?.kind === "identifier") sawColumn = true;
			else if (!punctuationAt(tokens, position, ",")) return null;
			position += 1;
		}
		if (!sawColumn || !isKeyword(tokens[position], "set")) return null;
		position += 1;
		if (tokens[position]?.kind !== "identifier") return null;
		position += 1;
		while (position < end && !isKeyword(tokens[position], "using"))
			position += 1;
		if (!isKeyword(tokens[position], "using")) return null;
		position += 1;
		if (tokens[position]?.kind !== "identifier") return null;
		position += 1;
	}
	return position;
}

function tableAt(
	tokens: SqlToken[],
	start: number,
): { end: number; table: ProtectedApprovalTable | null } | null {
	const first = tokens[start];
	if (first?.kind !== "identifier") return null;
	if (first.text === APPROVAL_DYNAMIC_SQL_MARKER) {
		throw new Error("Approval write boundary dynamic SQL mutation target");
	}
	const qualified =
		punctuationAt(tokens, start + 1, ".") &&
		tokens[start + 2]?.kind === "identifier";
	const token = qualified ? tokens[start + 2] : first;
	if (token.text === APPROVAL_DYNAMIC_SQL_MARKER) {
		throw new Error("Approval write boundary dynamic SQL mutation target");
	}
	const table = PROTECTED_TABLE_SET.has(token.text)
		? (token.text as ProtectedApprovalTable)
		: null;
	return { end: qualified ? start + 3 : start + 1, table };
}

function sourceTableAt(
	tokens: SqlToken[],
	start: number,
): { end: number; table: TargetedApprovalSourceTable | null } | null {
	const first = tokens[start];
	if (first?.kind !== "identifier") return null;
	if (first.text === APPROVAL_DYNAMIC_SQL_MARKER) {
		throw new Error("Approval write boundary dynamic SQL mutation target");
	}
	const qualified =
		punctuationAt(tokens, start + 1, ".") &&
		tokens[start + 2]?.kind === "identifier";
	const token = qualified ? tokens[start + 2] : first;
	if (token.text === APPROVAL_DYNAMIC_SQL_MARKER) {
		throw new Error("Approval write boundary dynamic SQL mutation target");
	}
	const table = TARGETED_APPROVAL_SOURCE_TABLES.includes(
		token.text as TargetedApprovalSourceTable,
	)
		? (token.text as TargetedApprovalSourceTable)
		: null;
	return { end: qualified ? start + 3 : start + 1, table };
}

function commaSeparatedIdentifiers(
	tokens: SqlToken[],
	start: number,
	end: number,
): string[] | null {
	const columns: string[] = [];
	let position = start;
	while (position < end) {
		const token = tokens[position];
		if (token?.kind !== "identifier") return null;
		columns.push(token.text);
		position += 1;
		if (position === end) break;
		if (!punctuationAt(tokens, position, ",")) return null;
		position += 1;
	}
	return columns;
}

function targetedColumns(
	table: TargetedApprovalSourceTable,
	columns: readonly string[],
): string[] {
	const protectedColumns =
		table === "work_period"
			? columns.filter((column) => WORK_PERIOD_APPROVAL_COLUMNS.has(column))
			: table === "time_entry"
				? columns.filter(
						(column) =>
							column === "type" || TIME_ENTRY_LIFECYCLE_COLUMNS.has(column),
					)
				: table === "time_record"
					? columns.filter((column) => TIME_RECORD_APPROVAL_COLUMNS.has(column))
					: columns;
	return [...new Set(protectedColumns)].sort();
}

function inspectTargetedSourceSqlMutations(
	sqlText: string,
	tokens: SqlToken[],
): ApprovalSqlTableMutation[] {
	const mutations: ApprovalSqlTableMutation[] = [];
	for (let start = 0; start < tokens.length; start += 1) {
		let operation: "delete" | "insert" | "update" | null = null;
		let targetStart = start + 1;
		if (
			isKeyword(tokens[start], "insert") &&
			isKeyword(tokens[start + 1], "into")
		) {
			operation = "insert";
			targetStart = start + 2;
		} else if (isKeyword(tokens[start], "update")) {
			operation = "update";
		} else if (
			isKeyword(tokens[start], "delete") &&
			isKeyword(tokens[start + 1], "from")
		) {
			operation = "delete";
			targetStart = start + 2;
		} else continue;
		if (isKeyword(tokens[targetStart], "only")) targetStart += 1;
		const target = sourceTableAt(tokens, targetStart);
		if (!target?.table) continue;

		if (operation === "insert") {
			if (!punctuationAt(tokens, target.end, "(")) continue;
			const columnsEnd = matchingParenthesis(tokens, target.end, tokens.length);
			if (columnsEnd === null) continue;
			const columns = commaSeparatedIdentifiers(
				tokens,
				target.end + 1,
				columnsEnd,
			);
			if (!columns || !isKeyword(tokens[columnsEnd + 1], "values")) continue;
			const columnSet = new Set(columns);
			const dynamicColumns = columnSet.has(APPROVAL_DYNAMIC_SQL_MARKER);
			const protectedColumns = targetedColumns(target.table, columns);
			if (protectedColumns.length === 0 && !dynamicColumns) continue;
			const statementEnd = sqlText.indexOf(";", tokens[start]?.start ?? 0);
			const statement = sqlText.slice(
				tokens[start]?.start ?? 0,
				statementEnd === -1 ? undefined : statementEnd,
			);
			const correction = /['"]correction['"]/i.test(statement);
			const syntheticTimeEntry =
				target.table === "time_entry" &&
				SYNTHETIC_TIME_ENTRY_COLUMNS.every((column) => columnSet.has(column)) &&
				!columns.some((column) => TIME_ENTRY_LIFECYCLE_COLUMNS.has(column));
			const terminalBreak =
				(target.table === "time_record" &&
					/['"]approved['"]/i.test(statement) &&
					/['"](?:work|clock)['"]/i.test(statement)) ||
				target.table === "time_record_work" ||
				target.table === "time_record_allocation" ||
				(target.table === "work_period" &&
					/['"]approved['"]/i.test(statement) &&
					columnSet.has("canonical_record_id"));
			const dynamicCorrectionSemantic =
				target.table === "time_entry" &&
				protectedColumns.includes("type") &&
				statement.includes(APPROVAL_DYNAMIC_SQL_MARKER) &&
				!correction &&
				!syntheticTimeEntry;
			if (
				target.table === "time_entry" &&
				!correction &&
				!syntheticTimeEntry &&
				!protectedColumns.some((column) =>
					TIME_ENTRY_LIFECYCLE_COLUMNS.has(column),
				) &&
				!dynamicColumns &&
				!dynamicCorrectionSemantic
			)
				continue;
			mutations.push({
				...(protectedColumns.length > 0 ? { columns: protectedColumns } : {}),
				offset: tokens[start]?.start ?? 0,
				operation,
				...(correction
					? { semantic: "correction" as const }
					: syntheticTimeEntry
						? { semantic: "synthetic_time_entry" as const }
						: terminalBreak
							? { semantic: "policy_clock_out_terminal_break" as const }
							: protectedColumns.some((column) =>
										TIME_ENTRY_LIFECYCLE_COLUMNS.has(column),
									)
								? { semantic: "correction_lifecycle" as const }
								: {}),
				table: target.table,
				...(dynamicColumns || dynamicCorrectionSemantic
					? { uncertainty: "dynamic_sql" as const }
					: {}),
			});
			continue;
		}
		if (operation === "delete") {
			if (target.table !== "time_entry") continue;
			const statementEnd = sqlText.indexOf(";", tokens[start]?.start ?? 0);
			const statement = sqlText.slice(
				tokens[start]?.start ?? 0,
				statementEnd === -1 ? undefined : statementEnd,
			);
			const constrainedColumns = targetedColumns(
				target.table,
				[
					...statement.matchAll(
						/\b(type|is_superseded|replaces_entry_id|superseded_by_id)\b/gi,
					),
				].map((match) => match[1]?.toLowerCase() ?? ""),
			);
			const inactiveCorrection =
				/\btype\s*=\s*['"]correction['"]/i.test(statement) &&
				/\breplaces_entry_id\s*=/i.test(statement) &&
				/\bis_superseded\s*=\s*true\b/i.test(statement) &&
				/\bsuperseded_by_id\s+is\s+null\b/i.test(statement);
			if (!inactiveCorrection) continue;
			mutations.push({
				columns: constrainedColumns,
				offset: tokens[start]?.start ?? 0,
				operation,
				semantic: "inactive_correction",
				table: target.table,
			});
			continue;
		}

		let setPosition = target.end;
		if (
			tokens[setPosition]?.kind === "identifier" &&
			!isKeyword(tokens[setPosition], "set")
		)
			setPosition += 1;
		if (!isKeyword(tokens[setPosition], "set")) continue;
		const columns: string[] = [];
		let dynamicAssignment = false;
		for (
			let position = setPosition + 1;
			position + 1 < tokens.length;
			position += 1
		) {
			if (
				isKeyword(tokens[position], "where") ||
				isKeyword(tokens[position], "from") ||
				isKeyword(tokens[position], "returning") ||
				punctuationAt(tokens, position, ";")
			)
				break;
			if (
				tokens[position]?.kind === "identifier" &&
				punctuationAt(tokens, position + 1, "=")
			)
				columns.push(tokens[position]?.text ?? "");
			if (
				tokens[position]?.kind === "identifier" &&
				tokens[position]?.text === APPROVAL_DYNAMIC_SQL_MARKER &&
				(position === setPosition + 1 ||
					punctuationAt(tokens, position - 1, ","))
			) {
				dynamicAssignment = true;
			}
		}
		const protectedColumns = targetedColumns(target.table, columns);
		if (protectedColumns.length === 0 && !dynamicAssignment) continue;
		mutations.push({
			...(protectedColumns.length > 0 ? { columns: protectedColumns } : {}),
			offset: tokens[start]?.start ?? 0,
			operation,
			...(target.table === "time_entry" && protectedColumns.length > 0
				? { semantic: "correction_lifecycle" as const }
				: target.table === "time_record"
					? {
							semantic: protectedColumns.includes("approval_state")
								? ("ordinary_finalization" as const)
								: ("policy_clock_out_terminal_break" as const),
						}
					: target.table === "work_period" &&
							protectedColumns.includes("clock_out_id") &&
							protectedColumns.includes("end_time") &&
							protectedColumns.includes("duration_minutes") &&
							!protectedColumns.includes("approval_status")
						? { semantic: "policy_clock_out_terminal_break" as const }
						: {}),
			table: target.table,
			...(dynamicAssignment ? { uncertainty: "dynamic_sql" as const } : {}),
		});
	}
	return mutations;
}

function hasAssignmentAfter(
	tokens: SqlToken[],
	start: number,
	end: number,
): boolean {
	let depth = 0;
	for (let index = start; index < end; index += 1) {
		if (punctuationAt(tokens, index, "(")) depth += 1;
		else if (punctuationAt(tokens, index, ")")) depth -= 1;
		if (
			depth === 0 &&
			(isKeyword(tokens[index], "where") ||
				isKeyword(tokens[index], "from") ||
				isKeyword(tokens[index], "returning"))
		)
			return false;
		if (punctuationAt(tokens, index, "=") && index > start && index + 1 < end)
			return true;
	}
	return false;
}

function topLevelKeywordAt(
	tokens: SqlToken[],
	start: number,
	end: number,
	keyword: string,
): number | null {
	let depth = 0;
	for (let position = start; position < end; position += 1) {
		if (punctuationAt(tokens, position, "(")) depth += 1;
		else if (punctuationAt(tokens, position, ")")) depth -= 1;
		else if (depth === 0 && isKeyword(tokens[position], keyword))
			return position;
	}
	return null;
}

function inspectTruncateCommand(
	tokens: SqlToken[],
	start: number,
	end: number,
	mutations: ApprovalSqlTableMutation[],
): void {
	let position = start + 1;
	if (isKeyword(tokens[position], "table")) position += 1;
	const targets: ProtectedApprovalTable[] = [];
	while (position < end) {
		if (isKeyword(tokens[position], "only")) position += 1;
		const target = tableAt(tokens, position);
		if (!target) return;
		if (target.table) targets.push(target.table);
		position = target.end;
		if (punctuationAt(tokens, position, "*")) position += 1;
		if (!punctuationAt(tokens, position, ",")) break;
		position += 1;
		if (position >= end) return;
	}
	if (
		isKeyword(tokens[position], "restart") ||
		isKeyword(tokens[position], "continue")
	) {
		position += 1;
		if (!isKeyword(tokens[position], "identity")) return;
		position += 1;
	}
	if (
		isKeyword(tokens[position], "cascade") ||
		isKeyword(tokens[position], "restrict")
	)
		position += 1;
	if (position !== end) return;
	for (const table of targets) {
		mutations.push({
			offset: tokens[start]?.start ?? 0,
			operation: "delete",
			table,
		});
	}
}

function inspectCopyCommand(
	tokens: SqlToken[],
	start: number,
	end: number,
	mutations: ApprovalSqlTableMutation[],
): void {
	let position = start + 1;
	const target = tableAt(tokens, position);
	if (!target) return;
	position = target.end;
	if (punctuationAt(tokens, position, "(")) {
		const columnsEnd = matchingParenthesis(tokens, position, end);
		if (columnsEnd === null || columnsEnd === position + 1) return;
		position = columnsEnd + 1;
	}
	if (!isKeyword(tokens[position], "from") || position + 1 >= end) return;
	if (!target.table) return;
	mutations.push({
		offset: tokens[start]?.start ?? 0,
		operation: "insert",
		table: target.table,
	});
}

function inspectMergeCommand(
	tokens: SqlToken[],
	start: number,
	end: number,
	mutations: ApprovalSqlTableMutation[],
): void {
	if (!isKeyword(tokens[start + 1], "into")) return;
	let position = start + 2;
	if (isKeyword(tokens[position], "only")) position += 1;
	const target = tableAt(tokens, position);
	if (!target) return;
	position = target.end;
	if (punctuationAt(tokens, position, "*")) position += 1;
	if (isKeyword(tokens[position], "as")) {
		position += 1;
		if (tokens[position]?.kind !== "identifier") return;
		position += 1;
	} else if (
		tokens[position]?.kind === "identifier" &&
		!isKeyword(tokens[position], "using")
	) {
		position += 1;
	}
	if (!isKeyword(tokens[position], "using")) return;
	const onPosition = topLevelKeywordAt(tokens, position + 1, end, "on");
	if (onPosition === null || onPosition === position + 1) return;
	const firstWhenPosition = topLevelKeywordAt(
		tokens,
		onPosition + 1,
		end,
		"when",
	);
	if (firstWhenPosition === null || firstWhenPosition === onPosition + 1)
		return;
	let whenPosition: number = firstWhenPosition;
	const found: ApprovalSqlTableMutation[] = [];
	while (whenPosition < end) {
		const nextWhen: number =
			topLevelKeywordAt(tokens, whenPosition + 1, end, "when") ?? end;
		const thenPosition = topLevelKeywordAt(
			tokens,
			whenPosition + 1,
			nextWhen,
			"then",
		);
		if (thenPosition === null || thenPosition === whenPosition + 1) return;
		const actionPosition = thenPosition + 1;
		let operation: ApprovalWriteOperation;
		if (isKeyword(tokens[actionPosition], "update")) {
			if (
				!isKeyword(tokens[actionPosition + 1], "set") ||
				!hasAssignmentAfter(tokens, actionPosition + 2, nextWhen)
			)
				return;
			operation = "update";
		} else if (isKeyword(tokens[actionPosition], "delete")) {
			if (actionPosition + 1 !== nextWhen) return;
			operation = "delete";
		} else if (isKeyword(tokens[actionPosition], "insert")) {
			let insertPosition = actionPosition + 1;
			if (punctuationAt(tokens, insertPosition, "(")) {
				const columnsEnd = matchingParenthesis(
					tokens,
					insertPosition,
					nextWhen,
				);
				if (columnsEnd === null || columnsEnd === insertPosition + 1) return;
				insertPosition = columnsEnd + 1;
			}
			if (isKeyword(tokens[insertPosition], "values")) {
				const rowStart = insertPosition + 1;
				if (!punctuationAt(tokens, rowStart, "(")) return;
				const rowEnd = matchingParenthesis(tokens, rowStart, nextWhen);
				if (
					rowEnd === null ||
					rowEnd === rowStart + 1 ||
					rowEnd + 1 !== nextWhen
				)
					return;
			} else if (
				!isKeyword(tokens[insertPosition], "default") ||
				!isKeyword(tokens[insertPosition + 1], "values") ||
				insertPosition + 2 !== nextWhen
			)
				return;
			operation = "insert";
		} else if (isKeyword(tokens[actionPosition], "do")) {
			if (
				!isKeyword(tokens[actionPosition + 1], "nothing") ||
				actionPosition + 2 !== nextWhen
			)
				return;
			whenPosition = nextWhen;
			continue;
		} else return;
		if (target.table) {
			found.push({
				offset: tokens[actionPosition]?.start ?? 0,
				operation,
				table: target.table,
			});
		}
		whenPosition = nextWhen;
	}
	mutations.push(...found);
}

function inspectCommand(
	tokens: SqlToken[],
	start: number,
	end: number,
	mutations: ApprovalSqlTableMutation[],
): void {
	if (isKeyword(tokens[start], "merge")) {
		inspectMergeCommand(tokens, start, end, mutations);
		return;
	}
	if (isKeyword(tokens[start], "truncate")) {
		inspectTruncateCommand(tokens, start, end, mutations);
		return;
	}
	if (isKeyword(tokens[start], "copy")) {
		inspectCopyCommand(tokens, start, end, mutations);
		return;
	}
	let operation: ApprovalWriteOperation | null = null;
	let position = start;
	if (
		isKeyword(tokens[position], "insert") &&
		isKeyword(tokens[position + 1], "into")
	) {
		operation = "insert";
		position += 2;
	} else if (isKeyword(tokens[position], "update")) {
		operation = "update";
		position += 1;
	} else if (
		isKeyword(tokens[position], "delete") &&
		isKeyword(tokens[position + 1], "from")
	) {
		operation = "delete";
		position += 2;
	} else {
		return;
	}
	if (isKeyword(tokens[position], "only")) position += 1;
	const target = tableAt(tokens, position);
	if (!target?.table) return;
	position = target.end;
	if (operation === "delete") {
		if (punctuationAt(tokens, position, "*")) position += 1;
		if (isKeyword(tokens[position], "as")) {
			position += 1;
			if (tokens[position]?.kind !== "identifier") return;
			position += 1;
		} else if (
			tokens[position]?.kind === "identifier" &&
			!isKeyword(tokens[position], "where") &&
			!isKeyword(tokens[position], "using") &&
			!isKeyword(tokens[position], "returning")
		) {
			position += 1;
		}
		if (isKeyword(tokens[position], "where") && position + 1 >= end) return;
		mutations.push({
			offset: tokens[start]?.start ?? 0,
			operation,
			table: target.table,
		});
		return;
	}
	if (operation === "update") {
		if (punctuationAt(tokens, position, "*")) position += 1;
		if (isKeyword(tokens[position], "as")) {
			position += 1;
			if (tokens[position]?.kind !== "identifier") return;
			position += 1;
		} else if (
			tokens[position]?.kind === "identifier" &&
			!isKeyword(tokens[position], "set")
		) {
			position += 1;
		}
		if (!isKeyword(tokens[position], "set")) return;
		if (!hasAssignmentAfter(tokens, position + 1, end)) return;
		if (isKeyword(tokens[end - 1], "where")) return;
		mutations.push({
			offset: tokens[start]?.start ?? 0,
			operation,
			table: target.table,
		});
		return;
	}
	if (isKeyword(tokens[position], "as")) {
		position += 1;
		if (tokens[position]?.kind !== "identifier") return;
		position += 1;
	}
	if (punctuationAt(tokens, position, "(")) {
		const columnsEnd = matchingParenthesis(tokens, position, end);
		if (columnsEnd === null) return;
		position = columnsEnd + 1;
	}
	if (isKeyword(tokens[position], "overriding")) {
		position += 1;
		if (
			!isKeyword(tokens[position], "system") &&
			!isKeyword(tokens[position], "user")
		)
			return;
		position += 1;
		if (!isKeyword(tokens[position], "value")) return;
		position += 1;
	}
	let hasInsertSource = false;
	if (isKeyword(tokens[position], "values")) {
		const rowStart = position + 1;
		if (punctuationAt(tokens, rowStart, "(")) {
			const rowEnd = matchingParenthesis(tokens, rowStart, end);
			hasInsertSource = rowEnd !== null && rowEnd > rowStart + 1;
		}
	} else if (
		isKeyword(tokens[position], "select") ||
		isKeyword(tokens[position], "with")
	) {
		hasInsertSource = position + 1 < end;
	} else if (isKeyword(tokens[position], "table")) {
		hasInsertSource = tokens[position + 1]?.kind === "identifier";
	} else {
		hasInsertSource =
			isKeyword(tokens[position], "default") &&
			isKeyword(tokens[position + 1], "values");
	}
	if (!hasInsertSource) return;
	let upsertUpdateOffset: number | null = null;
	for (let index = target.end; index + 3 < end; index += 1) {
		if (
			!isKeyword(tokens[index], "on") ||
			!isKeyword(tokens[index + 1], "conflict")
		)
			continue;
		for (
			let conflictIndex = index + 2;
			conflictIndex + 1 < end;
			conflictIndex += 1
		) {
			if (
				isKeyword(tokens[conflictIndex], "do") &&
				isKeyword(tokens[conflictIndex + 1], "update")
			) {
				const setPosition = conflictIndex + 2;
				if (
					!isKeyword(tokens[setPosition], "set") ||
					!hasAssignmentAfter(tokens, setPosition + 1, end)
				)
					return;
				upsertUpdateOffset = tokens[conflictIndex + 1]?.start ?? 0;
				break;
			}
		}
		break;
	}
	mutations.push({
		offset: tokens[start]?.start ?? 0,
		operation,
		table: target.table,
	});
	if (upsertUpdateOffset !== null) {
		mutations.push({
			offset: upsertUpdateOffset,
			operation: "update",
			table: target.table,
		});
	}
}

function inspectStatement(
	tokens: SqlToken[],
	start: number,
	end: number,
	mutations: ApprovalSqlTableMutation[],
	nesting: number,
	statementCounter: { value: number },
): void {
	if (nesting > MAX_SQL_COMMAND_NESTING) {
		throw new ApprovalWriteBoundaryAnalysisLimitError("sql_command_depth");
	}
	statementCounter.value += 1;
	if (statementCounter.value > MAX_SQL_STATEMENTS) {
		throw new ApprovalWriteBoundaryAnalysisLimitError("sql_statement_count");
	}
	if (isKeyword(tokens[start], "explain")) {
		const target = explainExecutionTarget(tokens, start, end);
		if (target !== null) {
			inspectStatement(
				tokens,
				target,
				end,
				mutations,
				nesting + 1,
				statementCounter,
			);
		}
		return;
	}
	if (!isKeyword(tokens[start], "with")) {
		inspectCommand(tokens, start, end, mutations);
		return;
	}
	let position = start + 1;
	if (isKeyword(tokens[position], "recursive")) position += 1;
	while (position < end) {
		if (tokens[position]?.kind !== "identifier") return;
		position += 1;
		if (punctuationAt(tokens, position, "(")) {
			const columnsEnd = matchingParenthesis(tokens, position, end);
			if (columnsEnd === null) return;
			position = columnsEnd + 1;
		}
		if (!isKeyword(tokens[position], "as")) return;
		position += 1;
		if (isKeyword(tokens[position], "not")) position += 1;
		if (isKeyword(tokens[position], "materialized")) position += 1;
		if (!punctuationAt(tokens, position, "(")) return;
		const bodyEnd = matchingParenthesis(tokens, position, end);
		if (bodyEnd === null) return;
		inspectStatements(
			tokens,
			position + 1,
			bodyEnd,
			mutations,
			nesting + 1,
			statementCounter,
		);
		position = bodyEnd + 1;
		const suffixEnd = cteSuffixEnd(tokens, position, end);
		if (suffixEnd === null) return;
		position = suffixEnd;
		if (punctuationAt(tokens, position, ",")) {
			position += 1;
			continue;
		}
		inspectStatement(
			tokens,
			position,
			end,
			mutations,
			nesting + 1,
			statementCounter,
		);
		return;
	}
}

function inspectStatements(
	tokens: SqlToken[],
	start: number,
	end: number,
	mutations: ApprovalSqlTableMutation[],
	nesting: number,
	statementCounter: { value: number },
): void {
	let statementStart = start;
	let depth = 0;
	for (let position = start; position <= end; position += 1) {
		if (position < end && punctuationAt(tokens, position, "(")) depth += 1;
		else if (position < end && punctuationAt(tokens, position, ")")) depth -= 1;
		if (
			position === end ||
			(depth === 0 && punctuationAt(tokens, position, ";"))
		) {
			if (statementStart < position) {
				inspectStatement(
					tokens,
					statementStart,
					position,
					mutations,
					nesting,
					statementCounter,
				);
			}
			statementStart = position + 1;
		}
	}
}

export function findProtectedApprovalSqlMutationLocations(
	sqlText: string,
): ApprovalSqlTableMutation[] {
	if (sqlText.length > MAX_SQL_TEXT_LENGTH) {
		throw new ApprovalWriteBoundaryAnalysisLimitError("sql_text_length");
	}
	const tokens = tokenizeSql(sqlText);
	const mutations: ApprovalSqlTableMutation[] = [];
	inspectStatements(tokens, 0, tokens.length, mutations, 0, { value: 0 });
	mutations.push(...inspectTargetedSourceSqlMutations(sqlText, tokens));
	return mutations.sort((left, right) => left.offset - right.offset);
}

export function findProtectedApprovalSqlMutations(
	sqlText: string,
): ApprovalTableMutation[] {
	return findProtectedApprovalSqlMutationLocations(sqlText).map(
		({ columns, operation, semantic, table, uncertainty }) => ({
			...(columns ? { columns } : {}),
			operation,
			...(semantic ? { semantic } : {}),
			table,
			...(uncertainty ? { uncertainty } : {}),
		}),
	);
}

export interface ConstantApprovalSqlContext {
	budget?: ApprovalConstantEvaluationBudget;
	checker: ts.TypeChecker;
	usePosition: number;
}

export interface ApprovalConstantEvaluationBudget {
	memo: Map<ts.Symbol, string | null>;
	work: number;
}

const MAX_CONSTANT_EVALUATION_DEPTH = 128;
const MAX_CONSTANT_EVALUATION_OUTPUT = 65_536;
const MAX_CONSTANT_EVALUATION_WORK = 20_000;

export function createApprovalConstantEvaluationBudget(): ApprovalConstantEvaluationBudget {
	return { memo: new Map(), work: 0 };
}

const writeSymbolIndexCache = new WeakMap<
	ts.SourceFile,
	WeakMap<ts.TypeChecker, Set<ts.Symbol>>
>();

function collectAssignmentTarget(
	target: ts.Node,
	writeSymbols: Set<ts.Symbol>,
	checker: ts.TypeChecker,
): void {
	if (ts.isIdentifier(target)) {
		const symbol = checker.getSymbolAtLocation(target);
		if (symbol) writeSymbols.add(symbol);
		return;
	}
	if (ts.isParenthesizedExpression(target)) {
		collectAssignmentTarget(target.expression, writeSymbols, checker);
		return;
	}
	if (
		ts.isBinaryExpression(target) &&
		target.operatorToken.kind === ts.SyntaxKind.EqualsToken
	) {
		collectAssignmentTarget(target.left, writeSymbols, checker);
		return;
	}
	if (ts.isArrayLiteralExpression(target)) {
		for (const element of target.elements) {
			if (ts.isOmittedExpression(element)) continue;
			collectAssignmentTarget(
				ts.isSpreadElement(element) ? element.expression : element,
				writeSymbols,
				checker,
			);
		}
		return;
	}
	if (ts.isObjectLiteralExpression(target)) {
		for (const property of target.properties) {
			if (ts.isPropertyAssignment(property)) {
				collectAssignmentTarget(property.initializer, writeSymbols, checker);
			} else if (ts.isShorthandPropertyAssignment(property)) {
				const symbol = checker.getShorthandAssignmentValueSymbol(property);
				if (symbol) writeSymbols.add(symbol);
			} else if (ts.isSpreadAssignment(property)) {
				collectAssignmentTarget(property.expression, writeSymbols, checker);
			}
		}
	}
}

function writeSymbolsFor(
	sourceFile: ts.SourceFile,
	checker: ts.TypeChecker,
): Set<ts.Symbol> {
	let byChecker = writeSymbolIndexCache.get(sourceFile);
	if (!byChecker) {
		byChecker = new WeakMap();
		writeSymbolIndexCache.set(sourceFile, byChecker);
	}
	const existing = byChecker.get(checker);
	if (existing) return existing;
	const writeSymbols = new Set<ts.Symbol>();
	byChecker.set(checker, writeSymbols);
	const visit = (node: ts.Node): void => {
		if (
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
			node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
		) {
			collectAssignmentTarget(node.left, writeSymbols, checker);
		}
		if (
			(ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
			(node.operator === ts.SyntaxKind.PlusPlusToken ||
				node.operator === ts.SyntaxKind.MinusMinusToken)
		) {
			collectAssignmentTarget(node.operand, writeSymbols, checker);
		}
		if (
			(ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
			!ts.isVariableDeclarationList(node.initializer)
		) {
			collectAssignmentTarget(node.initializer, writeSymbols, checker);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return writeSymbols;
}

export function evaluateConstantApprovalSql(
	expression: ts.Expression,
	context: ConstantApprovalSqlContext,
): string | null {
	const budget = context.budget ?? createApprovalConstantEvaluationBudget();
	const activeSymbols = new Set<ts.Symbol>();
	const checkLength = (length: number): void => {
		if (length > MAX_CONSTANT_EVALUATION_OUTPUT) {
			throw new ApprovalWriteBoundaryAnalysisLimitError(
				"constant_evaluator_output_length",
			);
		}
	};
	const evaluate = (
		candidate: ts.Expression,
		usePosition: number,
		depth: number,
	): string | null => {
		if (depth > MAX_CONSTANT_EVALUATION_DEPTH) {
			throw new ApprovalWriteBoundaryAnalysisLimitError(
				"constant_evaluator_depth",
			);
		}
		budget.work += 1;
		if (budget.work > MAX_CONSTANT_EVALUATION_WORK) {
			throw new ApprovalWriteBoundaryAnalysisLimitError(
				"constant_evaluator_work",
			);
		}
		if (
			ts.isStringLiteral(candidate) ||
			ts.isNoSubstitutionTemplateLiteral(candidate)
		) {
			checkLength(candidate.text.length);
			return candidate.text;
		}
		if (
			ts.isParenthesizedExpression(candidate) ||
			ts.isAsExpression(candidate) ||
			ts.isTypeAssertionExpression(candidate) ||
			ts.isNonNullExpression(candidate) ||
			ts.isSatisfiesExpression(candidate)
		) {
			return evaluate(candidate.expression, usePosition, depth + 1);
		}
		if (
			ts.isBinaryExpression(candidate) &&
			candidate.operatorToken.kind === ts.SyntaxKind.PlusToken
		) {
			const left = evaluate(candidate.left, usePosition, depth + 1);
			if (left === null) return null;
			const right = evaluate(candidate.right, usePosition, depth + 1);
			if (right === null) return null;
			checkLength(left.length + right.length);
			return left + right;
		}
		if (ts.isTemplateExpression(candidate)) {
			let result = candidate.head.text;
			checkLength(result.length);
			for (const span of candidate.templateSpans) {
				const value = evaluate(span.expression, usePosition, depth + 1);
				if (value === null) return null;
				checkLength(result.length + value.length + span.literal.text.length);
				result += value + span.literal.text;
			}
			return result;
		}
		if (ts.isIdentifier(candidate)) {
			const symbol = context.checker.getSymbolAtLocation(candidate);
			if (!symbol) return null;
			if (budget.memo.has(symbol)) return budget.memo.get(symbol) ?? null;
			const declarations = symbol.declarations;
			if (
				declarations?.length !== 1 ||
				!ts.isVariableDeclaration(declarations[0])
			)
				return null;
			const declaration = declarations[0];
			if (
				!ts.isVariableDeclarationList(declaration.parent) ||
				!(declaration.parent.flags & ts.NodeFlags.Const) ||
				!declaration.initializer ||
				declaration.getSourceFile() !== candidate.getSourceFile() ||
				declaration.initializer.getEnd() > usePosition ||
				writeSymbolsFor(declaration.getSourceFile(), context.checker).has(
					symbol,
				)
			)
				return null;
			if (activeSymbols.has(symbol)) return null;
			activeSymbols.add(symbol);
			try {
				const result = evaluate(
					declaration.initializer,
					declaration.initializer.getStart(declaration.getSourceFile()),
					depth + 1,
				);
				budget.memo.set(symbol, result);
				return result;
			} finally {
				activeSymbols.delete(symbol);
			}
		}
		return null;
	};
	return evaluate(expression, context.usePosition, 0);
}
