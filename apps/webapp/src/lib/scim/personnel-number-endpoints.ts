import type { DBAdapter } from "@better-auth/core/db/adapter";
import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { employee } from "@/db/schema";
import {
	requireAuthTransaction,
	runCoordinatedAuthMutation,
} from "@/lib/auth/auth-transaction";
import { normalizePersonnelNumber } from "@/lib/organization/personnel-number";
import {
	assertPersonnelNumberFree,
	isPersonnelNumberConflict,
	PersonnelNumberTaken,
} from "@/lib/organization/personnel-number-uniqueness";
import { personnelNumberSchema } from "@/lib/validations/employee";
import { protectSCIMProjectedUser } from "./projection-guards";

export const SCIM_ENTERPRISE_USER =
	"urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
const SCIM_ERROR = "urn:ietf:params:scim:api:messages:2.0:Error";

type JsonObject = Record<string, unknown>;
type Source = {
	id: string;
	provisioningDomainId: string;
	userId: string;
	serializedAttributes?: string | null;
};
type EmployeeNumber = {
	organizationId: string;
	userId: string;
	employeeNumber: string | null;
};
type EndpointInput = {
	context: { adapter: DBAdapter };
	body?: unknown;
	query?: Record<string, unknown>;
};

function record(value: unknown): value is JsonObject {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function field(object: unknown, name: string): unknown {
	if (!record(object)) return undefined;
	const key = Object.keys(object).find(
		(key) => key.toLowerCase() === name.toLowerCase(),
	);
	return key === undefined ? undefined : object[key];
}

function scimError(
	status: "BAD_REQUEST" | "CONFLICT",
	scimType: string,
	detail: string,
) {
	return new APIError(status, {
		schemas: [SCIM_ERROR],
		status: status === "CONFLICT" ? "409" : "400",
		scimType,
		detail,
	});
}

class FailedSCIMResponse extends Error {
	constructor(readonly result: unknown) {
		super("SCIM request was rolled back");
	}
}

/** Resolves only resource IDs already authorized and returned by the SCIM endpoint. */
async function sourcesFor(
	adapter: DBAdapter,
	resources: JsonObject[],
): Promise<Source[]> {
	const ids = resources.flatMap((resource) =>
		typeof resource.id === "string" ? [resource.id] : [],
	);
	if (!ids.length) return [];
	return adapter.findMany<Source>({
		model: "scimUser",
		limit: ids.length,
		where: [{ field: "id", operator: "in", value: ids }],
	});
}

type UserMethod = "GET" | "POST" | "PUT" | "PATCH";
type NumberPatchTarget =
	| { kind: "attribute"; value: unknown }
	| { kind: "enterprise" | "pathless"; extension: JsonObject; value: unknown }
	| { kind: "remove-extension" }
	| { kind: "unrelated" };

function hasNumber(value: unknown): value is JsonObject {
	return (
		record(value) &&
		Object.keys(value).some((key) => key.toLowerCase() === "employeenumber")
	);
}

/** Match upstream's trimming and empty-path handling once for every interpretation. */
function numberPatchTarget(operation: JsonObject): NumberPatchTarget {
	const path =
		typeof operation.path === "string"
			? operation.path.trim().toLowerCase() || undefined
			: undefined;
	if (path === `${SCIM_ENTERPRISE_USER}:employeeNumber`.toLowerCase())
		return { kind: "attribute", value: operation.value };
	if (path === SCIM_ENTERPRISE_USER.toLowerCase()) {
		if (String(operation.op).toLowerCase() === "remove")
			return { kind: "remove-extension" };
		return hasNumber(operation.value)
			? {
					kind: "enterprise",
					extension: operation.value,
					value: field(operation.value, "employeeNumber"),
				}
			: { kind: "unrelated" };
	}
	const extension =
		path === undefined
			? field(operation.value, SCIM_ENTERPRISE_USER)
			: undefined;
	return hasNumber(extension)
		? { kind: "pathless", extension, value: field(extension, "employeeNumber") }
		: { kind: "unrelated" };
}

/** Match upstream's single-valued scalar wrapper used by Microsoft Entra. */
function numberScalar(value: unknown): unknown {
	return Array.isArray(value) && value.length === 1 ? value[0] : value;
}

function emptyNumber(value: unknown) {
	const scalar = numberScalar(value);
	return (
		scalar === null || (typeof scalar === "string" && scalar.trim() === "")
	);
}

function withoutNumber(value: JsonObject): JsonObject {
	return Object.fromEntries(
		Object.entries(value).filter(
			([key]) => key.toLowerCase() !== "employeenumber",
		),
	);
}

/** Preserve raw update intent and values while translating blank-as-clear for upstream. */
function preparePersonnelNumberInput(body: unknown, method: UserMethod) {
	const values: unknown[] = [];
	let supplied = false;
	if (!record(body) || method === "GET") return { body, supplied, values };
	if (method !== "PATCH") {
		const extension = field(body, SCIM_ENTERPRISE_USER);
		supplied = hasNumber(extension);
		if (supplied) values.push(numberScalar(field(extension, "employeeNumber")));
		return {
			body:
				hasNumber(extension) && emptyNumber(field(extension, "employeeNumber"))
					? { ...body, [SCIM_ENTERPRISE_USER]: withoutNumber(extension) }
					: body,
			supplied,
			values,
		};
	}
	const operations = field(body, "Operations");
	if (!Array.isArray(operations)) return { body, supplied, values };
	const prepared = operations.flatMap((operation: unknown) => {
		if (!record(operation)) return [operation];
		const target = numberPatchTarget(operation);
		if (target.kind === "unrelated") return [operation];
		supplied = true;
		if (
			target.kind === "remove-extension" ||
			!["add", "replace"].includes(String(operation.op).toLowerCase())
		)
			return [operation];
		values.push(numberScalar(target.value));
		if (!emptyNumber(target.value)) return [operation];
		const remove = {
			op: "remove",
			path: `${SCIM_ENTERPRISE_USER}:employeeNumber`,
		};
		if (target.kind === "attribute") return [remove];
		const value =
			target.kind === "pathless" && record(operation.value)
				? {
						...operation.value,
						[SCIM_ENTERPRISE_USER]: withoutNumber(target.extension),
					}
				: withoutNumber(target.extension);
		return [{ ...operation, value }, remove];
	});
	return { body: { ...body, Operations: prepared }, supplied, values };
}
async function savePersonnelNumber(
	adapter: DBAdapter,
	resource: JsonObject,
	supplied: boolean,
	method: UserMethod,
) {
	if (!supplied && method !== "PUT") return;
	const [source] = await sourcesFor(adapter, [resource]);
	if (!source) throw new Error("SCIM personnel number source is unavailable");
	const tx = requireAuthTransaction("SCIM personnel number");
	const scope = {
		organizationId: source.provisioningDomainId,
		userId: source.userId,
	};
	await protectSCIMProjectedUser(tx, scope);
	const [current] = await tx
		.select()
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, scope.organizationId),
				eq(employee.userId, scope.userId),
			),
		);
	if (!current) throw new Error("SCIM employee is unavailable");
	if (!supplied && !current.personnelNumberManagedByScim) return;
	const attributes: unknown = JSON.parse(source.serializedAttributes ?? "{}");
	const parsed = personnelNumberSchema.safeParse(
		field(field(attributes, "enterprise"), "employeeNumber") ?? null,
	);
	if (!parsed.success)
		throw scimError(
			"BAD_REQUEST",
			"invalidValue",
			"Personnel number must be text of at most 50 characters",
		);
	const personnelNumber = parsed.data ?? null;
	if (personnelNumber !== null)
		await assertPersonnelNumberFree(tx, {
			organizationId: scope.organizationId,
			exceptEmployeeId: current.id,
			personnelNumber,
		});
	await tx
		.update(employee)
		.set({
			employeeNumber: personnelNumber,
			personnelNumberManagedByScim: true,
		})
		.where(
			and(
				eq(employee.id, current.id),
				eq(employee.organizationId, scope.organizationId),
			),
		);
}
function shouldReturnNumber(query: EndpointInput["query"]) {
	const paths = (value: unknown) =>
		(Array.isArray(value)
			? value
			: typeof value === "string"
				? value.split(",")
				: []
		)
			.filter((path): path is string => typeof path === "string")
			.map((path) => path.trim().toLowerCase());
	const root = SCIM_ENTERPRISE_USER.toLowerCase();
	const matches = (path: string) =>
		path === root || path === `${root}:employeenumber`;
	const include = paths(query?.attributes);
	return (
		(!include.length || include.some(matches)) &&
		!paths(query?.excludedAttributes).some(matches)
	);
}

