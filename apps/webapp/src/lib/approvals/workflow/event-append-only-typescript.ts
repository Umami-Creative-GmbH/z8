import ts from "typescript";
import {
	ApprovalWorkflowEventAnalysisLimitError,
	evaluateConstantSql,
	findEventTableSqlMutations,
} from "./event-append-only-sql";

export interface ApprovalWorkflowEventMutationViolation {
	column: number;
	fileName: string;
	kind:
		| "drizzle_update"
		| "drizzle_delete"
		| "raw_sql_update"
		| "raw_sql_delete";
	line: number;
}

type Provenance =
	| "approval_db_service"
	| "database_namespace"
	| "database_receiver"
	| "drizzle_namespace"
	| "drizzle_node_pg_namespace"
	| "drizzle_factory"
	| "drizzle_sql"
	| "event_table"
	| "pg_namespace"
	| "pg_pool_constructor"
	| "schema_namespace"
	| "sql_raw";

interface SymbolWrite {
	conditional: boolean;
	declaration: boolean;
	position: number;
	propertyPath: readonly string[];
	value: ts.Expression;
}

const SCHEMA_MODULES = new Set([
	"@/db",
	"@/db/schema",
	"@/db/schema/approval-workflow",
]);

function normalizedFileName(fileName: string): string {
	return fileName.replaceAll("\\", "/");
}

function compareAscii(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedRelativeModulePath(
	fileName: string,
	moduleName: string,
): string {
	const segments = normalizedFileName(fileName).split("/");
	segments.pop();
	for (const segment of moduleName.replaceAll("\\", "/").split("/")) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			if (segments.at(-1) !== "") segments.pop();
			continue;
		}
		segments.push(segment);
	}
	return segments
		.join("/")
		.replace(/\.[cm]?tsx?$/, "")
		.replace(/\/index$/, "");
}

function isSchemaModule(moduleName: string, fileName: string): boolean {
	if (SCHEMA_MODULES.has(moduleName)) return true;
	if (!moduleName.startsWith(".")) return false;
	const resolved = normalizedRelativeModulePath(fileName, moduleName);
	return (
		resolved.endsWith("/apps/webapp/src/db") ||
		resolved.endsWith("/apps/webapp/src/db/schema") ||
		resolved.endsWith("/apps/webapp/src/db/schema/approval-workflow")
	);
}

function isDatabaseModule(moduleName: string, fileName: string): boolean {
	if (moduleName === "@/db") return true;
	if (!moduleName.startsWith(".")) return false;
	return normalizedRelativeModulePath(fileName, moduleName).endsWith(
		"/apps/webapp/src/db",
	);
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
	let current = expression;
	while (
		ts.isParenthesizedExpression(current) ||
		ts.isAsExpression(current) ||
		ts.isTypeAssertionExpression(current) ||
		ts.isNonNullExpression(current) ||
		ts.isSatisfiesExpression(current)
	) {
		current = current.expression;
	}
	return current;
}

function staticPropertyName(node: ts.Node): string | null {
	if (
		ts.isIdentifier(node) ||
		ts.isStringLiteralLike(node) ||
		ts.isNumericLiteral(node)
	) {
		return node.text;
	}
	return null;
}

function accessedProperty(
	expression: ts.Expression,
): { name: string; target: ts.Expression } | null {
	const unwrapped = unwrapExpression(expression);
	if (ts.isPropertyAccessExpression(unwrapped)) {
		return { name: unwrapped.name.text, target: unwrapped.expression };
	}
	if (ts.isElementAccessExpression(unwrapped) && unwrapped.argumentExpression) {
		const name = staticPropertyName(
			unwrapExpression(unwrapped.argumentExpression),
		);
		return name === null ? null : { name, target: unwrapped.expression };
	}
	return null;
}

