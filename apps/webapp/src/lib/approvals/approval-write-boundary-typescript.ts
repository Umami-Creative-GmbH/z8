import ts from "typescript";
import {
	APPROVAL_DYNAMIC_SQL_MARKER,
	type ApprovalSourceMutationSemantic,
	type ApprovalSourceMutationUncertainty,
	ApprovalWriteBoundaryAnalysisLimitError,
	type ApprovalWriteOperation,
	createApprovalConstantEvaluationBudget,
	evaluateConstantApprovalSql,
	findProtectedApprovalSqlMutationLocations,
	type ProtectedWriteTable,
} from "./approval-write-boundary-sql";

export interface ApprovalWriteMutationLocation {
	column: number;
	columns?: readonly string[];
	fileName: string;
	functionName?: string;
	line: number;
	operation: ApprovalWriteOperation;
	semantic?: ApprovalSourceMutationSemantic;
	table: ProtectedWriteTable;
	uncertainty?: ApprovalSourceMutationUncertainty;
}

type Provenance =
	| "approval_db_service"
	| "bound_delete"
	| "bound_insert"
	| "bound_update"
	| "database_namespace"
	| "database_receiver"
	| "database_service_tag"
	| "drizzle_namespace"
	| "drizzle_node_pg_namespace"
	| "drizzle_factory"
	| "drizzle_sql"
	| "effect_generator_adapter"
	| "effect_namespace"
	| "pg_namespace"
	| "pg_pool_constructor"
	| "schema_namespace"
	| "sql_raw"
	| "transaction_container"
	| "update_rows_helper"
	| `table:${ProtectedWriteTable}`;

interface SymbolWrite {
	conditional: boolean;
	declaration: boolean;
	position: number;
	propertyPath: readonly string[];
	scope: ts.SignatureDeclaration | null;
	value: ts.Expression;
}

interface ObjectMutation {
	conditional: boolean;
	path: readonly string[] | null;
	position: number;
	scope: ts.SignatureDeclaration | null;
	unknown: boolean;
	value?: ts.Expression;
}

const TABLE_EXPORTS: Readonly<Record<string, ProtectedWriteTable>> = {
	approvalChainInstance: "approval_chain_instance",
	approvalChainStageInstance: "approval_chain_stage_instance",
	approvalInboxProjection: "approval_inbox_projection",
	approvalOutbox: "approval_outbox",
	approvalOutboxDelivery: "approval_outbox_delivery",
	approvalRequest: "approval_request",
	approvalRequesterProjection: "approval_requester_projection",
	approvalStageAssignment: "approval_stage_assignment",
	approvalWorkflow: "approval_workflow",
	approvalWorkflowCommand: "approval_workflow_command",
	approvalWorkflowEvent: "approval_workflow_event",
	approvalWorkflowMigrationIssue: "approval_workflow_migration_issue",
	approvalWorkflowRollout: "approval_workflow_rollout",
	approvalWorkflowStage: "approval_workflow_stage",
	timeEntry: "time_entry",
	timeRecord: "time_record",
	timeRecordAllocation: "time_record_allocation",
	timeRecordWork: "time_record_work",
	workPeriod: "work_period",
};

const SOURCE_TABLES = new Set<ProtectedWriteTable>([
	"time_entry",
	"work_period",
	"time_record",
	"time_record_work",
	"time_record_allocation",
]);
const SOURCE_COLUMN_NAMES: Readonly<Record<string, string>> = {
	allocationKind: "allocation_kind",
	approvalState: "approval_state",
	approvalStatus: "approval_status",
	approvalWorkflowId: "approval_workflow_id",
	canonicalRecordId: "canonical_record_id",
	clockInId: "clock_in_id",
	clockOutId: "clock_out_id",
	computationMetadata: "computation_metadata",
	costCenterId: "cost_center_id",
	createdAt: "created_at",
	durationMinutes: "duration_minutes",
	employeeId: "employee_id",
	endAt: "end_at",
	endTime: "end_time",
	id: "id",
	isSuperseded: "is_superseded",
	organizationId: "organization_id",
	pendingChanges: "pending_changes",
	projectId: "project_id",
	recordId: "record_id",
	recordKind: "record_kind",
	replacesEntryId: "replaces_entry_id",
	startAt: "start_at",
	startTime: "start_time",
	supersededById: "superseded_by_id",
	type: "type",
	weightPercent: "weight_percent",
	workCategoryId: "work_category_id",
	workLocationType: "work_location_type",
};
const TIME_ENTRY_LIFECYCLE_COLUMNS = new Set([
	"is_superseded",
	"replaces_entry_id",
	"superseded_by_id",
]);

const SCHEMA_MODULES = new Set([
	"@/db",
	"@/db/schema",
	"@/db/schema/approval",
	"@/db/schema/approval-policy",
	"@/db/schema/approval-workflow",
	"@/db/schema/time-record",
]);
const MAX_PROVENANCE_DEPTH = 128;
const MAX_HELPER_CALLS = 4_096;
const MAX_HELPER_PROPAGATION_ITERATIONS = 32;
const MAX_REACHING_WRITES = 256;
const MAX_TEMPLATE_EXPANDED_SQL_LENGTH = 32_768;
const MAX_TEMPLATE_VARIANTS = 256;
const CHAIN_SERVICE_PATH =
	"/apps/webapp/src/lib/approvals/policies/chain-service.ts";

function normalizeFileName(fileName: string): string {
	return fileName.replaceAll("\\", "/");
}

function relativeModulePath(fileName: string, moduleName: string): string {
	const segments = normalizeFileName(fileName).split("/");
	segments.pop();
	for (const segment of moduleName.replaceAll("\\", "/").split("/")) {
		if (!segment || segment === ".") continue;
		if (segment === "..") segments.pop();
		else segments.push(segment);
	}
	return segments
		.join("/")
		.replace(/\.[cm]?tsx?$/, "")
		.replace(/\/index$/, "");
}

function isSchemaModule(moduleName: string, fileName: string): boolean {
	if (SCHEMA_MODULES.has(moduleName)) return true;
	if (!moduleName.startsWith(".")) return false;
	const resolved = relativeModulePath(fileName, moduleName);
	return [
		"/apps/webapp/src/db",
		"/apps/webapp/src/db/schema",
		"/apps/webapp/src/db/schema/approval",
		"/apps/webapp/src/db/schema/approval-policy",
		"/apps/webapp/src/db/schema/approval-workflow",
		"/apps/webapp/src/db/schema/time-record",
	].some((suffix) => resolved.endsWith(suffix));
}

function isDatabaseModule(moduleName: string, fileName: string): boolean {
	return (
		moduleName === "@/db" ||
		(moduleName.startsWith(".") &&
			relativeModulePath(fileName, moduleName).endsWith("/apps/webapp/src/db"))
	);
}

function isApprovalDbTypesModule(
	moduleName: string,
	fileName: string,
): boolean {
	if (
		moduleName === "@/lib/approvals/server/types" ||
		moduleName === "@/lib/approvals/workflow/ports"
	) {
		return true;
	}
	if (!moduleName.startsWith(".")) return false;
	const resolved = relativeModulePath(fileName, moduleName);
	return (
		resolved.endsWith("/apps/webapp/src/lib/approvals/server/types") ||
		resolved.endsWith("/apps/webapp/src/lib/approvals/workflow/ports")
	);
}

function isDatabaseServiceModule(
	moduleName: string,
	fileName: string,
): boolean {
	if (moduleName === "@/lib/effect/services/database.service") return true;
	return (
		moduleName.startsWith(".") &&
		relativeModulePath(fileName, moduleName).endsWith(
			"/apps/webapp/src/lib/effect/services/database.service",
		)
	);
}

function unwrap(expression: ts.Expression): ts.Expression {
	let current = expression;
	while (true) {
		if (ts.isYieldExpression(current)) {
			if (!current.expression) return current;
			current = current.expression;
			continue;
		}
		if (
			ts.isParenthesizedExpression(current) ||
			ts.isAwaitExpression(current) ||
			ts.isAsExpression(current) ||
			ts.isTypeAssertionExpression(current) ||
			ts.isNonNullExpression(current) ||
			ts.isSatisfiesExpression(current)
		) {
			current = current.expression;
			continue;
		}
		return current;
	}
}

function staticName(node: ts.Node): string | null {
	return ts.isIdentifier(node) ||
		ts.isStringLiteralLike(node) ||
		ts.isNumericLiteral(node)
		? node.text
		: null;
}

function propertyAccess(
	expression: ts.Expression,
): { name: string; target: ts.Expression } | null {
	const candidate = unwrap(expression);
	if (ts.isPropertyAccessExpression(candidate)) {
		return { name: candidate.name.text, target: candidate.expression };
	}
	if (ts.isElementAccessExpression(candidate) && candidate.argumentExpression) {
		const argument = unwrap(candidate.argumentExpression);
		const name =
			ts.isStringLiteralLike(argument) || ts.isNumericLiteral(argument)
				? argument.text
				: null;
		return name === null ? null : { name, target: candidate.expression };
	}
	return null;
}

function applyProperty(
	provenance: Provenance,
	propertyName: string,
): Provenance | null {
	if (provenance === "database_namespace") {
		if (propertyName === "db") return "database_receiver";
		const table = TABLE_EXPORTS[propertyName];
		return table ? `table:${table}` : null;
	}
	if (provenance === "schema_namespace") {
		const table = TABLE_EXPORTS[propertyName];
		return table ? `table:${table}` : null;
	}
	if (provenance === "drizzle_namespace" && propertyName === "sql")
		return "drizzle_sql";
	if (provenance === "drizzle_node_pg_namespace" && propertyName === "drizzle")
		return "drizzle_factory";
	if (
		provenance === "pg_namespace" &&
		(propertyName === "Client" || propertyName === "Pool")
	)
		return "pg_pool_constructor";
	if (provenance === "drizzle_sql" && propertyName === "raw") return "sql_raw";
	if (provenance === "approval_db_service" && propertyName === "db") {
		return "database_receiver";
	}
	if (provenance === "transaction_container" && propertyName === "tx") {
		return "database_receiver";
	}
	if (provenance.startsWith("table:")) return null;
	if (provenance === "database_receiver") return null;
	return null;
}