async function projectNumbers(
	adapter: DBAdapter,
	payload: JsonObject,
	query: EndpointInput["query"],
) {
	if (!shouldReturnNumber(query)) return payload;
	const resources = Array.isArray(payload.Resources)
		? payload.Resources.filter(record)
		: [payload];
	const sources = await sourcesFor(adapter, resources);
	const numbers = new Map<string, string | null>();
	for (const organizationId of new Set(
		sources.map((source) => source.provisioningDomainId),
	)) {
		const scopedSources = sources.filter(
			(source) => source.provisioningDomainId === organizationId,
		);
		const rows = await adapter.findMany<EmployeeNumber>({
			model: "employee",
			limit: scopedSources.length,
			where: [
				{ field: "organizationId", value: organizationId },
				{
					field: "userId",
					operator: "in",
					value: scopedSources.map((source) => source.userId),
				},
			],
		});
		for (const source of scopedSources) {
			const row = rows.find((row) => row.userId === source.userId);
			if (row)
				numbers.set(source.id, normalizePersonnelNumber(row.employeeNumber));
		}
	}
	const project = (resource: JsonObject) => {
		if (typeof resource.id !== "string" || !numbers.has(resource.id))
			return resource;
		const value = numbers.get(resource.id);
		const extension = record(resource[SCIM_ENTERPRISE_USER])
			? { ...resource[SCIM_ENTERPRISE_USER] }
			: {};
		if (value) extension.employeeNumber = value;
		else delete extension.employeeNumber;
		const result = { ...resource };
		const schemas = Array.isArray(resource.schemas)
			? resource.schemas.filter((schema) => schema !== SCIM_ENTERPRISE_USER)
			: [];
		if (Object.keys(extension).length) {
			result[SCIM_ENTERPRISE_USER] = extension;
			schemas.push(SCIM_ENTERPRISE_USER);
		} else delete result[SCIM_ENTERPRISE_USER];
		return { ...result, schemas };
	};
	return Array.isArray(payload.Resources)
		? { ...payload, Resources: resources.map(project) }
		: project(payload);
}

