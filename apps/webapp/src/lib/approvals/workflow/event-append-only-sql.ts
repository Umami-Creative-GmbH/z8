import * as ts from "typescript/unstable/ast";
import type {
	Checker,
	Symbol as TypeScriptSymbol,
} from "typescript/unstable/sync";

export type EventTableSqlMutationKind = "raw_sql_update" | "raw_sql_delete";

type ApprovalWorkflowEventAnalysisLimit =
	| "constant_evaluator_depth"
	| "sql_command_depth";

export class ApprovalWorkflowEventAnalysisLimitError extends Error {
	readonly code = "APPROVAL_WORKFLOW_EVENT_ANALYSIS_LIMIT";

	constructor(readonly limit: ApprovalWorkflowEventAnalysisLimit) {
		super(`Approval workflow event analysis limit exceeded: ${limit}`);
		this.name = "ApprovalWorkflowEventAnalysisLimitError";
	}
}

interface SqlToken {
	kind: "identifier" | "punctuation";
	quoted: boolean;
	text: string;
}

const isAsciiWhitespace = (character: string | undefined): boolean =>
	character !== undefined && /[ \t\n\r\f\v]/.test(character);

const isHighBitCharacter = (character: string): boolean =>
	(character.codePointAt(0) ?? 0) >= 0x80;

const isIdentifierStart = (character: string | undefined): boolean =>
	character !== undefined &&
	(/[A-Za-z_]/.test(character) || isHighBitCharacter(character));

const isIdentifierPart = (character: string | undefined): boolean =>
	character !== undefined &&
	(/[A-Za-z0-9_$]/.test(character) || isHighBitCharacter(character));

function codePointCharacterAt(
	text: string,
	position: number,
): string | undefined {
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
			const character = codePointCharacterAt(text, position);
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
			) {
				return null;
			}
			const lowSurrogate = Number.parseInt(lowDigits, 16);
			if (lowSurrogate < 0xdc00 || lowSurrogate > 0xdfff) return null;
			const combined =
				0x10000 + ((codePoint - 0xd800) << 10) + (lowSurrogate - 0xdc00);
			decoded += String.fromCodePoint(combined);
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
		if (isAsciiWhitespace(sqlText[position])) {
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
				} else {
					position += 1;
				}
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
		isIdentifierPart(
			codePointCharacterAt(sqlText, keywordPosition + keyword.length),
		)
	) {
		return null;
	}
	let position = skipSqlTrivia(sqlText, keywordPosition + keyword.length);
	if (sqlText[position] !== "'")
		return { end: position, escapeCharacter: null };
	position += 1;
	let escapeCharacter = "";
	let closed = false;
	while (position < sqlText.length) {
		if (sqlText[position] === "'" && sqlText[position + 1] === "'") {
			escapeCharacter += "'";
			position += 2;
			continue;
		}
		if (sqlText[position] === "'") {
			position += 1;
			closed = true;
			break;
		}
		escapeCharacter += sqlText[position];
		position += 1;
	}
	const prohibited =
		/[0-9A-Fa-f+'"]/.test(escapeCharacter) ||
		isAsciiWhitespace(escapeCharacter);
	return closed && [...escapeCharacter].length === 1 && !prohibited
		? { end: position, escapeCharacter }
		: { end: position, escapeCharacter: null };
}

function dollarQuoteDelimiterAt(
	sqlText: string,
	position: number,
): string | null {
	if (sqlText[position] !== "$") return null;
	let end = position + 1;
	if (sqlText[end] === "$") return "$$";
	let character = codePointCharacterAt(sqlText, end);
	if (!isIdentifierStart(character)) return null;
	end += character?.length ?? 0;
	character = codePointCharacterAt(sqlText, end);
	while (
		character !== undefined &&
		character !== "$" &&
		isIdentifierPart(character)
	) {
		end += character.length;
		character = codePointCharacterAt(sqlText, end);
	}
	return sqlText[end] === "$" ? sqlText.slice(position, end + 1) : null;
}