function createProgram(
	source: string,
	fileName: string,
): {
	checker: ts.TypeChecker;
	program: ts.Program;
	sourceFile: ts.SourceFile;
} {
	const normalized = normalizeFileName(fileName);
	const extension = normalized.toLowerCase().split(".").at(-1);
	const scriptKind =
		extension === "js" || extension === "mjs" || extension === "cjs"
			? ts.ScriptKind.JS
			: extension === "jsx"
				? ts.ScriptKind.JSX
				: extension === "tsx"
					? ts.ScriptKind.TSX
					: ts.ScriptKind.TS;
	const sourceFile = ts.createSourceFile(
		normalized,
		source,
		ts.ScriptTarget.Latest,
		true,
		scriptKind,
	);
	const options: ts.CompilerOptions = {
		allowJs:
			scriptKind === ts.ScriptKind.JS || scriptKind === ts.ScriptKind.JSX,
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

function isWithin(
	node: ts.Node,
	container: ts.Node,
	sourceFile: ts.SourceFile,
): boolean {
	return (
		node.getStart(sourceFile) >= container.getStart(sourceFile) &&
		node.getEnd() <= container.getEnd()
	);
}

function isConditionalWrite(node: ts.Node, sourceFile: ts.SourceFile): boolean {
	for (let parent = node.parent; parent; parent = parent.parent) {
		if (
			ts.isIfStatement(parent) &&
			(isWithin(node, parent.thenStatement, sourceFile) ||
				(parent.elseStatement &&
					isWithin(node, parent.elseStatement, sourceFile)))
		) {
			return true;
		}
		if (
			(ts.isForStatement(parent) ||
				ts.isForInStatement(parent) ||
				ts.isForOfStatement(parent) ||
				ts.isWhileStatement(parent) ||
				ts.isDoStatement(parent)) &&
			isWithin(node, parent.statement, sourceFile)
		) {
			return true;
		}
		if (
			ts.isTryStatement(parent) &&
			(isWithin(node, parent.tryBlock, sourceFile) ||
				(parent.catchClause && isWithin(node, parent.catchClause, sourceFile)))
		) {
			return true;
		}
		if (ts.isBinaryExpression(parent)) {
			const operatorKind = parent.operatorToken.kind;
			if (
				(operatorKind === ts.SyntaxKind.AmpersandAmpersandToken ||
					operatorKind === ts.SyntaxKind.BarBarToken ||
					operatorKind === ts.SyntaxKind.QuestionQuestionToken) &&
				isWithin(node, parent.right, sourceFile)
			) {
				return true;
			}
		}
		if (ts.isCaseClause(parent) || ts.isDefaultClause(parent)) return true;
		if (
			ts.isConditionalExpression(parent) &&
			(isWithin(node, parent.whenTrue, sourceFile) ||
				isWithin(node, parent.whenFalse, sourceFile))
		) {
			return true;
		}
		if (ts.isFunctionLike(parent)) return false;
	}
	return false;
}

function compareAscii(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function analyzeApprovalWriteMutations(
	source: string,
	fileName: string,
): ApprovalWriteMutationLocation[] {
	const { checker, program, sourceFile } = createProgram(source, fileName);
	const constantEvaluationBudget = createApprovalConstantEvaluationBudget();
	const diagnostic = [...program.getSyntacticDiagnostics(sourceFile)].sort(
		(left, right) =>
			(left.start ?? 0) - (right.start ?? 0) || left.code - right.code,
	)[0];
	if (diagnostic) {
		const location = sourceFile.getLineAndCharacterOfPosition(
			diagnostic.start ?? 0,
		);
		throw new Error(
			`Approval write boundary analysis parse error at ${normalizeFileName(fileName)}:${location.line + 1}:${location.character + 1} [TS${diagnostic.code}] ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
		);
	}

	const roots = new Map<ts.Symbol, Set<Provenance>>();
	const knownTypes = new Map<ts.Symbol, Provenance>();
	const writes = new Map<ts.Symbol, SymbolWrite[]>();
	const objectMutations = new Map<ts.Symbol, ObjectMutation[]>();
	const typedDeclarations: Array<{ name: ts.BindingName; type: ts.TypeNode }> =
		[];
	const transactionCallbacks: Array<{
		callPosition: number;
		parameter: ts.BindingName;
		target: ts.Expression;
	}> = [];
	const localFunctions = new Map<ts.Symbol, ts.FunctionLikeDeclaration>();
	const possibleHelperCalls: ts.CallExpression[] = [];
	const effectGeneratorCallbacks: Array<{
		parameter: ts.BindingName;
		target: ts.Expression;
	}> = [];
	const enclosingFunction = (node: ts.Node): ts.SignatureDeclaration | null => {
		for (let parent = node.parent; parent; parent = parent.parent) {
			if (ts.isFunctionLike(parent)) return parent;
		}
		return null;
	};
	const scopeCanReach = (
		writeScope: ts.SignatureDeclaration | null,
		useScope: ts.SignatureDeclaration | null,
	): boolean => {
		if (writeScope === null) return true;
		for (let scope = useScope; scope; scope = enclosingFunction(scope)) {
			if (scope === writeScope) return true;
		}
		return false;
	};
	const addRoot = (identifier: ts.Identifier, provenance: Provenance): void => {
		const symbol = checker.getSymbolAtLocation(identifier);
		if (!symbol) return;
		const values = roots.get(symbol) ?? new Set<Provenance>();
		values.add(provenance);
		roots.set(symbol, values);
	};
	const addSymbolWrite = (
		symbol: ts.Symbol,
		value: ts.Expression,
		position: number,
		propertyPath: readonly string[] = [],
		declaration = false,
		conditional = false,
		scopeNode?: ts.Node,
	): void => {
		const values = writes.get(symbol) ?? [];
		values.push({
			conditional,
			declaration,
			position,
			propertyPath,
			scope: enclosingFunction(scopeNode ?? value),
			value,
		});
		writes.set(symbol, values);
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
			identifier,
		);
	};
	const objectMutationTarget = (
		expression: ts.Expression,
	): { path: readonly string[] | null; root: ts.Identifier } | null => {
		const candidate = unwrap(expression);
		if (ts.isIdentifier(candidate)) return { path: [], root: candidate };
		if (ts.isPropertyAccessExpression(candidate)) {
			const target = objectMutationTarget(candidate.expression);
			return target
				? {
						path: target.path ? [...target.path, candidate.name.text] : null,
						root: target.root,
					}
				: null;
		}
		if (
			ts.isElementAccessExpression(candidate) &&
			candidate.argumentExpression
		) {
			const target = objectMutationTarget(candidate.expression);
			if (!target) return null;
			const argument = unwrap(candidate.argumentExpression);
			const name =
				ts.isStringLiteralLike(argument) || ts.isNumericLiteral(argument)
					? argument.text
					: null;
			return {
				path: target.path && name !== null ? [...target.path, name] : null,
				root: target.root,
			};
		}
		return null;
	};
	const addObjectMutation = (
		expression: ts.Expression,
		mutation: Omit<ObjectMutation, "conditional" | "path" | "scope">,
	): void => {
		const target = objectMutationTarget(expression);
		if (!target) return;
		const symbol = checker.getSymbolAtLocation(target.root);
		if (!symbol) return;
		const mutations = objectMutations.get(symbol) ?? [];
		mutations.push({
			...mutation,
			conditional: isConditionalWrite(expression, sourceFile),
			path: target.path,
			scope: enclosingFunction(expression),
		});
		objectMutations.set(symbol, mutations);
	};
	const addBinding = (
		name: ts.BindingName,
		value: ts.Expression,
		position: number,
		propertyPath: readonly string[] = [],
		declaration = true,
		conditional = false,
	): void => {
		if (ts.isIdentifier(name)) {
			addWrite(name, value, position, propertyPath, declaration, conditional);
			return;
		}
		for (const [index, element] of name.elements.entries()) {
			if (ts.isOmittedExpression(element)) continue;
			const propertyName = ts.isObjectBindingPattern(name)
				? staticName(element.propertyName ?? element.name)
				: String(index);
			if (propertyName !== null) {
				addBinding(
					element.name,
					value,
					position,
					[...propertyPath, propertyName],
					declaration,
					conditional || element.initializer !== undefined,
				);
			}
			if (element.initializer) {
				addBinding(
					element.name,
					element.initializer,
					element.initializer.getEnd(),
					[],
					declaration,
					true,
				);
			}
		}
	};
	const addAssignment = (
		target: ts.Expression,
		value: ts.Expression,
		position: number,
		propertyPath: readonly string[] = [],
		conditional = false,
	): void => {
		const candidate = unwrap(target);
		if (ts.isIdentifier(candidate)) {
			addWrite(candidate, value, position, propertyPath, false, conditional);
			return;
		}
		if (
			ts.isBinaryExpression(candidate) &&
			candidate.operatorToken.kind === ts.SyntaxKind.EqualsToken
		) {
			addAssignment(candidate.left, value, position, propertyPath, true);
			addAssignment(
				candidate.left,
				candidate.right,
				candidate.right.getEnd(),
				[],
				true,
			);
			return;
		}
		if (ts.isObjectLiteralExpression(candidate)) {
			for (const property of candidate.properties) {
				if (ts.isPropertyAssignment(property)) {
					const propertyName = staticName(property.name);
					if (propertyName !== null) {
						addAssignment(
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
							conditional || property.objectAssignmentInitializer !== undefined,
							property.name,
						);
						if (property.objectAssignmentInitializer) {
							addSymbolWrite(
								symbol,
								property.objectAssignmentInitializer,
								property.objectAssignmentInitializer.getEnd(),
								[],
								false,
								true,
								property.name,
							);
						}
					}
				}
			}
			return;
		}
		if (ts.isArrayLiteralExpression(candidate)) {
			for (const [index, element] of candidate.elements.entries()) {
				if (ts.isOmittedExpression(element)) continue;
				addAssignment(
					ts.isSpreadElement(element) ? element.expression : element,
					value,
					position,
					[...propertyPath, String(index)],
					conditional,
				);
			}
		}
	};

	const activeTypeSymbols = new Set<ts.Symbol>();
	const containsTrustedTransactionType = (typeNode: ts.TypeNode): boolean => {
		let trusted = false;
		const visit = (node: ts.Node): void => {
			if (trusted) return;
			if (ts.isTypeQueryNode(node) && ts.isQualifiedName(node.exprName)) {
				const receiver = node.exprName.left;
				const symbol = checker.getSymbolAtLocation(receiver);
				if (
					symbol &&
					roots.get(symbol)?.has("database_receiver") &&
					node.exprName.right.text === "transaction"
				) {
					trusted = true;
					return;
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(typeNode);
		return trusted;
	};
	const typeProvenance = (typeNode: ts.TypeNode): Provenance | null => {
		const candidate = ts.isParenthesizedTypeNode(typeNode)
			? typeNode.type
			: typeNode;
		if (ts.isTypeQueryNode(candidate) && ts.isIdentifier(candidate.exprName)) {
			const symbol = checker.getSymbolAtLocation(candidate.exprName);
			if (symbol && roots.get(symbol)?.has("database_receiver")) {
				return "database_receiver";
			}
		}
		if (ts.isTypeLiteralNode(candidate)) {
			for (const member of candidate.members) {
				if (
					ts.isPropertySignature(member) &&
					member.type &&
					member.name &&
					staticName(member.name) === "tx" &&
					typeProvenance(member.type) === "database_receiver"
				) {
					return "transaction_container";
				}
			}
			return null;
		}
		if (ts.isTypeReferenceNode(candidate)) {
			if (
				ts.isIdentifier(candidate.typeName) &&
				candidate.typeName.text === "Pick" &&
				candidate.typeArguments?.[0] &&
				typeProvenance(candidate.typeArguments[0]) === "database_receiver"
			) {
				return "database_receiver";
			}
			const symbol = checker.getSymbolAtLocation(candidate.typeName);
			if (symbol && knownTypes.has(symbol))
				return knownTypes.get(symbol) ?? null;
			if (symbol && !activeTypeSymbols.has(symbol)) {
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
			if (ts.isQualifiedName(candidate.typeName)) {
				const left = checker.getSymbolAtLocation(candidate.typeName.left);
				const namespace = left ? roots.get(left) : undefined;
				if (
					namespace?.has("drizzle_node_pg_namespace") &&
					candidate.typeName.right.text === "NodePgDatabase"
				) {
					return "database_receiver";
				}
				if (
					namespace?.has("pg_namespace") &&
					(candidate.typeName.right.text === "Client" ||
						candidate.typeName.right.text === "Pool" ||
						candidate.typeName.right.text === "PoolClient")
				) {
					return "database_receiver";
				}
			}
		}
		if (ts.isImportTypeNode(candidate)) {
			const moduleName = ts.isLiteralTypeNode(candidate.argument)
				? staticName(candidate.argument.literal)
				: null;
			const importedName =
				candidate.qualifier && ts.isIdentifier(candidate.qualifier)
					? candidate.qualifier.text
					: null;
			if (
				(moduleName === "pg" &&
					(importedName === "Client" ||
						importedName === "Pool" ||
						importedName === "PoolClient")) ||
				(moduleName === "drizzle-orm/node-postgres" &&
					importedName === "NodePgDatabase")
			) {
				return "database_receiver";
			}
			if (
				moduleName &&
				isApprovalDbTypesModule(moduleName, fileName) &&
				importedName === "ApprovalDbService"
			) {
				return "approval_db_service";
			}
			if (
				moduleName &&
				isApprovalDbTypesModule(moduleName, fileName) &&
				(importedName === "ApprovalDatabase" ||
					importedName === "ApprovalTransactionClient")
			) {
				return "database_receiver";
			}
		}
		if (ts.isIndexedAccessTypeNode(candidate)) {
			const propertyName = ts.isLiteralTypeNode(candidate.indexType)
				? staticName(candidate.indexType.literal)
				: null;
			if (
				propertyName === "db" &&
				typeProvenance(candidate.objectType) === "approval_db_service"
			) {
				return "database_receiver";
			}
			return containsTrustedTransactionType(candidate)
				? "database_receiver"
				: null;
		}
		if (containsTrustedTransactionType(candidate)) return "database_receiver";
		return null;
	};

	const index = (node: ts.Node): void => {
		if (ts.isFunctionDeclaration(node) && node.name) {
			const symbol = checker.getSymbolAtLocation(node.name);
			if (symbol) localFunctions.set(symbol, node);
		}
		if (
			ts.isImportDeclaration(node) &&
			node.importClause &&
			ts.isStringLiteralLike(node.moduleSpecifier)
		) {
			const moduleName = node.moduleSpecifier.text;
			const bindings = node.importClause.namedBindings;
			if (bindings && ts.isNamespaceImport(bindings)) {
				if (moduleName === "effect") addRoot(bindings.name, "effect_namespace");
				else if (moduleName === "drizzle-orm")
					addRoot(bindings.name, "drizzle_namespace");
				else if (moduleName === "drizzle-orm/node-postgres") {
					addRoot(bindings.name, "drizzle_node_pg_namespace");
				} else if (moduleName === "pg") addRoot(bindings.name, "pg_namespace");
				else if (isDatabaseModule(moduleName, fileName)) {
					addRoot(bindings.name, "database_namespace");
				} else if (isSchemaModule(moduleName, fileName)) {
					addRoot(bindings.name, "schema_namespace");
				}
			} else if (bindings && ts.isNamedImports(bindings)) {
				for (const element of bindings.elements) {
					const importedName = (element.propertyName ?? element.name).text;
					const table = isSchemaModule(moduleName, fileName)
						? TABLE_EXPORTS[importedName]
						: undefined;
					if (moduleName === "effect" && importedName === "Effect") {
						addRoot(element.name, "effect_namespace");
					} else if (table) addRoot(element.name, `table:${table}`);
					else if (moduleName === "drizzle-orm" && importedName === "sql") {
						addRoot(element.name, "drizzle_sql");
					} else if (
						moduleName === "drizzle-orm/node-postgres" &&
						importedName === "drizzle"
					) {
						addRoot(element.name, "drizzle_factory");
					} else if (
						isDatabaseModule(moduleName, fileName) &&
						importedName === "db"
					) {
						addRoot(element.name, "database_receiver");
					} else if (
						isApprovalDbTypesModule(moduleName, fileName) &&
						importedName === "ApprovalDbService"
					) {
						const symbol = checker.getSymbolAtLocation(element.name);
						if (symbol) knownTypes.set(symbol, "approval_db_service");
					} else if (
						isDatabaseServiceModule(moduleName, fileName) &&
						importedName === "DatabaseService"
					) {
						addRoot(element.name, "database_service_tag");
					} else if (
						(moduleName === "pg" &&
							(importedName === "Client" ||
								importedName === "Pool" ||
								importedName === "PoolClient")) ||
						(moduleName === "drizzle-orm/node-postgres" &&
							importedName === "NodePgDatabase") ||
						(isApprovalDbTypesModule(moduleName, fileName) &&
							(importedName === "ApprovalDatabase" ||
								importedName === "ApprovalTransactionClient"))
					) {
						const symbol = checker.getSymbolAtLocation(element.name);
						if (symbol) knownTypes.set(symbol, "database_receiver");
						if (
							moduleName === "pg" &&
							(importedName === "Client" || importedName === "Pool")
						) {
							addRoot(element.name, "pg_pool_constructor");
						}
					}
				}
			}
		}
		if (ts.isVariableDeclaration(node) && node.initializer) {
			if (
				ts.isIdentifier(node.name) &&
				(ts.isArrowFunction(node.initializer) ||
					ts.isFunctionExpression(node.initializer))
			) {
				const symbol = checker.getSymbolAtLocation(node.name);
				if (symbol) localFunctions.set(symbol, node.initializer);
			}
			addBinding(
				node.name,
				node.initializer,
				node.initializer.getEnd(),
				[],
				true,
				isConditionalWrite(node, sourceFile),
			);
		}
		if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && node.type) {
			typedDeclarations.push({ name: node.name, type: node.type });
		}
		if (ts.isParameter(node) && node.initializer) {
			addBinding(
				node.name,
				node.initializer,
				node.initializer.getEnd(),
				[],
				true,
				false,
			);
		}
		if (ts.isCallExpression(node)) {
			possibleHelperCalls.push(node);
			const access = propertyAccess(node.expression);
			const assignTarget = access ? unwrap(access.target) : null;
			const assignSymbol =
				assignTarget && ts.isIdentifier(assignTarget)
					? checker.getSymbolAtLocation(assignTarget)
					: undefined;
			const globalObjectAssign =
				access?.name === "assign" &&
				assignTarget &&
				ts.isIdentifier(assignTarget) &&
				assignTarget.text === "Object" &&
				!assignSymbol?.declarations?.length;
			if (globalObjectAssign && node.arguments[0]) {
				addObjectMutation(node.arguments[0], {
					position: node.getEnd(),
					unknown: true,
				});
			} else {
				for (const argument of node.arguments) {
					addObjectMutation(argument, {
						position: node.getEnd(),
						unknown: true,
					});
				}
			}
			const callback = node.arguments[0];
			if (
				access?.name === "gen" &&
				callback &&
				(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
				callback.parameters[0]
			) {
				effectGeneratorCallbacks.push({
					parameter: callback.parameters[0].name,
					target: access.target,
				});
			}
			if (
				access?.name === "transaction" &&
				callback &&
				(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
				callback.parameters[0]
			) {
				transactionCallbacks.push({
					callPosition: node.getStart(sourceFile),
					parameter: callback.parameters[0].name,
					target: access.target,
				});
			}
		}
		if (
			ts.isBinaryExpression(node) &&
			(node.operatorToken.kind === ts.SyntaxKind.EqualsToken ||
				node.operatorToken.kind === ts.SyntaxKind.BarBarEqualsToken ||
				node.operatorToken.kind ===
					ts.SyntaxKind.AmpersandAmpersandEqualsToken ||
				node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionEqualsToken)
		) {
			if (!ts.isIdentifier(unwrap(node.left))) {
				addObjectMutation(node.left, {
					position: node.getEnd(),
					unknown: node.operatorToken.kind !== ts.SyntaxKind.EqualsToken,
					value: node.right,
				});
			}
			addAssignment(
				node.left,
				node.right,
				node.getEnd(),
				[],
				node.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
					isConditionalWrite(node, sourceFile),
			);
		}
		if (
			(ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
			!ts.isVariableDeclarationList(node.initializer)
		) {
			addAssignment(
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
	const addTypedBinding = (
		name: ts.BindingName,
		provenance: Provenance | null,
	): void => {
		if (ts.isIdentifier(name)) {
			if (provenance) addRoot(name, provenance);
			return;
		}
		if (!ts.isObjectBindingPattern(name) || !provenance) return;
		for (const element of name.elements) {
			const propertyName = staticName(element.propertyName ?? element.name);
			if (propertyName === null) continue;
			addTypedBinding(element.name, applyProperty(provenance, propertyName));
		}
	};
	for (const callback of effectGeneratorCallbacks) {
		const target = unwrap(callback.target);
		if (!ts.isIdentifier(target)) continue;
		const symbol = checker.getSymbolAtLocation(target);
		if (symbol && roots.get(symbol)?.has("effect_namespace")) {
			addTypedBinding(callback.parameter, "effect_generator_adapter");
		}
	}
	for (const declaration of typedDeclarations) {
		addTypedBinding(declaration.name, typeProvenance(declaration.type));
	}
	const helperIndex = (node: ts.Node): void => {
		if (
			normalizeFileName(fileName).endsWith(CHAIN_SERVICE_PATH) &&
			ts.isFunctionDeclaration(node) &&
			node.name?.text === "updateRows" &&
			node.parameters.length >= 2 &&
			node.parameters[0]?.type &&
			typeProvenance(node.parameters[0].type) === "approval_db_service"
		) {
			addRoot(node.name, "update_rows_helper");
		}
		ts.forEachChild(node, helperIndex);
	};
	helperIndex(sourceFile);
	for (const symbolWrites of writes.values()) {
		symbolWrites.sort((left, right) => left.position - right.position);
	}
	const writesByScope = new Map<
		ts.Symbol,
		Map<ts.SignatureDeclaration | null, SymbolWrite[]>
	>();
	for (const [symbol, symbolWrites] of writes) {
		const byScope = new Map<ts.SignatureDeclaration | null, SymbolWrite[]>();
		for (const write of symbolWrites) {
			const scopeWrites = byScope.get(write.scope) ?? [];
			scopeWrites.push(write);
			byScope.set(write.scope, scopeWrites);
		}
		writesByScope.set(symbol, byScope);
	}
	const priorWriteCount = (
		symbolWrites: readonly SymbolWrite[],
		usePosition: number,
	): number => {
		let low = 0;
		let high = symbolWrites.length;
		while (low < high) {
			const middle = low + Math.floor((high - low) / 2);
			if ((symbolWrites[middle]?.position ?? usePosition) < usePosition)
				low = middle + 1;
			else high = middle;
		}
		return low;
	};

	const active = new Map<ts.Symbol, Set<number>>();
	const resolveSymbol = (
		symbol: ts.Symbol,
		usePosition: number,
		depth: number,
		useScope: ts.SignatureDeclaration | null,
	): Set<Provenance> => {
		if (depth > MAX_PROVENANCE_DEPTH) {
			throw new ApprovalWriteBoundaryAnalysisLimitError(
				"constant_evaluator_depth",
			);
		}
		const positions = active.get(symbol) ?? new Set<number>();
		if (positions.has(usePosition)) return new Set();
		positions.add(usePosition);
		active.set(symbol, positions);
		try {
			const scopedWrites = writesByScope.get(symbol) ?? new Map();
			const relevant: Array<{
				end: number;
				unionAll: boolean;
				writes: SymbolWrite[];
			}> = [];
			for (const [scope, scopeWrites] of scopedWrites) {
				if (!scopeCanReach(scope, useScope)) continue;
				relevant.push({
					end:
						scope === useScope
							? priorWriteCount(scopeWrites, usePosition)
							: scopeWrites.length,
					unionAll: scope !== useScope,
					writes: scopeWrites,
				});
			}
			let latestUnconditionalPosition = -1;
			let searchedWrites = 0;
			for (const entry of relevant) {
				if (entry.unionAll) continue;
				for (let index = entry.end - 1; index >= 0; index -= 1) {
					searchedWrites += 1;
					if (searchedWrites > MAX_REACHING_WRITES) {
						throw new ApprovalWriteBoundaryAnalysisLimitError(
							"typescript_reaching_write_count",
						);
					}
					const write = entry.writes[index];
					if (write && !write.conditional) {
						latestUnconditionalPosition = Math.max(
							latestUnconditionalPosition,
							write.position,
						);
						break;
					}
				}
			}
			const candidates: SymbolWrite[] = [];
			for (const entry of relevant) {
				for (let index = entry.end - 1; index >= 0; index -= 1) {
					const write = entry.writes[index];
					if (
						!write ||
						(!entry.unionAll && write.position < latestUnconditionalPosition)
					)
						break;
					candidates.push(write);
					if (candidates.length > MAX_REACHING_WRITES) {
						throw new ApprovalWriteBoundaryAnalysisLimitError(
							"typescript_reaching_write_count",
						);
					}
				}
			}
			candidates.sort((left, right) => left.position - right.position);
			const result = new Set<Provenance>();
			if (latestUnconditionalPosition === -1) {
				for (const root of roots.get(symbol) ?? []) result.add(root);
			}
			for (const write of candidates) {
				let values = resolveExpression(write.value, write.position, depth + 1);
				if (values.size === 0 && write.declaration) {
					values = new Set(roots.get(symbol) ?? []);
				}
				for (const propertyName of write.propertyPath) {
					values = new Set(
						[...values]
							.map((value) => applyProperty(value, propertyName))
							.filter((value): value is Provenance => value !== null),
					);
				}
				for (const value of values) result.add(value);
			}
			return result;
		} finally {
			positions.delete(usePosition);
		}
	};
	let objectPropertyExpressions: (
		expression: ts.Expression,
		propertyPath: readonly string[],
		usePosition: number,
		depth: number,
		activeSymbols?: Set<ts.Symbol>,
	) => Set<ts.Expression>;
	const staticObjectPath = (
		expression: ts.Expression,
	): { path: readonly string[]; root: ts.Expression } => {
		const access = propertyAccess(expression);
		if (!access) return { path: [], root: unwrap(expression) };
		const target = staticObjectPath(access.target);
		return { path: [...target.path, access.name], root: target.root };
	};
	const resolveExpression = (
		expression: ts.Expression,
		usePosition: number,
		depth = 0,
	): Set<Provenance> => {
		if (
			ts.isAsExpression(expression) ||
			ts.isTypeAssertionExpression(expression)
		) {
			const asserted = typeProvenance(expression.type);
			return asserted
				? new Set([asserted])
				: resolveExpression(expression.expression, usePosition, depth + 1);
		}
		if (ts.isYieldExpression(expression) && expression.expression) {
			const yielded = resolveExpression(
				expression.expression,
				usePosition,
				depth + 1,
			);
			return yielded.has("database_service_tag")
				? new Set(["approval_db_service"])
				: yielded;
		}
		const candidate = unwrap(expression);
		if (
			ts.isBinaryExpression(candidate) &&
			candidate.operatorToken.kind === ts.SyntaxKind.EqualsToken
		) {
			return resolveExpression(candidate.right, usePosition, depth + 1);
		}
		if (ts.isIdentifier(candidate)) {
			const symbol =
				ts.isShorthandPropertyAssignment(candidate.parent) &&
				candidate.parent.name === candidate &&
				!candidate.parent.objectAssignmentInitializer
					? checker.getShorthandAssignmentValueSymbol(candidate.parent)
					: checker.getSymbolAtLocation(candidate);
			return symbol
				? resolveSymbol(
						symbol,
						usePosition,
						depth + 1,
						enclosingFunction(candidate),
					)
				: new Set();
		}
		if (ts.isConditionalExpression(candidate)) {
			return new Set([
				...resolveExpression(candidate.whenTrue, usePosition, depth + 1),
				...resolveExpression(candidate.whenFalse, usePosition, depth + 1),
			]);
		}
		if (ts.isArrayLiteralExpression(candidate)) {
			return new Set(
				candidate.elements.flatMap((element) => [
					...resolveExpression(
						ts.isSpreadElement(element) ? element.expression : element,
						usePosition,
						depth + 1,
					),
				]),
			);
		}
		if (ts.isNewExpression(candidate)) {
			return resolveExpression(
				candidate.expression,
				usePosition,
				depth + 1,
			).has("pg_pool_constructor")
				? new Set(["database_receiver"])
				: new Set();
		}
		if (ts.isCallExpression(candidate)) {
			if (
				candidate.arguments.length === 1 &&
				candidate.arguments[0] &&
				resolveExpression(candidate.expression, usePosition, depth + 1).has(
					"effect_generator_adapter",
				) &&
				resolveExpression(candidate.arguments[0], usePosition, depth + 1).has(
					"database_service_tag",
				)
			) {
				return new Set(["approval_db_service"]);
			}
			const moduleName =
				candidate.arguments[0] && ts.isStringLiteralLike(candidate.arguments[0])
					? candidate.arguments[0].text
					: null;
			const isDynamicImport =
				candidate.expression.kind === ts.SyntaxKind.ImportKeyword;
			const isUnshadowedRequire =
				ts.isIdentifier(candidate.expression) &&
				candidate.expression.text === "require" &&
				!checker.getSymbolAtLocation(candidate.expression)?.declarations
					?.length;
			if (moduleName && (isDynamicImport || isUnshadowedRequire)) {
				if (moduleName === "drizzle-orm") return new Set(["drizzle_namespace"]);
				if (moduleName === "drizzle-orm/node-postgres")
					return new Set(["drizzle_node_pg_namespace"]);
				if (moduleName === "pg") return new Set(["pg_namespace"]);
				if (isDatabaseModule(moduleName, fileName))
					return new Set(["database_namespace"]);
				if (isSchemaModule(moduleName, fileName))
					return new Set(["schema_namespace"]);
			}
			if (
				resolveExpression(candidate.expression, usePosition, depth + 1).has(
					"drizzle_factory",
				)
			) {
				return new Set(["database_receiver"]);
			}
			const bindAccess = propertyAccess(candidate.expression);
			const methodAccess = bindAccess
				? propertyAccess(bindAccess.target)
				: null;
			if (
				bindAccess?.name === "bind" &&
				methodAccess &&
				(methodAccess.name === "delete" ||
					methodAccess.name === "insert" ||
					methodAccess.name === "update") &&
				candidate.arguments[0] &&
				resolveExpression(methodAccess.target, usePosition, depth + 1).has(
					"database_receiver",
				) &&
				resolveExpression(candidate.arguments[0], usePosition, depth + 1).has(
					"database_receiver",
				)
			) {
				return new Set([`bound_${methodAccess.name}` as Provenance]);
			}
		}
		const access = propertyAccess(candidate);
		if (access) {
			const resolved = new Set(
				[...resolveExpression(access.target, usePosition, depth + 1)]
					.map((value) => applyProperty(value, access.name))
					.filter((value): value is Provenance => value !== null),
			);
			const objectPath = staticObjectPath(candidate);
			for (const propertyExpression of objectPropertyExpressions(
				objectPath.root,
				objectPath.path,
				usePosition,
				depth + 1,
			)) {
				for (const value of resolveExpression(
					propertyExpression,
					usePosition,
					depth + 1,
				)) {
					resolved.add(value);
				}
			}
			if (resolved.size > 0) return resolved;
			const symbol = checker.getSymbolAtLocation(candidate);
			for (const declaration of symbol?.declarations ?? []) {
				if (
					(ts.isPropertySignature(declaration) ||
						ts.isPropertyDeclaration(declaration)) &&
					declaration.type
				) {
					const provenance = typeProvenance(declaration.type);
					if (provenance) resolved.add(provenance);
				}
			}
			return resolved;
		}
		return new Set();
	};
	objectPropertyExpressions = (
		expression,
		propertyPath,
		usePosition,
		depth,
		activeSymbols = new Set(),
	): Set<ts.Expression> => {
		if (depth > MAX_PROVENANCE_DEPTH) {
			throw new ApprovalWriteBoundaryAnalysisLimitError(
				"constant_evaluator_depth",
			);
		}
		if (propertyPath.length === 0) return new Set([expression]);
		const candidate = unwrap(expression);
		if (ts.isObjectLiteralExpression(candidate)) {
			for (
				let index = candidate.properties.length - 1;
				index >= 0;
				index -= 1
			) {
				const property = candidate.properties[index];
				if (!property) continue;
				if (ts.isSpreadAssignment(property)) return new Set();
				if (
					(ts.isPropertyAssignment(property) ||
						ts.isShorthandPropertyAssignment(property)) &&
					staticName(property.name) === propertyPath[0]
				) {
					const value = ts.isPropertyAssignment(property)
						? property.initializer
						: property.name;
					return objectPropertyExpressions(
						value,
						propertyPath.slice(1),
						usePosition,
						depth + 1,
						activeSymbols,
					);
				}
			}
			return new Set();
		}
		const access = propertyAccess(candidate);
		if (access) {
			const objectPath = staticObjectPath(candidate);
			return objectPropertyExpressions(
				objectPath.root,
				[...objectPath.path, ...propertyPath],
				usePosition,
				depth + 1,
				activeSymbols,
			);
		}
		if (!ts.isIdentifier(candidate)) return new Set();
		const symbol = checker.getSymbolAtLocation(candidate);
		if (!symbol || activeSymbols.has(symbol)) return new Set();
		activeSymbols.add(symbol);
		try {
			const useScope = enclosingFunction(candidate);
			const relevant = (writes.get(symbol) ?? []).filter(
				(write) =>
					write.position < usePosition &&
					write.propertyPath.length === 0 &&
					scopeCanReach(write.scope, useScope),
			);
			let start = 0;
			for (let index = relevant.length - 1; index >= 0; index -= 1) {
				if (!relevant[index]?.conditional) {
					start = index;
					break;
				}
			}
			const result = new Set<ts.Expression>();
			for (const write of relevant.slice(start)) {
				for (const value of objectPropertyExpressions(
					write.value,
					propertyPath,
					write.position,
					depth + 1,
					activeSymbols,
				)) {
					result.add(value);
				}
			}
			const mutations = (objectMutations.get(symbol) ?? [])
				.filter(
					(mutation) =>
						mutation.position > (relevant[start]?.position ?? -1) &&
						mutation.position < usePosition &&
						scopeCanReach(mutation.scope, useScope) &&
						(mutation.path === null ||
							(mutation.path.length <= propertyPath.length &&
								mutation.path.every(
									(name, index) => propertyPath[index] === name,
								))),
				)
				.sort((left, right) => left.position - right.position);
			for (const mutation of mutations) {
				const mutationValues =
					!mutation.unknown && mutation.path !== null && mutation.value
						? objectPropertyExpressions(
								mutation.value,
								propertyPath.slice(mutation.path.length),
								mutation.position,
								depth + 1,
								activeSymbols,
							)
						: new Set<ts.Expression>();
				if (!mutation.conditional) result.clear();
				for (const value of mutationValues) result.add(value);
			}
			return result;
		} finally {
			activeSymbols.delete(symbol);
		}
	};
	for (const callback of transactionCallbacks) {
		if (
			resolveExpression(callback.target, callback.callPosition).has(
				"database_receiver",
			)
		) {
			addTypedBinding(callback.parameter, "database_receiver");
		}
	}
	const resolveLocalFunctions = (
		expression: ts.Expression,
		usePosition: number,
		activeSymbols = new Set<ts.Symbol>(),
	): Set<ts.FunctionLikeDeclaration> => {
		const candidate = unwrap(expression);
		if (!ts.isIdentifier(candidate)) return new Set();
		const symbol = checker.getSymbolAtLocation(candidate);
		if (!symbol || activeSymbols.has(symbol)) return new Set();
		const direct = localFunctions.get(symbol);
		if (direct) return new Set([direct]);
		activeSymbols.add(symbol);
		try {
			const result = new Set<ts.FunctionLikeDeclaration>();
			for (const declaration of symbol.declarations ?? []) {
				if (
					ts.isVariableDeclaration(declaration) &&
					declaration.initializer &&
					declaration.initializer.getEnd() < usePosition
				) {
					for (const resolved of resolveLocalFunctions(
						declaration.initializer,
						declaration.initializer.getEnd(),
						activeSymbols,
					))
						result.add(resolved);
				}
			}
			return result;
		} finally {
			activeSymbols.delete(symbol);
		}
	};
	const propagateLocalFunctionProvenance = (): void => {
		const calls: Array<{
			arguments: readonly ts.Expression[];
			functionNode: ts.FunctionLikeDeclaration;
			position: number;
		}> = [];
		for (const call of possibleHelperCalls) {
			for (const functionNode of resolveLocalFunctions(
				call.expression,
				call.getStart(sourceFile),
			)) {
				calls.push({
					arguments: call.arguments,
					functionNode,
					position: call.getStart(sourceFile),
				});
				if (calls.length > MAX_HELPER_CALLS) {
					throw new ApprovalWriteBoundaryAnalysisLimitError(
						"typescript_helper_call_count",
					);
				}
			}
		}
		for (
			let iteration = 0;
			iteration < MAX_HELPER_PROPAGATION_ITERATIONS;
			iteration += 1
		) {
			let changed = false;
			for (const call of calls) {
				for (const [
					index,
					parameter,
				] of call.functionNode.parameters.entries()) {
					const argument = call.arguments[index];
					if (!argument) continue;
					for (const provenance of resolveExpression(argument, call.position)) {
						if (!ts.isIdentifier(parameter.name)) continue;
						const symbol = checker.getSymbolAtLocation(parameter.name);
						if (!symbol) continue;
						const values = roots.get(symbol) ?? new Set<Provenance>();
						const size = values.size;
						values.add(provenance);
						roots.set(symbol, values);
						if (values.size !== size) changed = true;
					}
				}
			}
			if (!changed) return;
		}
		throw new ApprovalWriteBoundaryAnalysisLimitError(
			"typescript_helper_propagation_iterations",
		);
	};

	const mutations: ApprovalWriteMutationLocation[] = [];
	const functionNameAtPosition = (position: number): string | undefined => {
		let containingNode: ts.Node = sourceFile;
		const descend = (node: ts.Node): void => {
			node.forEachChild((child) => {
				if (child.getFullStart() <= position && position < child.getEnd()) {
					containingNode = child;
					descend(child);
				}
			});
		};
		descend(sourceFile);
		for (
			let declaration = enclosingFunction(containingNode);
			declaration;
			declaration = enclosingFunction(declaration)
		) {
			if (declaration.name) {
				const name = staticName(declaration.name);
				if (name !== null) return name;
			}
			const parent = declaration.parent;
			if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
				return parent.name.text;
			}
			if (ts.isPropertyAssignment(parent)) {
				const name = staticName(parent.name);
				if (name !== null) return name;
			}
		}
		return undefined;
	};
	const emitAtPosition = (
		position: number,
		operation: ApprovalWriteOperation,
		table: ProtectedWriteTable,
		details?: {
			columns?: readonly string[];
			semantic?: ApprovalSourceMutationSemantic;
			uncertainty?: ApprovalSourceMutationUncertainty;
		},
	): void => {
		const location = sourceFile.getLineAndCharacterOfPosition(position);
		mutations.push({
			column: location.character + 1,
			...(details?.columns ? { columns: details.columns } : {}),
			fileName,
			...(SOURCE_TABLES.has(table) && functionNameAtPosition(position)
				? { functionName: functionNameAtPosition(position) }
				: {}),
			line: location.line + 1,
			operation,
			...(details?.semantic ? { semantic: details.semantic } : {}),
			table,
			...(details?.uncertainty ? { uncertainty: details.uncertainty } : {}),
		});
	};
	const emit = (
		node: ts.Node,
		operation: ApprovalWriteOperation,
		table: ProtectedWriteTable,
		details?: {
			columns?: readonly string[];
			semantic?: ApprovalSourceMutationSemantic;
			uncertainty?: ApprovalSourceMutationUncertainty;
		},
	): void => {
		emitAtPosition(node.getStart(sourceFile), operation, table, details);
	};
	const failAt = (node: ts.Node, error: unknown): never => {
		if (!(error instanceof ApprovalWriteBoundaryAnalysisLimitError))
			throw error;
		const location = sourceFile.getLineAndCharacterOfPosition(
			node.getStart(sourceFile),
		);
		throw new Error(
			`Approval write boundary analysis failed at ${fileName}:${location.line + 1}:${location.character + 1}: ${error.message}`,
			{ cause: error },
		);
	};
	const inspectSql = (
		node: ts.Node,
		sqlText: string,
		positionForOffset?: (offset: number) => number,
	): void => {
		try {
			for (const mutation of findProtectedApprovalSqlMutationLocations(
				sqlText,
			)) {
				emitAtPosition(
					positionForOffset?.(mutation.offset) ?? node.getStart(sourceFile),
					mutation.operation,
					mutation.table,
					{
						...(mutation.columns ? { columns: mutation.columns } : {}),
						...(mutation.semantic ? { semantic: mutation.semantic } : {}),
						...(mutation.uncertainty
							? { uncertainty: mutation.uncertainty }
							: {}),
					},
				);
			}
		} catch (error) {
			failAt(node, error);
		}
	};
	const inspectConstant = (node: ts.Node, expression: ts.Expression): void => {
		try {
			const usePosition = node.getStart(sourceFile);
			const partialSql = (
				value: ts.Expression,
				depth = 0,
				seenSymbols = new Set<ts.Symbol>(),
			): string => {
				if (depth > MAX_PROVENANCE_DEPTH) {
					throw new ApprovalWriteBoundaryAnalysisLimitError(
						"constant_evaluator_depth",
					);
				}
				const candidate = unwrap(value);
				const constant = evaluateConstantApprovalSql(candidate, {
					budget: constantEvaluationBudget,
					checker,
					usePosition,
				});
				if (constant !== null) return constant;
				if (
					ts.isBinaryExpression(candidate) &&
					candidate.operatorToken.kind === ts.SyntaxKind.PlusToken
				) {
					const combined =
						partialSql(candidate.left, depth + 1, seenSymbols) +
						partialSql(candidate.right, depth + 1, seenSymbols);
					if (combined.length > MAX_TEMPLATE_EXPANDED_SQL_LENGTH) {
						throw new ApprovalWriteBoundaryAnalysisLimitError(
							"template_expanded_sql_length",
						);
					}
					return combined;
				}
				if (ts.isIdentifier(candidate)) {
					const symbol = checker.getSymbolAtLocation(candidate);
					const declaration = symbol?.valueDeclaration;
					if (
						symbol &&
						!seenSymbols.has(symbol) &&
						declaration &&
						ts.isVariableDeclaration(declaration) &&
						declaration.initializer
					) {
						const nextSeen = new Set(seenSymbols);
						nextSeen.add(symbol);
						return partialSql(declaration.initializer, depth + 1, nextSeen);
					}
				}
				return ` ${APPROVAL_DYNAMIC_SQL_MARKER} `;
			};
			const sqlText =
				evaluateConstantApprovalSql(unwrap(expression), {
					budget: constantEvaluationBudget,
					checker,
					usePosition,
				}) ?? partialSql(expression);
			if (sqlText !== null) {
				const candidate = unwrap(expression);
				const sourcePositions = ts.isNoSubstitutionTemplateLiteral(candidate)
					? templateSourcePositions(candidate)
					: null;
				const positionForOffset = sourcePositions
					? (offset: number) =>
							sourcePositions[offset] ?? node.getStart(sourceFile)
					: undefined;
				inspectSql(node, sqlText, positionForOffset);
			}
		} catch (error) {
			failAt(node, error);
		}
	};
	const templateSourcePositions = (
		literal: ts.TemplateLiteralLikeNode,
	): number[] => {
		const rawText = literal.rawText ?? literal.text;
		const sourceStart = literal.getStart(sourceFile) + 1;
		const positions: number[] = [];
		let rawIndex = 0;
		while (
			rawIndex < rawText.length &&
			positions.length < literal.text.length
		) {
			const sourcePosition = sourceStart + rawIndex;
			const character = rawText[rawIndex];
			if (character !== "\\") {
				if (character === "\r") {
					positions.push(sourcePosition);
					rawIndex += rawText[rawIndex + 1] === "\n" ? 2 : 1;
					continue;
				}
				const codePoint = rawText.codePointAt(rawIndex);
				const width = codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
				for (let index = 0; index < width; index += 1) {
					positions.push(sourcePosition + index);
				}
				rawIndex += width;
				continue;
			}
			const escaped = rawText[rawIndex + 1];
			if (escaped === "\n" || escaped === "\r") {
				rawIndex += escaped === "\r" && rawText[rawIndex + 2] === "\n" ? 3 : 2;
				continue;
			}
			let consumed = 2;
			let outputWidth = 1;
			if (escaped === "x") consumed = 4;
			else if (escaped === "u") {
				if (rawText[rawIndex + 2] === "{") {
					const close = rawText.indexOf("}", rawIndex + 3);
					if (close !== -1) {
						const codePoint = Number.parseInt(
							rawText.slice(rawIndex + 3, close),
							16,
						);
						outputWidth = codePoint > 0xffff ? 2 : 1;
						consumed = close - rawIndex + 1;
					}
				} else consumed = 6;
			}
			for (let index = 0; index < outputWidth; index += 1) {
				positions.push(sourcePosition);
			}
			rawIndex += consumed;
		}
		return positions;
	};
	const inspectTemplate = (
		node: ts.Node,
		template: ts.TemplateLiteral,
	): void => {
		if (ts.isNoSubstitutionTemplateLiteral(template)) {
			const sourcePositions = templateSourcePositions(template);
			inspectSql(
				node,
				template.text,
				(offset) => sourcePositions[offset] ?? node.getStart(sourceFile),
			);
			return;
		}
		interface TemplateSourceSegment {
			generatedEnd: number;
			generatedStart: number;
			sourcePositions?: readonly number[];
			sourceStart: number;
		}
		interface TemplateVariant {
			segments: TemplateSourceSegment[];
			text: string;
		}
		let variants: TemplateVariant[] = [
			{
				segments:
					template.head.text.length === 0
						? []
						: [
								{
									generatedEnd: template.head.text.length,
									generatedStart: 0,
									sourcePositions: templateSourcePositions(template.head),
									sourceStart: template.head.getStart(sourceFile) + 1,
								},
							],
				text: template.head.text,
			},
		];
		try {
			for (const span of template.templateSpans) {
				const tables = [
					...resolveExpression(span.expression, node.getStart(sourceFile)),
				]
					.filter((value): value is `table:${ProtectedWriteTable}` =>
						value.startsWith("table:"),
					)
					.map((value) => value.slice(6));
				const constant = evaluateConstantApprovalSql(unwrap(span.expression), {
					budget: constantEvaluationBudget,
					checker,
					usePosition: node.getStart(sourceFile),
				});
				const values =
					tables.length > 0 ? tables : [constant ?? " __dynamic_expression__ "];
				if (variants.length * values.length > MAX_TEMPLATE_VARIANTS) {
					throw new ApprovalWriteBoundaryAnalysisLimitError(
						"template_variant_count",
					);
				}
				let expandedLength = 0;
				for (const variant of variants) {
					for (const value of values) {
						expandedLength +=
							variant.text.length + value.length + span.literal.text.length;
					}
				}
				if (expandedLength > MAX_TEMPLATE_EXPANDED_SQL_LENGTH) {
					throw new ApprovalWriteBoundaryAnalysisLimitError(
						"template_expanded_sql_length",
					);
				}
				variants = variants.flatMap((variant) =>
					values.map((value) => {
						const valueStart = variant.text.length;
						const literalStart = valueStart + value.length;
						const segments = [...variant.segments];
						if (value.length > 0) {
							segments.push({
								generatedEnd: literalStart,
								generatedStart: valueStart,
								sourceStart: span.expression.getStart(sourceFile),
							});
						}
						if (span.literal.text.length > 0) {
							segments.push({
								generatedEnd: literalStart + span.literal.text.length,
								generatedStart: literalStart,
								sourcePositions: templateSourcePositions(span.literal),
								sourceStart: span.literal.getStart(sourceFile) + 1,
							});
						}
						return {
							segments,
							text: variant.text + value + span.literal.text,
						};
					}),
				);
			}
			for (const variant of variants) {
				inspectSql(node, variant.text, (offset) => {
					const segment = variant.segments.find(
						(candidate) =>
							offset >= candidate.generatedStart &&
							offset < candidate.generatedEnd,
					);
					if (!segment) return node.getStart(sourceFile);
					return (
						segment.sourcePositions?.[offset - segment.generatedStart] ??
						segment.sourceStart
					);
				});
			}
		} catch (error) {
			failAt(node, error);
		}
	};
	interface SourcePayloadAnalysis {
		properties: Map<string, ts.Expression | null>;
		resolvedAfterUncertainty: Set<string>;
		unresolved: boolean;
	}
	const payloadProperties = (
		expression: ts.Expression,
		usePosition: number,
		depth = 0,
		activeSymbols = new Set<ts.Symbol>(),
	): SourcePayloadAnalysis => {
		if (depth > MAX_PROVENANCE_DEPTH) {
			throw new ApprovalWriteBoundaryAnalysisLimitError(
				"constant_evaluator_depth",
			);
		}
		const candidate = unwrap(expression);
		if (ts.isIdentifier(candidate)) {
			const symbol = checker.getSymbolAtLocation(candidate);
			if (!symbol || activeSymbols.has(symbol)) {
				return {
					properties: new Map(),
					resolvedAfterUncertainty: new Set(),
					unresolved: true,
				};
			}
			activeSymbols.add(symbol);
			try {
				const useScope = enclosingFunction(candidate);
				const relevant = (writes.get(symbol) ?? []).filter(
					(write) =>
						write.position < usePosition &&
						write.propertyPath.length === 0 &&
						scopeCanReach(write.scope, useScope),
				);
				let start = 0;
				for (let index = relevant.length - 1; index >= 0; index -= 1) {
					if (!relevant[index]?.conditional) {
						start = index;
						break;
					}
				}
				const analyses = relevant
					.slice(start)
					.map((write) =>
						payloadProperties(
							write.value,
							write.position,
							depth + 1,
							activeSymbols,
						),
					);
				if (analyses.length === 0) {
					return {
						properties: new Map(),
						resolvedAfterUncertainty: new Set(),
						unresolved: true,
					};
				}
				const mutations = (objectMutations.get(symbol) ?? [])
					.filter(
						(mutation) =>
							mutation.position > (relevant[start]?.position ?? -1) &&
							mutation.position < usePosition &&
							scopeCanReach(mutation.scope, useScope),
					)
					.sort((left, right) => left.position - right.position);
				const signature = (analysis: SourcePayloadAnalysis): string =>
					[...analysis.properties]
						.sort(([left], [right]) => compareAscii(left, right))
						.map(
							([name, value]) =>
								`${name}:${value?.getText(sourceFile) ?? "<unknown>"}`,
						)
						.join("|");
				const first = analyses[0];
				const exactBase =
					first &&
					!first.unresolved &&
					analyses.every(
						(analysis) =>
							!analysis.unresolved && signature(analysis) === signature(first),
					);
				const properties = new Map<string, ts.Expression | null>(
					exactBase ? first.properties : undefined,
				);
				if (!exactBase) {
					for (const analysis of analyses) {
						for (const [name, value] of analysis.properties) {
							properties.set(name, value);
						}
					}
				}
				const resolvedAfterUncertainty = new Set(
					exactBase ? first.resolvedAfterUncertainty : [],
				);
				let unresolved = !exactBase;
				for (const mutation of mutations) {
					if (
						mutation.path === null ||
						mutation.path.length === 0 ||
						(mutation.unknown && !mutation.value)
					) {
						unresolved = true;
						resolvedAfterUncertainty.clear();
						continue;
					}
					if (mutation.path.length === 1 && mutation.value) {
						const name = mutation.path[0];
						if (!name) continue;
						properties.set(
							name,
							mutation.conditional || mutation.unknown ? null : mutation.value,
						);
						if (unresolved && !mutation.conditional && !mutation.unknown) {
							resolvedAfterUncertainty.add(name);
						}
					}
				}
				return {
					properties,
					resolvedAfterUncertainty,
					unresolved,
				};
			} finally {
				activeSymbols.delete(symbol);
			}
		}
		if (ts.isConditionalExpression(candidate)) {
			const whenTrue = payloadProperties(
				candidate.whenTrue,
				usePosition,
				depth + 1,
				activeSymbols,
			);
			const whenFalse = payloadProperties(
				candidate.whenFalse,
				usePosition,
				depth + 1,
				activeSymbols,
			);
			const properties = new Map(whenTrue.properties);
			for (const [name, value] of whenFalse.properties)
				properties.set(name, value);
			return {
				properties,
				resolvedAfterUncertainty: new Set(
					[...whenTrue.resolvedAfterUncertainty].filter((name) =>
						whenFalse.resolvedAfterUncertainty.has(name),
					),
				),
				unresolved: whenTrue.unresolved || whenFalse.unresolved,
			};
		}
		if (!ts.isObjectLiteralExpression(candidate)) {
			return {
				properties: new Map(),
				resolvedAfterUncertainty: new Set(),
				unresolved: true,
			};
		}
		const properties = new Map<string, ts.Expression | null>();
		const resolvedAfterUncertainty = new Set<string>();
		let unresolved = false;
		for (const property of candidate.properties) {
			if (ts.isSpreadAssignment(property)) {
				const spread = payloadProperties(
					property.expression,
					usePosition,
					depth + 1,
					activeSymbols,
				);
				if (spread.unresolved) {
					unresolved = true;
					resolvedAfterUncertainty.clear();
				}
				for (const [name, value] of spread.properties) {
					properties.set(name, value);
					if (unresolved && !spread.unresolved) {
						resolvedAfterUncertainty.add(name);
					}
				}
				for (const name of spread.resolvedAfterUncertainty) {
					resolvedAfterUncertainty.add(name);
				}
				continue;
			}
			if (
				ts.isPropertyAssignment(property) ||
				ts.isShorthandPropertyAssignment(property)
			) {
				const name = staticName(property.name);
				if (name === null) {
					unresolved = true;
					continue;
				}
				properties.set(
					name,
					ts.isPropertyAssignment(property)
						? property.initializer
						: property.name,
				);
				if (unresolved) resolvedAfterUncertainty.add(name);
				continue;
			}
			if (ts.isMethodDeclaration(property) || ts.isAccessor(property)) continue;
			unresolved = true;
		}
		return { properties, resolvedAfterUncertainty, unresolved };
	};
	const sourceBuilderTables = (
		expression: ts.Expression,
		operation: "delete" | "insert" | "update",
		position: number,
	): ProtectedWriteTable[] => {
		const builder = unwrap(expression);
		if (!ts.isCallExpression(builder) || !builder.arguments[0]) return [];
		const builderAccess = propertyAccess(builder.expression);
		if (
			builderAccess?.name !== operation ||
			!resolveExpression(builderAccess.target, position).has(
				"database_receiver",
			)
		)
			return [];
		return [...resolveExpression(builder.arguments[0], position)].reduce<
			ProtectedWriteTable[]
		>((tables, value) => {
			if (value.startsWith("table:")) {
				const table = value.slice(6) as ProtectedWriteTable;
				if (SOURCE_TABLES.has(table)) tables.push(table);
			}
			return tables;
		}, []);
	};
	const inspectSourceDelete = (
		node: ts.CallExpression,
		access: { name: string; target: ts.Expression },
	): void => {
		if (access.name !== "where" || !node.arguments[0]) return;
		const tables = sourceBuilderTables(
			access.target,
			"delete",
			node.getStart(sourceFile),
		);
		if (!tables.includes("time_entry")) return;
		const columns = new Set<string>();
		let correctionType = false;
		let inactive = false;
		let nullSuccessor = false;
		let replacement = false;
		const inspectPredicate = (predicate: ts.Node): void => {
			if (ts.isPropertyAccessExpression(predicate)) {
				const column = SOURCE_COLUMN_NAMES[predicate.name.text];
				if (
					column &&
					(column === "type" || TIME_ENTRY_LIFECYCLE_COLUMNS.has(column)) &&
					resolveExpression(
						predicate.expression,
						node.getStart(sourceFile),
					).has("table:time_entry")
				) {
					columns.add(column);
				}
			}
			if (ts.isCallExpression(predicate)) {
				const callName =
					propertyAccess(predicate.expression)?.name ??
					(ts.isIdentifier(predicate.expression)
						? predicate.expression.text
						: null);
				const columnAccess = predicate.arguments[0]
					? propertyAccess(predicate.arguments[0])
					: null;
				const column = columnAccess
					? SOURCE_COLUMN_NAMES[columnAccess.name]
					: undefined;
				const protectedColumn =
					column === "type" ||
					(column !== undefined && TIME_ENTRY_LIFECYCLE_COLUMNS.has(column));
				const value = predicate.arguments[1]
					? unwrap(predicate.arguments[1])
					: null;
				if (
					callName === "eq" &&
					protectedColumn &&
					column === "type" &&
					value &&
					ts.isStringLiteralLike(value) &&
					value.text === "correction"
				) {
					correctionType = true;
				}
				if (
					callName === "eq" &&
					protectedColumn &&
					column === "is_superseded" &&
					value?.kind === ts.SyntaxKind.TrueKeyword
				) {
					inactive = true;
				}
				if (
					protectedColumn &&
					callName === "isNull" &&
					column === "superseded_by_id"
				) {
					nullSuccessor = true;
				}
				if (
					protectedColumn &&
					callName === "eq" &&
					column === "replaces_entry_id"
				) {
					replacement = true;
				}
			}
			ts.forEachChild(predicate, inspectPredicate);
		};
		inspectPredicate(node.arguments[0]);
		if (!correctionType || !inactive || !nullSuccessor || !replacement) return;
		emit(node, "delete", "time_entry", {
			columns: [...columns].sort(compareAscii),
			semantic: "inactive_correction",
		});
	};
	const inspectSourceMutation = (
		node: ts.CallExpression,
		access: { name: string; target: ts.Expression },
	): void => {
		const operation = access.name === "values" ? "insert" : "update";
		if (access.name !== "values" && access.name !== "set") return;
		const payload = node.arguments[0]
			? payloadProperties(node.arguments[0], node.getStart(sourceFile))
			: null;
		if (!payload) return;
		const normalizedColumns = [...payload.properties.keys()]
			.map((name) => SOURCE_COLUMN_NAMES[name])
			.filter((name): name is string => Boolean(name));
		for (const table of sourceBuilderTables(
			access.target,
			operation,
			node.getStart(sourceFile),
		)) {
			const protectedPropertyNames =
				table === "work_period"
					? [
							"approvalStatus",
							"pendingChanges",
							"approvalWorkflowId",
							"canonicalRecordId",
							"clockInId",
							"clockOutId",
							"startTime",
							"endTime",
							"durationMinutes",
						]
					: table === "time_entry"
						? Object.keys(SOURCE_COLUMN_NAMES).filter(
								(name) =>
									name === "type" ||
									TIME_ENTRY_LIFECYCLE_COLUMNS.has(
										SOURCE_COLUMN_NAMES[name] ?? "",
									),
							)
						: table === "time_record"
							? [
									"approvalState",
									"startAt",
									"endAt",
									"durationMinutes",
									"organizationId",
									"employeeId",
								]
							: table === "time_record_work"
								? [
										"recordId",
										"organizationId",
										"recordKind",
										"workCategoryId",
										"workLocationType",
										"computationMetadata",
									]
								: [
										"id",
										"organizationId",
										"recordId",
										"allocationKind",
										"projectId",
										"costCenterId",
										"weightPercent",
										"createdAt",
									];
			const unresolvedPayload =
				payload.unresolved &&
				protectedPropertyNames.some(
					(name) => !payload.resolvedAfterUncertainty.has(name),
				);
			const protectedColumnSet = new Set(
				protectedPropertyNames.map((name) => SOURCE_COLUMN_NAMES[name]),
			);
			const columns = [
				...new Set(
					normalizedColumns.filter((column) => protectedColumnSet.has(column)),
				),
			].sort(compareAscii);
			const reportedColumns =
				unresolvedPayload &&
				table === "work_period" &&
				columns.every(
					(column) => column === "clock_in_id" || column === "clock_out_id",
				)
					? []
					: columns;
			if (columns.length === 0 && !unresolvedPayload) continue;
			if (
				(table === "time_record_work" || table === "time_record_allocation") &&
				operation !== "insert"
			) {
				continue;
			}
			if (table === "time_entry" && operation === "insert") {
				const typeValue = payload.properties.get("type");
				const correction =
					typeValue !== null &&
					typeValue !== undefined &&
					ts.isStringLiteralLike(unwrap(typeValue)) &&
					unwrap(typeValue).getText(sourceFile).replaceAll(/["']/g, "") ===
						"correction";
				if (
					!correction &&
					!columns.some((column) => TIME_ENTRY_LIFECYCLE_COLUMNS.has(column)) &&
					!unresolvedPayload
				)
					continue;
				emit(node, operation, table, {
					...(reportedColumns.length > 0 ? { columns: reportedColumns } : {}),
					...(correction
						? { semantic: "correction" as const }
						: columns.some((column) => TIME_ENTRY_LIFECYCLE_COLUMNS.has(column))
							? { semantic: "correction_lifecycle" as const }
							: {}),
					...(unresolvedPayload
						? { uncertainty: "dynamic_payload" as const }
						: {}),
				});
				continue;
			}
			emit(node, operation, table, {
				...(reportedColumns.length > 0 ? { columns: reportedColumns } : {}),
				...(table === "time_entry" && columns.length > 0
					? { semantic: "correction_lifecycle" as const }
					: table === "time_record"
						? {
								semantic:
									operation === "insert"
										? ("policy_clock_out_terminal_break" as const)
										: ("ordinary_finalization" as const),
							}
						: table === "time_record_work" || table === "time_record_allocation"
							? { semantic: "policy_clock_out_terminal_break" as const }
							: {}),
				...(unresolvedPayload
					? { uncertainty: "dynamic_payload" as const }
					: {}),
			});
		}
	};
	const inspect = (node: ts.Node): void => {
		if (ts.isCallExpression(node)) {
			const access = propertyAccess(node.expression);
			if (access) {
				inspectSourceDelete(node, access);
				inspectSourceMutation(node, access);
			}
			const callPosition = node.getStart(sourceFile);
			if (
				node.arguments[0] &&
				resolveExpression(node.expression, callPosition).has("sql_raw")
			) {
				inspectConstant(node, node.arguments[0]);
			}
			const boundOperations = resolveExpression(node.expression, callPosition);
			for (const provenance of boundOperations) {
				if (
					(provenance === "bound_delete" ||
						provenance === "bound_insert" ||
						provenance === "bound_update") &&
					node.arguments[0]
				) {
					for (const table of resolveExpression(
						node.arguments[0],
						callPosition,
					)) {
						if (table.startsWith("table:")) {
							if (!SOURCE_TABLES.has(table.slice(6) as ProtectedWriteTable))
								emit(
									node,
									provenance.slice(6) as ApprovalWriteOperation,
									table.slice(6) as ProtectedWriteTable,
								);
						}
					}
				}
			}
			if (
				access &&
				(access.name === "insert" ||
					access.name === "update" ||
					access.name === "delete") &&
				node.arguments[0] &&
				resolveExpression(access.target, callPosition).has("database_receiver")
			) {
				for (const value of resolveExpression(
					node.arguments[0],
					callPosition,
				)) {
					if (value.startsWith("table:")) {
						const table = value.slice(6) as ProtectedWriteTable;
						if (!SOURCE_TABLES.has(table)) emit(node, access.name, table);
					}
				}
			}
			if (
				access &&
				(access.name === "query" || access.name === "execute") &&
				node.arguments[0] &&
				resolveExpression(access.target, callPosition).has("database_receiver")
			) {
				const argument = unwrap(node.arguments[0]);
				if (
					ts.isTemplateExpression(argument) ||
					ts.isNoSubstitutionTemplateLiteral(argument)
				) {
					inspectTemplate(node, argument);
				} else if (!ts.isTaggedTemplateExpression(argument)) {
					inspectConstant(node, argument);
				}
			}
			if (
				resolveExpression(node.expression, callPosition).has(
					"update_rows_helper",
				) &&
				node.arguments[1]
			) {
				for (const value of resolveExpression(
					node.arguments[1],
					callPosition,
				)) {
					if (value.startsWith("table:")) {
						const table = value.slice(6) as ProtectedWriteTable;
						if (!SOURCE_TABLES.has(table)) emit(node, "update", table);
					}
				}
			}
		}
		if (
			ts.isTaggedTemplateExpression(node) &&
			resolveExpression(node.tag, node.getStart(sourceFile)).has("drizzle_sql")
		) {
			inspectTemplate(node, node.template);
		}
		ts.forEachChild(node, inspect);
	};
	try {
		propagateLocalFunctionProvenance();
		inspect(sourceFile);
	} catch (error) {
		if (error instanceof ApprovalWriteBoundaryAnalysisLimitError) {
			failAt(sourceFile, error);
		}
		throw error;
	}

	const unique = new Map<string, ApprovalWriteMutationLocation>();
	for (const mutation of mutations) {
		const key = `${mutation.fileName}\0${mutation.line}\0${mutation.column}\0${mutation.table}\0${mutation.operation}\0${mutation.uncertainty ?? ""}`;
		unique.set(key, mutation);
	}
	return [...unique.values()].sort(
		(left, right) =>
			compareAscii(left.fileName, right.fileName) ||
			left.line - right.line ||
			left.column - right.column ||
			compareAscii(left.table, right.table) ||
			compareAscii(left.operation, right.operation),
	);
}