/**
 * Keep Better Auth's validation, authorization, PATCH engine and discovery.
 * An outer coordinated transaction includes the employee write even when the
 * upstream PATCH is a no-op. Its error Response must also roll back that transaction.
 */
export function withSCIMPersonnelNumber<
	Endpoint extends (...args: never[]) => unknown,
>(endpoint: Endpoint, method: UserMethod): Endpoint {
	return new Proxy(endpoint, {
		async apply(target, thisArg, args) {
			const input = args[0] as EndpointInput;
			const intent = preparePersonnelNumberInput(input.body, method);
			const run = async () => {
				const result: unknown = await Reflect.apply(target, thisArg, [
					{ ...input, body: intent.body },
					...args.slice(1),
				]);
				const responseEnvelope =
					record(result) &&
					"response" in result &&
					("headers" in result || "status" in result);
				const status =
					result instanceof Response
						? result.status
						: responseEnvelope && typeof result.status === "number"
							? result.status
							: 200;
				if (status >= 400) throw new FailedSCIMResponse(result);
				const payload: unknown =
					result instanceof Response
						? await result.clone().json()
						: responseEnvelope
							? result.response
							: result;
				if (!record(payload)) return result;
				for (const value of intent.values) {
					if (!personnelNumberSchema.safeParse(value).success)
						throw scimError(
							"BAD_REQUEST",
							"invalidValue",
							"Personnel number must be text of at most 50 characters",
						);
				}
				if (method !== "GET")
					await savePersonnelNumber(
						input.context.adapter,
						payload,
						intent.supplied,
						method,
					);
				const projected = await projectNumbers(
					input.context.adapter,
					payload,
					input.query,
				);
				if (result instanceof Response) {
					const headers = new Headers(result.headers);
					headers.delete("content-length");
					return new Response(JSON.stringify(projected), {
						status: result.status,
						statusText: result.statusText,
						headers,
					});
				}
				return responseEnvelope
					? { ...result, response: projected }
					: projected;
			};
			try {
				return method === "GET"
					? await run()
					: await runCoordinatedAuthMutation(input.context, run);
			} catch (error) {
				if (error instanceof FailedSCIMResponse) return error.result;
				if (
					error instanceof PersonnelNumberTaken ||
					isPersonnelNumberConflict(error)
				)
					throw scimError(
						"CONFLICT",
						"uniqueness",
						"This personnel number is already in use in this organization",
					);
				throw error;
			}
		},
	});
}