function tokenizeSql(sqlText: string): SqlToken[] {
	const tokens: SqlToken[] = [];
	let position = 0;

	while (position < sqlText.length) {
		const character = sqlText[position];
		const next = sqlText[position + 1];
		if (isAsciiWhitespace(character)) {
			position += 1;
			continue;
		}
		if (character === "-" && next === "-") {
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
		if (character === "/" && next === "*") {
			position += 2;
			let depth = 1;
			while (position < sqlText.length && depth > 0) {
				if (sqlText[position] === "/" && sqlText[position + 1] === "*") {
					depth += 1;
					position += 2;
					continue;
				}
				if (sqlText[position] === "*" && sqlText[position + 1] === "/") {
					depth -= 1;
					position += 2;
					continue;
				}
				position += 1;
			}
			continue;
		}
		const isUnicodeQuotedIdentifier =
			(character === "U" || character === "u") &&
			next === "&" &&
			sqlText[position + 2] === '"';
		if (isUnicodeQuotedIdentifier) {
			const quoted = readQuotedText(sqlText, position + 2);
			const escapeClause = unicodeEscapeClauseAt(sqlText, quoted.end);
			const escapeCharacter = escapeClause
				? escapeClause.escapeCharacter
				: "\\";
			const decoded =
				escapeCharacter === null
					? null
					: decodeUnicodeIdentifier(quoted.text, escapeCharacter);
			tokens.push(
				decoded === null
					? {
							kind: "punctuation",
							quoted: false,
							text: "invalid_unicode_identifier",
						}
					: { kind: "identifier", quoted: true, text: decoded },
			);
			position = escapeClause?.end ?? quoted.end;
			continue;
		}
		const isEscapeString =
			(character === "E" || character === "e") && next === "'";
		if (character === "'" || isEscapeString) {
			if (isEscapeString) position += 1;
			position += 1;
			while (position < sqlText.length) {
				if (isEscapeString && sqlText[position] === "\\") {
					position = Math.min(position + 2, sqlText.length);
					continue;
				}
				if (sqlText[position] === "'" && sqlText[position + 1] === "'") {
					position += 2;
					continue;
				}
				if (sqlText[position] === "'") {
					position += 1;
					break;
				}
				position += 1;
			}
			continue;
		}
		const dollarDelimiter = dollarQuoteDelimiterAt(sqlText, position);
		if (dollarDelimiter !== null) {
			position += dollarDelimiter.length;
			const closingPosition = sqlText.indexOf(dollarDelimiter, position);
			position =
				closingPosition === -1
					? sqlText.length
					: closingPosition + dollarDelimiter.length;
			continue;
		}
		if (character === '"') {
			const quoted = readQuotedText(sqlText, position);
			position = quoted.end;
			tokens.push({ kind: "identifier", quoted: true, text: quoted.text });
			continue;
		}
		const identifierStart = codePointCharacterAt(sqlText, position);
		if (isIdentifierStart(identifierStart)) {
			const start = position;
			position += identifierStart?.length ?? 0;
			let identifierPart = codePointCharacterAt(sqlText, position);
			while (isIdentifierPart(identifierPart)) {
				position += identifierPart?.length ?? 0;
				identifierPart = codePointCharacterAt(sqlText, position);
			}
			tokens.push({
				kind: "identifier",
				quoted: false,
				text: sqlText.slice(start, position).toLowerCase(),
			});
			continue;
		}

		tokens.push({
			kind: "punctuation",
			quoted: false,
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

function isEventTable(token: SqlToken | undefined): boolean {
	return (
		token?.kind === "identifier" && token.text === "approval_workflow_event"
	);
}

interface TableReference {
	end: number;
	isEventTable: boolean;
}

function tableReferenceAt(
	tokens: SqlToken[],
	start: number,
): TableReference | null {
	const first = tokens[start];
	if (first?.kind !== "identifier") return null;
	if (
		first?.kind === "identifier" &&
		tokens[start + 1]?.text === "." &&
		tokens[start + 2]?.kind === "identifier"
	) {
		return { end: start + 3, isEventTable: isEventTable(tokens[start + 2]) };
	}
	return { end: start + 1, isEventTable: isEventTable(first) };
}

function punctuationAt(
	tokens: SqlToken[],
	position: number,
	text: string,
): boolean {
	const token = tokens[position];
	return token?.kind === "punctuation" && token.text === text;
}

function matchingParenthesis(
	tokens: SqlToken[],
	open: number,
	end: number,
): number | null {
	let depth = 0;
	for (let position = open; position < end; position += 1) {
		if (punctuationAt(tokens, position, "(")) depth += 1;
		else if (punctuationAt(tokens, position, ")")) {
			depth -= 1;
			if (depth === 0) return position;
		}
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
		) {
			return null;
		}
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
		while (position < end && !isKeyword(tokens[position], "using")) {
			position += 1;
		}
		if (!isKeyword(tokens[position], "using")) return null;
		position += 1;
		if (tokens[position]?.kind !== "identifier") return null;
		position += 1;
	}
	return position;
}

const MAX_SQL_COMMAND_NESTING = 64;

function inspectSqlCommand(
	tokens: SqlToken[],
	start: number,
	mutations: EventTableSqlMutationKind[],
): void {
	let position = start;
	if (isKeyword(tokens[position], "update")) {
		position += 1;
		if (isKeyword(tokens[position], "only")) position += 1;
		const table = tableReferenceAt(tokens, position);
		if (!table) return;
		position = table.end;
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
		if (table.isEventTable && isKeyword(tokens[position], "set")) {
			mutations.push("raw_sql_update");
		}
		return;
	}
	if (
		isKeyword(tokens[position], "delete") &&
		isKeyword(tokens[position + 1], "from")
	) {
		position += 2;
		if (isKeyword(tokens[position], "only")) position += 1;
		const table = tableReferenceAt(tokens, position);
		if (table?.isEventTable) mutations.push("raw_sql_delete");
	}
}

function inspectSqlStatements(
	tokens: SqlToken[],
	start: number,
	end: number,
	mutations: EventTableSqlMutationKind[],
	nesting: number,
): void {
	if (nesting > MAX_SQL_COMMAND_NESTING) {
		throw new ApprovalWorkflowEventAnalysisLimitError("sql_command_depth");
	}
	let statementStart = start;
	let depth = 0;
	for (let position = start; position <= end; position += 1) {
		if (position < end && punctuationAt(tokens, position, "(")) depth += 1;
		else if (position < end && punctuationAt(tokens, position, ")")) depth -= 1;
		if (
			position === end ||
			(depth === 0 && punctuationAt(tokens, position, ";"))
		) {
			inspectSqlStatement(tokens, statementStart, position, mutations, nesting);
			statementStart = position + 1;
		}
	}
}

function inspectSqlStatement(
	tokens: SqlToken[],
	start: number,
	end: number,
	mutations: EventTableSqlMutationKind[],
	nesting: number,
): void {
	if (nesting > MAX_SQL_COMMAND_NESTING) {
		throw new ApprovalWorkflowEventAnalysisLimitError("sql_command_depth");
	}
	if (isKeyword(tokens[start], "explain")) {
		const target = explainExecutionTarget(tokens, start, end);
		if (target !== null) {
			inspectSqlStatement(tokens, target, end, mutations, nesting + 1);
		}
		return;
	}
	if (!isKeyword(tokens[start], "with")) {
		inspectSqlCommand(tokens, start, mutations);
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
		if (isKeyword(tokens[position], "not")) {
			position += 1;
			if (!isKeyword(tokens[position], "materialized")) return;
			position += 1;
		} else if (isKeyword(tokens[position], "materialized")) {
			position += 1;
		}
		if (!punctuationAt(tokens, position, "(")) return;
		const bodyEnd = matchingParenthesis(tokens, position, end);
		if (bodyEnd === null) return;
		inspectSqlStatements(tokens, position + 1, bodyEnd, mutations, nesting + 1);
		position = bodyEnd + 1;
		const suffixEnd = cteSuffixEnd(tokens, position, end);
		if (suffixEnd === null) return;
		position = suffixEnd;
		if (punctuationAt(tokens, position, ",")) {
			position += 1;
			continue;
		}
		inspectSqlStatement(tokens, position, end, mutations, nesting + 1);
		return;
	}
}

export function findEventTableSqlMutations(
	sqlText: string,
): EventTableSqlMutationKind[] {
	const tokens = tokenizeSql(sqlText);
	const mutations: EventTableSqlMutationKind[] = [];
	inspectSqlStatements(tokens, 0, tokens.length, mutations, 0);
	return mutations;
}

export interface ConstantSqlContext {
	checker: Checker;
	usePosition: number;
}

const MAX_CONSTANT_SQL_EVALUATION_DEPTH = 128;

const writeSymbolIndexCache = new WeakMap<
	ts.SourceFile,
	WeakMap<Checker, Set<TypeScriptSymbol>>
>();

function collectAssignmentTarget(
	target: ts.Node,
	writeSymbols: Set<TypeScriptSymbol>,
	checker: Checker,
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
	if (ts.isBinaryExpression(target)) {
		if (target.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
			collectAssignmentTarget(target.left, writeSymbols, checker);
		}
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
				collectAssignmentTarget(property.name, writeSymbols, checker);
			} else if (ts.isSpreadAssignment(property)) {
				collectAssignmentTarget(property.expression, writeSymbols, checker);
			}
		}
	}
}

function writeSymbolsFor(
	sourceFile: ts.SourceFile,
	checker: Checker,
): Set<TypeScriptSymbol> {
	let indexesByChecker = writeSymbolIndexCache.get(sourceFile);
	if (!indexesByChecker) {
		indexesByChecker = new WeakMap();
		writeSymbolIndexCache.set(sourceFile, indexesByChecker);
	}
	const existing = indexesByChecker.get(checker);
	if (existing) return existing;

	const writeSymbols = new Set<TypeScriptSymbol>();
	indexesByChecker.set(checker, writeSymbols);
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
		node.forEachChild(visit);
	};
	visit(sourceFile);
	return writeSymbols;
}

export function evaluateConstantSql(
	expression: ts.Expression,
	context: ConstantSqlContext,
): string | null {
	const activeSymbols = new Set<TypeScriptSymbol>();
	const evaluate = (
		candidate: ts.Expression,
		usePosition: number,
		depth: number,
	): string | null => {
		if (depth > MAX_CONSTANT_SQL_EVALUATION_DEPTH) {
			throw new ApprovalWorkflowEventAnalysisLimitError(
				"constant_evaluator_depth",
			);
		}
		if (
			ts.isStringLiteral(candidate) ||
			ts.isNoSubstitutionTemplateLiteral(candidate)
		) {
			return candidate.text;
		}
		if (
			ts.isParenthesizedExpression(candidate) ||
			ts.isAsExpression(candidate) ||
			ts.isTypeAssertion(candidate) ||
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
			return right === null ? null : left + right;
		}
		if (ts.isTemplateExpression(candidate)) {
			let result = candidate.head.text;
			for (const span of candidate.templateSpans) {
				const value = evaluate(span.expression, usePosition, depth + 1);
				if (value === null) return null;
				result += value + span.literal.text;
			}
			return result;
		}
		if (ts.isIdentifier(candidate)) {
			const symbol = context.checker.getSymbolAtLocation(candidate);
			const declarations = symbol?.declarations
				.map((declaration) => declaration.resolve())
				.filter((declaration) => declaration !== undefined);
			if (
				!symbol ||
				declarations?.length !== 1 ||
				!ts.isVariableDeclaration(declarations[0])
			) {
				return null;
			}
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
			) {
				return null;
			}

			if (activeSymbols.has(symbol)) return null;
			activeSymbols.add(symbol);
			try {
				return evaluate(
					declaration.initializer,
					declaration.initializer.getStart(declaration.getSourceFile()),
					depth + 1,
				);
			} finally {
				activeSymbols.delete(symbol);
			}
		}
		return null;
	};

	return evaluate(expression, context.usePosition, 0);
}