function applyProperty(
	provenance: Provenance | null,
	propertyName: string,
): Provenance | null {
	if (
		provenance === "schema_namespace" &&
		propertyName === "approvalWorkflowEvent"
	) {
		return "event_table";
	}
	if (
		provenance === "database_namespace" &&
		propertyName === "approvalWorkflowEvent"
	) {
		return "event_table";
	}
	if (provenance === "database_namespace" && propertyName === "db") {
		return "database_receiver";
	}
	if (provenance === "drizzle_namespace" && propertyName === "sql") {
		return "drizzle_sql";
	}
	if (
		provenance === "drizzle_node_pg_namespace" &&
		propertyName === "drizzle"
	) {
		return "drizzle_factory";
	}
	if (provenance === "drizzle_sql" && propertyName === "raw") {
		return "sql_raw";
	}
	if (
		provenance === "pg_namespace" &&
		(propertyName === "Client" || propertyName === "Pool")
	) {
		return "pg_pool_constructor";
	}
	if (provenance === "approval_db_service" && propertyName === "db") {
		return "database_receiver";
	}
	return null;
}

function isApprovalDbServiceModule(
	moduleName: string,
	fileName: string,
): boolean {
	if (moduleName === "@/lib/approvals/server/types") return true;
	if (!moduleName.startsWith(".")) return false;
	const resolved = normalizedRelativeModulePath(fileName, moduleName);
	return resolved.endsWith("/apps/webapp/src/lib/approvals/server/types");
}

function isApprovalWorkflowPortsModule(
	moduleName: string,
	fileName: string,
): boolean {
	if (moduleName === "@/lib/approvals/workflow/ports") return true;
	if (!moduleName.startsWith(".")) return false;
	const resolved = normalizedRelativeModulePath(fileName, moduleName);
	return resolved.endsWith("/apps/webapp/src/lib/approvals/workflow/ports");
}

