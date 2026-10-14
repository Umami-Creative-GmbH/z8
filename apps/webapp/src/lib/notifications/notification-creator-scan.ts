import * as ts from "typescript/unstable/ast";
import { withNativeProgram } from "@/lib/typescript/native-source-analysis";

/**
 * Finds the places that create a notification (#1149), for the guard test that every
 * one of them sets translation keys. Syntax only, one native program for all files.
 *
 * - A creator is an object literal with `type`, `title`, `message` and `userId` or
 *   `organizationId`: the shape of `CreateNotificationParams`. A literal whose `title`
 *   is copied from another object's `.title` is plumbing, not a creator.
 * - `sendPushToUser(...)` outside `lib/notifications/` pushes without a notification.
 * - `.insert(notification)` outside the notification service writes one directly.
 *
 * A creator has keys when its literal mentions `i18n` / `i18nMetadata` (an `i18n`
 * object with only `params` does not count); a direct push or insert when its function
 * uses a `common:notifications.` key, or an insert whose row literal sets keys that way.
 */
export interface NotificationCreatorSite {
	/** `<path below src>::<enclosing function>`, stable across line changes. */
	id: string;
	/** Every site in that function sets translation keys. */
	hasKeys: boolean;
}

const CREATOR_KEYS_PATTERN = /\bi18n(?:Metadata)?\b/;
const NOTIFICATION_KEY_PATTERN = /["'`]common:notifications\./;
const NOTIFICATION_MODULE = "lib/notifications/";
const NOTIFICATION_SERVICE = "lib/notifications/notification-service.ts";

function propertyName(property: ts.Node): string | undefined {
	if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
		return ts.isIdentifier(property.name) ? property.name.text : undefined;
	}
	return undefined;
}

/**
 * The literal mentions `i18n` / `i18nMetadata`, and not only as `i18n: { params }`: params
 * alone are data for the channels (an email's override variables), not keys (#1152).
 */
function setsKeys(node: ts.ObjectLiteralExpression, sourceFile: ts.SourceFile): boolean {
	if (!CREATOR_KEYS_PATTERN.test(node.getText(sourceFile))) return false;
	let i18nObjects = 0;
	let paramsOnly = 0;
	const visit = (child: ts.Node): void => {
		if (ts.isPropertyAssignment(child) && propertyName(child) === "i18n") {
			i18nObjects += 1;
			if (
				ts.isObjectLiteralExpression(child.initializer) &&
				child.initializer.properties.every((property) => propertyName(property) === "params")
			) {
				paramsOnly += 1;
			}
		}
		child.forEachChild(visit);
	};
	node.forEachChild(visit);
	return i18nObjects === 0 || paramsOnly < i18nObjects;
}

function isCreatorLiteral(node: ts.ObjectLiteralExpression): boolean {
	const names = new Set<string>();
	let titleIsCopied = false;
	for (const property of node.properties) {
		const name = propertyName(property);
		if (!name) continue;
		names.add(name);
		if (
			name === "title" &&
			ts.isPropertyAssignment(property) &&
			ts.isPropertyAccessExpression(property.initializer) &&
			property.initializer.name.text === "title"
		) {
			titleIsCopied = true;
		}
	}
	return (
		names.has("type") &&
		names.has("title") &&
		names.has("message") &&
		(names.has("userId") || names.has("organizationId")) &&
		!titleIsCopied
	);
}

function functionName(node: ts.Node): string | undefined {
	if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) {
		return ts.isIdentifier(node.name) ? node.name.text : undefined;
	}
	if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
		const parent = node.parent;
		if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
		if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
	}
	return undefined;
}

/** The nearest named function around `node`; anonymous callbacks resolve to their owner. */
function enclosingFunction(node: ts.Node): { name: string; node: ts.Node | undefined } {
	for (let current = node.parent; current && !ts.isSourceFile(current); current = current.parent) {
		const name = functionName(current);
		if (name) return { name, node: current };
	}
	return { name: "<module>", node: undefined };
}

function calleeName(node: ts.CallExpression): string | undefined {
	const callee = node.expression;
	if (ts.isIdentifier(callee)) return callee.text;
	if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
	return undefined;
}

function isDirectInsert(node: ts.CallExpression): boolean {
	const [argument] = node.arguments;
	return (
		calleeName(node) === "insert" &&
		ts.isPropertyAccessExpression(node.expression) &&
		node.arguments.length === 1 &&
		argument !== undefined &&
		ts.isIdentifier(argument) &&
		argument.text === "notification"
	);
}

/** The row literal of `.insert(notification).values({ ... })`, when it is one. */
function insertedRow(node: ts.CallExpression): ts.ObjectLiteralExpression | undefined {
	const values = node.parent;
	if (!ts.isPropertyAccessExpression(values) || values.name.text !== "values") return undefined;
	const call = values.parent;
	if (!ts.isCallExpression(call) || call.expression !== values) return undefined;
	const [row] = call.arguments;
	return row && ts.isObjectLiteralExpression(row) ? row : undefined;
}

/** Sites per file and function, in source order. Keys are paths below `src/`. */
export function scanNotificationCreators(
	sources: ReadonlyMap<string, string>,
): NotificationCreatorSite[] {
	const [entry] = sources.keys();
	if (entry === undefined) return [];
	return withNativeProgram(sources, entry, ({ program }) => {
		const sites = new Map<string, boolean>();
		const record = (id: string, hasKeys: boolean) =>
			sites.set(id, (sites.get(id) ?? true) && hasKeys);

		for (const fileName of sources.keys()) {
			const sourceFile = program.getSourceFile(`/${fileName}`);
			if (!sourceFile) throw new Error(`Source could not be parsed: ${fileName}`);
			const siteId = (node: ts.Node) => {
				const owner = enclosingFunction(node);
				return {
					id: `${fileName}::${owner.name}`,
					text: (owner.node ?? sourceFile).getText(sourceFile),
				};
			};
			const visit = (node: ts.Node): void => {
				if (ts.isObjectLiteralExpression(node) && isCreatorLiteral(node)) {
					record(siteId(node).id, setsKeys(node, sourceFile));
				} else if (ts.isCallExpression(node)) {
					const direct =
						(calleeName(node) === "sendPushToUser" && !fileName.startsWith(NOTIFICATION_MODULE)) ||
						(isDirectInsert(node) && fileName !== NOTIFICATION_SERVICE);
					if (direct) {
						const site = siteId(node);
						const row = isDirectInsert(node) ? insertedRow(node) : undefined;
						record(
							site.id,
							NOTIFICATION_KEY_PATTERN.test(site.text) ||
								(row !== undefined && setsKeys(row, sourceFile)),
						);
					}
				}
				node.forEachChild(visit);
			};
			sourceFile.forEachChild(visit);
		}
		return [...sites].map(([id, hasKeys]) => ({ id, hasKeys }));
	});
}