function createProgram(
	source: string,
	fileName: string,
): {
	checker: ts.TypeChecker;
	program: ts.Program;
	sourceFile: ts.SourceFile;
} {
	const normalized = normalizedFileName(fileName);
	const sourceFile = ts.createSourceFile(
		normalized,
		source,
		ts.ScriptTarget.Latest,
		true,
		fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const options: ts.CompilerOptions = {
		allowJs: false,
		module: ts.ModuleKind.ESNext,
		noLib: true,
		noResolve: true,
		target: ts.ScriptTarget.Latest,
	};
	const host: ts.CompilerHost = {
		fileExists: (candidate) => candidate === normalized,
		getCanonicalFileName: (candidate) => candidate,
		getCurrentDirectory: () => "/",
		getDefaultLibFileName: () => "lib.d.ts",
		getNewLine: () => "\n",
		getSourceFile: (candidate) =>
			candidate === normalized ? sourceFile : undefined,
		readFile: (candidate) => (candidate === normalized ? source : undefined),
		useCaseSensitiveFileNames: () => true,
		writeFile: () => undefined,
	};
	const program = ts.createProgram([normalized], options, host);
	return { checker: program.getTypeChecker(), program, sourceFile };
}

export function analyzeApprovalWorkflowEventMutations(
	source: string,
	fileName: string,
): ApprovalWorkflowEventMutationViolation[] {
	const { checker, program, sourceFile } = createProgram(source, fileName);
	const diagnostics = [...program.getSyntacticDiagnostics(sourceFile)].sort(
		(left, right) =>
			(left.start ?? 0) - (right.start ?? 0) || left.code - right.code,
	);
	const diagnostic = diagnostics[0];
	if (diagnostic) {
		const location = sourceFile.getLineAndCharacterOfPosition(
			diagnostic.start ?? 0,
		);
		throw new Error(
			`Approval workflow event mutation analysis parse error at ${normalizedFileName(fileName)}:${location.line + 1}:${location.character + 1} [TS${diagnostic.code}] ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
		);
	}
	const roots = new Map<ts.Symbol, Provenance>();
	const writes = new Map<ts.Symbol, SymbolWrite[]>();
	const knownTypeSymbols = new Map<ts.Symbol, Provenance>();
	const typedDeclarations: Array<{
		name: ts.BindingName;
		type: ts.TypeNode;
	}> = [];

	const addRoot = (identifier: ts.Identifier, provenance: Provenance): void => {
		const symbol = checker.getSymbolAtLocation(identifier);
		if (symbol) roots.set(symbol, provenance);
	};
	const addKnownType = (
		identifier: ts.Identifier,
		provenance: Provenance,
	): void => {
		const symbol = checker.getSymbolAtLocation(identifier);
		if (symbol) knownTypeSymbols.set(symbol, provenance);
	};
	const addWrite = (
		identifier: ts.Identifier,
		value: ts.Expression,
		position: number,
		propertyPath: readonly string[] = [],
		declaration = false,
		conditional = false,
	): void => {
		const symbol = checker.getSymbolAtLocation(identifier);
		if (!symbol) return;
		addSymbolWrite(
			symbol,
			value,
			position,
			propertyPath,
			declaration,
			conditional,
		);
	};
	const addSymbolWrite = (
		symbol: ts.Symbol,
		value: ts.Expression,
		position: number,
		propertyPath: readonly string[] = [],
		declaration = false,
		conditional = false,
	): void => {
		const symbolWrites = writes.get(symbol) ?? [];
		symbolWrites.push({
			conditional,
			declaration,
			position,
			propertyPath,
			value,
		});
		writes.set(symbol, symbolWrites);
	};
	const addBindingWrites = (
		name: ts.BindingName,
		value: ts.Expression,
		position: number,
		propertyPath: readonly string[] = [],
		conditional = false,
	): void => {
		if (ts.isIdentifier(name)) {
			addWrite(name, value, position, propertyPath, true, conditional);
			return;
		}
		for (const element of name.elements) {
			if (ts.isOmittedExpression(element)) continue;
			const propertyName = ts.isObjectBindingPattern(name)
				? staticPropertyName(element.propertyName ?? element.name)
				: String(name.elements.indexOf(element));
			if (propertyName === null) continue;
			addBindingWrites(
				element.name,
				value,
				position,
				[...propertyPath, propertyName],
				conditional,
			);
		}
	};
	const addAssignmentWrites = (
		target: ts.Expression,
		value: ts.Expression,
		position: number,
		propertyPath: readonly string[] = [],
		conditional = false,
	): void => {
		const candidate = unwrapExpression(target);
		if (ts.isIdentifier(candidate)) {
			addWrite(candidate, value, position, propertyPath, false, conditional);
			return;
		}
		if (
			ts.isBinaryExpression(candidate) &&
			candidate.operatorToken.kind === ts.SyntaxKind.EqualsToken
		) {
			addAssignmentWrites(
				candidate.left,
				value,
				position,
				propertyPath,
				conditional,
			);
			return;
		}
		if (ts.isObjectLiteralExpression(candidate)) {
			for (const property of candidate.properties) {
				if (ts.isPropertyAssignment(property)) {
					const propertyName = staticPropertyName(property.name);
					if (propertyName !== null) {
						addAssignmentWrites(
							property.initializer,
							value,
							position,
							[...propertyPath, propertyName],
							conditional,
						);
					}
				} else if (ts.isShorthandPropertyAssignment(property)) {
					const symbol = checker.getShorthandAssignmentValueSymbol(property);
					if (symbol) {
						addSymbolWrite(
							symbol,
							value,
							position,
							[...propertyPath, property.name.text],
							false,
							conditional,
						);
					}
				}
			}
			return;
		}
		if (ts.isArrayLiteralExpression(candidate)) {
			for (const [index, element] of candidate.elements.entries()) {
				if (ts.isOmittedExpression(element)) continue;
				addAssignmentWrites(
					ts.isSpreadElement(element) ? element.expression : element,
					value,
					position,
					[...propertyPath, String(index)],
					conditional,
				);
			}
		}
	};
	const isNestedAssignmentTarget = (node: ts.Node): boolean => {
		for (let parent = node.parent; parent; parent = parent.parent) {
			if (
				ts.isBinaryExpression(parent) &&
				parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
				node.getStart(sourceFile) >= parent.left.getStart(sourceFile) &&
				node.getEnd() <= parent.left.getEnd()
			) {
				return true;
			}
			if (ts.isStatement(parent)) return false;
		}
		return false;
	};
	const isWithin = (node: ts.Node, container: ts.Node): boolean =>
		node.getStart(sourceFile) >= container.getStart(sourceFile) &&
		node.getEnd() <= container.getEnd();
	const isConditionalWrite = (node: ts.Node): boolean => {
		for (let parent = node.parent; parent; parent = parent.parent) {
			if (
				ts.isIfStatement(parent) &&
				(isWithin(node, parent.thenStatement) ||
					(parent.elseStatement && isWithin(node, parent.elseStatement)))
			) {
				return true;
			}
			if (
				(ts.isForStatement(parent) ||
					ts.isForInStatement(parent) ||
					ts.isForOfStatement(parent) ||
					ts.isWhileStatement(parent) ||
					ts.isDoStatement(parent)) &&
				isWithin(node, parent.statement)
			) {
				return true;
			}
			if (
				ts.isTryStatement(parent) &&
				(isWithin(node, parent.tryBlock) ||
					(parent.catchClause && isWithin(node, parent.catchClause)))
			) {
				return true;
			}
			if (ts.isBinaryExpression(parent)) {
				const operatorKind = parent.operatorToken.kind;
				if (
					(operatorKind === ts.SyntaxKind.AmpersandAmpersandToken ||
						operatorKind === ts.SyntaxKind.BarBarToken ||
						operatorKind === ts.SyntaxKind.QuestionQuestionToken) &&
					isWithin(node, parent.right)
				) {
					return true;
				}
			}
			if (ts.isCaseClause(parent) || ts.isDefaultClause(parent)) return true;
			if (
				ts.isConditionalExpression(parent) &&
				(isWithin(node, parent.whenTrue) || isWithin(node, parent.whenFalse))
			) {
				return true;
			}
			if (ts.isFunctionLike(parent)) return false;
		}
		return false;
	};

	const index = (node: ts.Node): void => {
		if (
			ts.isImportDeclaration(node) &&
			node.importClause &&
			ts.isStringLiteralLike(node.moduleSpecifier)
		) {
			const moduleName = node.moduleSpecifier.text;
			const bindings = node.importClause.namedBindings;
			if (bindings && ts.isNamespaceImport(bindings)) {
				if (moduleName === "drizzle-orm") {
					addRoot(bindings.name, "drizzle_namespace");
				} else if (moduleName === "drizzle-orm/node-postgres") {
					addRoot(bindings.name, "drizzle_node_pg_namespace");
				} else if (moduleName === "pg") {
					addRoot(bindings.name, "pg_namespace");
				} else if (isDatabaseModule(moduleName, fileName)) {
					addRoot(bindings.name, "database_namespace");
				} else if (isSchemaModule(moduleName, fileName)) {
					addRoot(bindings.name, "schema_namespace");
				}
			} else if (bindings && ts.isNamedImports(bindings)) {
				for (const element of bindings.elements) {
					const importedName = (element.propertyName ?? element.name).text;
					if (
						moduleName === "pg" &&
						(importedName === "Client" ||
							importedName === "Pool" ||
							importedName === "PoolClient")
					) {
						addKnownType(element.name, "database_receiver");
						if (importedName === "Client" || importedName === "Pool") {
							addRoot(element.name, "pg_pool_constructor");
						}
					} else if (
						moduleName === "drizzle-orm/node-postgres" &&
						importedName === "drizzle"
					) {
						addRoot(element.name, "drizzle_factory");
					} else if (
						moduleName === "drizzle-orm/node-postgres" &&
						importedName === "NodePgDatabase"
					) {
						addKnownType(element.name, "database_receiver");
					} else if (
						(isApprovalDbServiceModule(moduleName, fileName) ||
							isApprovalWorkflowPortsModule(moduleName, fileName)) &&
						importedName === "ApprovalDbService"
					) {
						addKnownType(element.name, "approval_db_service");
					} else if (
						isApprovalWorkflowPortsModule(moduleName, fileName) &&
						importedName === "ApprovalTransactionClient"
					) {
						addKnownType(element.name, "database_receiver");
					} else if (
						isApprovalDbServiceModule(moduleName, fileName) &&
						importedName === "ApprovalDatabase"
					) {
						addKnownType(element.name, "database_receiver");
					} else if (moduleName === "drizzle-orm" && importedName === "sql") {
						addRoot(element.name, "drizzle_sql");
					} else if (
						isSchemaModule(moduleName, fileName) &&
						importedName === "approvalWorkflowEvent"
					) {
						addRoot(element.name, "event_table");
					} else if (
						isDatabaseModule(moduleName, fileName) &&
						importedName === "db"
					) {
						addRoot(element.name, "database_receiver");
					}
				}
			}
		}
		if (ts.isVariableDeclaration(node) && node.initializer) {
			addBindingWrites(
				node.name,
				node.initializer,
				node.initializer.getEnd(),
				[],
				isConditionalWrite(node),
			);
		}
		if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && node.type) {
			typedDeclarations.push({ name: node.name, type: node.type });
		}
		if (
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
			!isNestedAssignmentTarget(node)
		) {
			addAssignmentWrites(
				node.left,
				node.right,
				node.getEnd(),
				[],
				isConditionalWrite(node),
			);
		}
		if (
			(ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
			!ts.isVariableDeclarationList(node.initializer)
		) {
			addAssignmentWrites(
				node.initializer,
				node.expression,
				node.expression.getEnd(),
				[],
				true,
			);
		}
		ts.forEachChild(node, index);
	};
	index(sourceFile);
	const activeTypeSymbols = new Set<ts.Symbol>();
	const typeProvenance = (typeNode: ts.TypeNode): Provenance | null => {
		if (ts.isParenthesizedTypeNode(typeNode)) {
			return typeProvenance(typeNode.type);
		}
		if (ts.isTypeReferenceNode(typeNode)) {
			const symbol = checker.getSymbolAtLocation(typeNode.typeName);
			if (symbol) {
				const known = knownTypeSymbols.get(symbol);
				if (known) return known;
				if (activeTypeSymbols.has(symbol)) return null;
				const alias = symbol.declarations?.find(ts.isTypeAliasDeclaration);
				if (alias) {
					activeTypeSymbols.add(symbol);
					try {
						return typeProvenance(alias.type);
					} finally {
						activeTypeSymbols.delete(symbol);
					}
				}
			}
			if (ts.isQualifiedName(typeNode.typeName)) {
				const namespaceSymbol = checker.getSymbolAtLocation(
					typeNode.typeName.left,
				);
				const namespace = namespaceSymbol ? roots.get(namespaceSymbol) : null;
				if (
					namespace === "pg_namespace" &&
					(typeNode.typeName.right.text === "Client" ||
						typeNode.typeName.right.text === "Pool" ||
						typeNode.typeName.right.text === "PoolClient")
				) {
					return "database_receiver";
				}
				if (
					namespace === "drizzle_node_pg_namespace" &&
					typeNode.typeName.right.text === "NodePgDatabase"
				) {
					return "database_receiver";
				}
			}
			return null;
		}
		if (ts.isIndexedAccessTypeNode(typeNode)) {
			const propertyName = ts.isLiteralTypeNode(typeNode.indexType)
				? staticPropertyName(typeNode.indexType.literal)
				: null;
			return propertyName === "db" &&
				typeProvenance(typeNode.objectType) === "approval_db_service"
				? "database_receiver"
				: null;
		}
		if (ts.isImportTypeNode(typeNode)) {
			const moduleName = ts.isLiteralTypeNode(typeNode.argument)
				? staticPropertyName(typeNode.argument.literal)
				: null;
			const qualifier = typeNode.qualifier;
			const importedName =
				qualifier && ts.isIdentifier(qualifier) ? qualifier.text : null;
			if (
				moduleName === "pg" &&
				(importedName === "Client" ||
					importedName === "Pool" ||
					importedName === "PoolClient")
			) {
				return "database_receiver";
			}
			if (
				moduleName === "drizzle-orm/node-postgres" &&
				importedName === "NodePgDatabase"
			) {
				return "database_receiver";
			}
			if (
				moduleName &&
				(isApprovalDbServiceModule(moduleName, fileName) ||
					isApprovalWorkflowPortsModule(moduleName, fileName)) &&
				importedName === "ApprovalDbService"
			) {
				return "approval_db_service";
			}
			if (
				moduleName &&
				isApprovalWorkflowPortsModule(moduleName, fileName) &&
				importedName === "ApprovalTransactionClient"
			) {
				return "database_receiver";
			}
		}
		return null;
	};
	const objectPropertyType = (
		typeNode: ts.TypeNode,
		propertyName: string,
	): ts.TypeNode | null => {
		const candidate = ts.isParenthesizedTypeNode(typeNode)
			? typeNode.type
			: typeNode;
		if (!ts.isTypeLiteralNode(candidate)) return null;
		for (const member of candidate.members) {
			if (!ts.isPropertySignature(member) || !member.name || !member.type)
				continue;
			if (staticPropertyName(member.name) === propertyName) return member.type;
		}
		return null;
	};
	const addTypedBindingRoots = (
		name: ts.BindingName,
		typeNode: ts.TypeNode,
		provenance = typeProvenance(typeNode),
	): void => {
		if (ts.isIdentifier(name)) {
			if (provenance) addRoot(name, provenance);
			return;
		}
		if (!ts.isObjectBindingPattern(name)) return;
		for (const element of name.elements) {
			const propertyName = staticPropertyName(
				element.propertyName ?? element.name,
			);
			if (propertyName === null) continue;
			const propertyType = objectPropertyType(typeNode, propertyName);
			const propertyProvenance =
				applyProperty(provenance, propertyName) ??
				(propertyType ? typeProvenance(propertyType) : null);
			addTypedBindingRoots(
				element.name,
				propertyType ?? typeNode,
				propertyProvenance,
			);
		}
	};
	for (const declaration of typedDeclarations) {
		addTypedBindingRoots(declaration.name, declaration.type);
	}
	for (const symbolWrites of writes.values()) {
		symbolWrites.sort((left, right) => left.position - right.position);
	}

	const activeResolutions = new Map<ts.Symbol, Set<number>>();
	const resolveSymbol = (
		symbol: ts.Symbol,
		usePosition: number,
	): Provenance | null => {
		const activePositions = activeResolutions.get(symbol) ?? new Set<number>();
		if (activePositions.has(usePosition)) return null;
		activePositions.add(usePosition);
		activeResolutions.set(symbol, activePositions);
		try {
			const candidates = writes.get(symbol) ?? [];
			const reachingWrites = candidates.filter(
				(write) => write.position < usePosition,
			);
			let latestUnconditional = -1;
			for (const [index, write] of reachingWrites.entries()) {
				if (!write.conditional) latestUnconditional = index;
			}
			const possibleWrites = reachingWrites.slice(
				Math.max(latestUnconditional, 0),
			);
			const provenances = possibleWrites.map((write) => {
				let provenance = resolveExpression(write.value, write.position);
				if (provenance === null && write.declaration) {
					provenance = roots.get(symbol) ?? null;
				}
				for (const propertyName of write.propertyPath) {
					provenance = applyProperty(provenance, propertyName);
				}
				return provenance;
			});
			if (latestUnconditional === -1)
				provenances.push(roots.get(symbol) ?? null);
			if (provenances.includes("event_table")) return "event_table";
			return provenances.findLast((provenance) => provenance !== null) ?? null;
		} finally {
			activePositions.delete(usePosition);
		}
	};
	const resolveExpression = (
		expression: ts.Expression,
		usePosition: number,
	): Provenance | null => {
		const candidate = unwrapExpression(expression);
		if (
			ts.isBinaryExpression(candidate) &&
			candidate.operatorToken.kind === ts.SyntaxKind.EqualsToken
		) {
			return resolveExpression(candidate.right, usePosition);
		}
		if (ts.isIdentifier(candidate)) {
			const symbol = checker.getSymbolAtLocation(candidate);
			return symbol ? resolveSymbol(symbol, usePosition) : null;
		}
		if (ts.isNewExpression(candidate)) {
			return resolveExpression(candidate.expression, usePosition) ===
				"pg_pool_constructor"
				? "database_receiver"
				: null;
		}
		if (
			ts.isCallExpression(candidate) &&
			resolveExpression(candidate.expression, usePosition) === "drizzle_factory"
		) {
			return "database_receiver";
		}
		const access = accessedProperty(candidate);
		if (access) {
			return applyProperty(
				resolveExpression(access.target, usePosition),
				access.name,
			);
		}
		return null;
	};

	const violations: ApprovalWorkflowEventMutationViolation[] = [];
	const emit = (
		node: ts.Node,
		kind: ApprovalWorkflowEventMutationViolation["kind"],
	): void => {
		const location = sourceFile.getLineAndCharacterOfPosition(
			node.getStart(sourceFile),
		);
		violations.push({
			column: location.character + 1,
			fileName,
			kind,
			line: location.line + 1,
		});
	};
	const rethrowAnalysisLimit = (node: ts.Node, error: unknown): never => {
		if (!(error instanceof ApprovalWorkflowEventAnalysisLimitError))
			throw error;
		const location = sourceFile.getLineAndCharacterOfPosition(
			node.getStart(sourceFile),
		);
		throw new Error(
			`Approval workflow event mutation analysis failed at ${fileName}:${location.line + 1}:${location.character + 1}: ${error.message}`,
			{ cause: error },
		);
	};
	const inspectSql = (node: ts.Node, sqlText: string): void => {
		try {
			for (const kind of findEventTableSqlMutations(sqlText)) emit(node, kind);
		} catch (error) {
			rethrowAnalysisLimit(node, error);
		}
	};
	const inspectConstantSql = (
		node: ts.Node,
		expression: ts.Expression,
	): void => {
		try {
			const sqlText = evaluateConstantSql(unwrapExpression(expression), {
				checker,
				usePosition: node.getStart(sourceFile),
			});
			if (sqlText !== null) inspectSql(node, sqlText);
		} catch (error) {
			rethrowAnalysisLimit(node, error);
		}
	};
	const inspectTemplateSql = (
		node: ts.Node,
		template: ts.TemplateLiteral,
	): void => {
		if (ts.isNoSubstitutionTemplateLiteral(template)) {
			inspectSql(node, template.text);
			return;
		}
		try {
			let sqlText = template.head.text;
			for (const span of template.templateSpans) {
				const value =
					resolveExpression(span.expression, node.getStart(sourceFile)) ===
					"event_table"
						? "approval_workflow_event"
						: evaluateConstantSql(unwrapExpression(span.expression), {
								checker,
								usePosition: node.getStart(sourceFile),
							});
				sqlText += (value ?? " __dynamic_expression__ ") + span.literal.text;
			}
			inspectSql(node, sqlText);
		} catch (error) {
			rethrowAnalysisLimit(node, error);
		}
	};
	const inspect = (node: ts.Node): void => {
		if (ts.isCallExpression(node)) {
			const access = accessedProperty(node.expression);
			if (
				node.arguments[0] &&
				resolveExpression(node.expression, node.getStart(sourceFile)) ===
					"sql_raw"
			) {
				inspectConstantSql(node, node.arguments[0]);
			}
			if (
				access &&
				(access.name === "update" || access.name === "delete") &&
				node.arguments[0] &&
				resolveExpression(access.target, node.getStart(sourceFile)) ===
					"database_receiver" &&
				resolveExpression(node.arguments[0], node.getStart(sourceFile)) ===
					"event_table"
			) {
				emit(
					node,
					access.name === "update" ? "drizzle_update" : "drizzle_delete",
				);
			}
			if (
				access &&
				(access.name === "query" || access.name === "execute") &&
				node.arguments[0] &&
				resolveExpression(access.target, node.getStart(sourceFile)) ===
					"database_receiver"
			) {
				const argument = unwrapExpression(node.arguments[0]);
				if (
					ts.isTemplateExpression(argument) ||
					ts.isNoSubstitutionTemplateLiteral(argument)
				) {
					inspectTemplateSql(node, argument);
				} else {
					inspectConstantSql(node, argument);
				}
			}
		}
		if (
			ts.isTaggedTemplateExpression(node) &&
			resolveExpression(node.tag, node.getStart(sourceFile)) === "drizzle_sql"
		) {
			inspectTemplateSql(node, node.template);
		}
		ts.forEachChild(node, inspect);
	};
	inspect(sourceFile);

	const unique = new Map<string, ApprovalWorkflowEventMutationViolation>();
	for (const violation of violations) {
		unique.set(
			`${violation.fileName}\0${violation.line}\0${violation.column}\0${violation.kind}`,
			violation,
		);
	}
	return [...unique.values()].sort(
		(left, right) =>
			compareAscii(left.fileName, right.fileName) ||
			left.line - right.line ||
			left.column - right.column ||
			compareAscii(left.kind, right.kind),
	);
}
