/**
 * The work transaction coordinator (#477). A writer declares its scope routing
 * and its operation; the coordinator opens the transaction, takes every guard
 * of the acquisition protocol in rank order (adoption gate, approval write
 * gate, organization configuration, sorted user configuration/access, sorted
 * employee coordination, source identities, then rows), re-routes under the
 * guards, restarts on a scope change, and hands the operation a sealed scope.
 * The ledger in `ranks.ts` makes a wrong order throw in every environment.
 *
 * Coordinators not yet migrated still compose the ranks by hand with the
 * primitives at the end of this file; they retire slice by slice (#488–#492).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { eq } from "drizzle-orm";
import type { db } from "@/db";
import { timeEntryAppendControl } from "@/db/schema/time-entry-append";
import { canonicalJson } from "../canonical-json";
import {
	adoptionGate,
	duringRouting,
	employeeCoordinationGuard,
	type Guard,
	holdGuard,
	insideSavepoint,
	ledgerHolds,
	lockGuard,
	openLedger,
	organizationConfigurationGuard,
	Rank,
	recordGuard,
	sourceIdentityGuard,
	userConfigurationAccessGuard,
	WorkTransactionProtocolViolation,
} from "./ranks";

// The organization configuration guard lives in the schema-free ranks module so
// route handlers can take it; coordinators keep importing it from here.
export {
	acquireExclusiveOrganizationConfigurationGuard,
	acquireOrganizationConfigurationGuard,
	WorkTransactionProtocolViolation,
	withOrganizationConfigurationMutation,
} from "./ranks";

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type WorkTransactionClient = Pick<
	Transaction,
	"execute" | "query" | "select" | "insert" | "update" | "delete"
>;
export type WorkTransactionDatabase = Pick<typeof db, "transaction">;

const protectedTransaction = Symbol("protected work transaction");

/**
 * `legacy` keeps each writer's established head selection. `append` admits fresh
 * entries from evidence through the internal append collaborator; it is read
 * from the organization's append control under the shared adoption gate.
 */
export type WorkTransactionAdmission = "legacy" | "append";

/** The scope routing's answer: who the write depends on, and whom it may change. */
export interface WorkRoute<S = unknown> {
	/** Coordinated users (rank 4). */
	users: readonly string[];
	/** Coordinated employees (rank 5, exclusive). */
	employees: readonly string[];
	/** The employees the operation may change; a subset of `employees`. */
	writeTargets: readonly string[];
	guards?: {
		/** Default `shared`. */
		organization?: "none" | "shared" | "exclusive";
		/** Default `shared`. */
		users?: "shared" | "exclusive";
	};
	/** The approval workflow type whose write gate is taken at rank 2; requires `plan.approval`. */
	approvalGate?: string;
	/** Exclusive source identities (rank 6). */
	sourceIdentities?: readonly (readonly string[])[];
	/** Anything else the operation decided on; compared as canonical JSON on re-route. */
	snapshot?: S;
}

/** Implemented by approvals: borrows the transaction and takes the pinned write gate. */
export interface WorkTransactionApprovalPort<A> {
	borrow<T>(db: WorkTransactionClient, body: (approval: A) => Promise<T>): Promise<T>;
	/** Acquires the workflow type's write gate (recording rank 2) and pins it. */
	gate(approval: A, organizationId: string, workflowType: string): Promise<A>;
}

export interface WorkPlan<R extends WorkRoute, A = never> {
	organizationId: string;
	/** Plain reads only; it runs again under the guards and must answer the same. */
	route(db: WorkTransactionClient, attempt: { widened: boolean }): Promise<R>;
	approval?: WorkTransactionApprovalPort<A>;
	/** Rank 7 row locks, followed by a second re-route and compare. */
	lockRows?(db: WorkTransactionClient, route: R): Promise<void>;
	/** The transaction opener; defaults to the application database. */
	database?: WorkTransactionDatabase;
}

/**
 * What every coordinator hands its writers: the coordinated client, the
 * admission read under the adoption gate, and the write-target check. Scopes
 * sealed by coordinators not yet migrated carry only this much.
 */
export interface SealedWorkTransactionScope {
	readonly [protectedTransaction]: true;
	readonly db: WorkTransactionClient;
	readonly admission: WorkTransactionAdmission;
	assertEmployee(organizationId: string, employeeId: string): void;
}

/** Trusted server composition only; no transaction or adoption upgrade capability. */
export interface WorkTransactionScope<R = WorkRoute, A = never> extends SealedWorkTransactionScope {
	/** The route confirmed under the guards. */
	readonly route: R;
	/** The pinned approval context from the port. */
	readonly approval: A;
	/** Throws unless the employee is a write target of this organization. */
	assertEmployee(organizationId: string, employeeId: string): void;
	/** Rolls the attempt back and starts a fresh one, within the budget of 3. */
	restart(options?: { widen: true }): never;
	/** Runs `work` in a savepoint; no guard may be taken inside it. */
	savepoint<U>(work: (scope: this) => Promise<U>): Promise<U>;
}

/**
 * The routed scope differed once the guards were held, in every attempt the
 * budget allowed; every attempt has been rolled back.
 */
export class WorkTransactionScopeChanged extends Error {
	constructor() {
		super("Work transaction scope changed; retry the operation");
		this.name = "WorkTransactionScopeChanged";
	}
}

const ATTEMPTS = 3;

const scopesByTransaction = new WeakMap<object, SealedWorkTransactionScope>();

/**
 * The coordinated scope sealed for this transaction client, or null when the
 * client was not opened by a work-transaction coordinator. Trusted
 * collaborators that the approval engine calls with only that client (#301
 * correction finalization and cancellation) find the coordinated scope here.
 */
export function workTransactionScopeFor(client: object): SealedWorkTransactionScope | null {
	return scopesByTransaction.get(client) ?? null;
}

/**
 * For the outer transaction coordinators not yet migrated; ordinary callers
 * receive a scope. The sealed scope is also registered for its transaction client.
 */
export function sealWorkTransactionScope<T extends object>(
	scope: T,
): T & { readonly [protectedTransaction]: true } {
	const sealed = Object.freeze({ ...scope, [protectedTransaction]: true as const });
	if (isSealedScope(sealed)) scopesByTransaction.set(sealed.db, sealed);
	return sealed;
}

function isSealedScope(value: object): value is SealedWorkTransactionScope {
	const candidate = value as Partial<SealedWorkTransactionScope>;
	return (
		typeof candidate.db === "object" &&
		candidate.db !== null &&
		(candidate.admission === "legacy" || candidate.admission === "append") &&
		typeof candidate.assertEmployee === "function"
	);
}

/**
 * How an attempt reaches the database. The fake in `testing.ts` records guards
 * instead of locking and can force a scope change on a chosen attempt.
 */
export interface WorkTransactionAdapter {
	open<T>(
		database: WorkTransactionDatabase | undefined,
		body: (transaction: object) => Promise<T>,
	): Promise<T>;
	lock(client: object, guard: Guard): Promise<void>;
	readAdmission(client: object, organizationId: string): Promise<WorkTransactionAdmission>;
	savepoint<T>(transaction: object, body: (savepoint: object) => Promise<T>): Promise<T>;
	/** Reports a concurrent scope change at the compare after rank 5. */
	scopeChanged?(attempt: number): boolean;
}

const postgres: WorkTransactionAdapter = {
	async open(database, body) {
		return (database ?? (await import("@/db")).db).transaction((transaction) => body(transaction), {
			isolationLevel: "read committed",
		});
	},
	lock: (client, guard) => lockGuard(client as Pick<Transaction, "execute">, guard),
	readAdmission: (client, organizationId) =>
		readAppendAdmission(client as Pick<Transaction, "select">, organizationId),
	savepoint: (transaction, body) =>
		(transaction as Transaction).transaction((savepoint) => body(savepoint)),
};

/**
 * Runs `operation` once in a work transaction for the plan's routed scope. The
 * operation may run up to 3 times, so it must have no effects outside the
 * transaction. Errors from routing and from the operation propagate unretried.
 */
export function runWorkTransaction<R extends WorkRoute, A, T>(
	plan: WorkPlan<R, A>,
	operation: (scope: WorkTransactionScope<R, A>) => Promise<T>,
): Promise<T> {
	return runWorkTransactionWith(postgres, plan, operation);
}

const activeRun = new AsyncLocalStorage<{ active: boolean }>();

class AttemptRolledBack extends Error {
	constructor() {
		super("Work transaction attempt rolled back for a restart");
		this.name = "AttemptRolledBack";
	}
}

/** `runWorkTransaction` over an adapter; `testing.ts` passes its fake. */
export async function runWorkTransactionWith<R extends WorkRoute, A, T>(
	adapter: WorkTransactionAdapter,
	plan: WorkPlan<R, A>,
	operation: (scope: WorkTransactionScope<R, A>) => Promise<T>,
): Promise<T> {
	if (activeRun.getStore()?.active) {
		throw new WorkTransactionProtocolViolation("a work transaction inside a work transaction");
	}
	const run = { active: true };
	try {
		return await activeRun.run(run, async () => {
			let widened = false;
			for (let attempt = 1; ; attempt += 1) {
				const outcome = await runAttempt(adapter, plan, operation, { attempt, widened });
				if (outcome.done) return outcome.value;
				if (outcome.widen) widened = true;
				if (attempt >= ATTEMPTS) throw new WorkTransactionScopeChanged();
			}
		});
	} finally {
		run.active = false;
	}
}

type AttemptOutcome<T> = { done: true; value: T } | { done: false; widen: boolean };

async function runAttempt<R extends WorkRoute, A, T>(
	adapter: WorkTransactionAdapter,
	plan: WorkPlan<R, A>,
	operation: (scope: WorkTransactionScope<R, A>) => Promise<T>,
	{ attempt, widened }: { attempt: number; widened: boolean },
): Promise<AttemptOutcome<T>> {
	const restart: { requested: boolean; widen: boolean } = { requested: false, widen: false };
	try {
		const value = await adapter.open(plan.database, (transaction) => {
			openLedger(transaction, adapter.lock);
			const body = (approval: A) =>
				coordinate(adapter, plan, operation, { transaction, approval, attempt, widened, restart });
			return plan.approval
				? plan.approval.borrow(transaction as WorkTransactionClient, body)
				: body(undefined as A);
		});
		return { done: true, value };
	} catch (error) {
		// The intent, not the error, decides: approvals or Effect may redact the error.
		if (restart.requested) return { done: false, widen: restart.widen };
		throw error;
	}
}

async function coordinate<R extends WorkRoute, A, T>(
	adapter: WorkTransactionAdapter,
	plan: WorkPlan<R, A>,
	operation: (scope: WorkTransactionScope<R, A>) => Promise<T>,
	attempt: {
		transaction: object;
		approval: A;
		attempt: number;
		widened: boolean;
		restart: { requested: boolean; widen: boolean };
	},
): Promise<T> {
	const { transaction, restart } = attempt;
	const client = transaction as WorkTransactionClient;
	const route = () =>
		duringRouting(transaction, () => plan.route(client, { widened: attempt.widened }));
	const take = (guard: Guard) => holdGuard(client, guard);
	const rollBack = (widen: boolean): never => {
		restart.requested = true;
		restart.widen ||= widen;
		throw new AttemptRolledBack();
	};

	const routed = await route();
	const writeTargets = new Set(routed.writeTargets);
	const employees = new Set(routed.employees);
	for (const target of writeTargets) {
		if (!employees.has(target)) {
			throw new WorkTransactionProtocolViolation(`write target ${target} is not a routed employee`);
		}
	}
	if (routed.approvalGate !== undefined && !plan.approval) {
		throw new WorkTransactionProtocolViolation("an approval gate without an approval port");
	}

	await take(adoptionGate(plan.organizationId));
	const admission = await adapter.readAdmission(transaction, plan.organizationId);
	let approval = attempt.approval;
	if (routed.approvalGate !== undefined && plan.approval) {
		approval = await plan.approval.gate(approval, plan.organizationId, routed.approvalGate);
		if (!ledgerHolds(transaction, Rank.approvalWriteGate)) {
			throw new WorkTransactionProtocolViolation("the approval gate did not record rank 2");
		}
	}
	const organization = routed.guards?.organization ?? "shared";
	if (organization !== "none") {
		await take(organizationConfigurationGuard(plan.organizationId, organization));
	}
	for (const userId of sortedUnique(routed.users)) {
		await take(userConfigurationAccessGuard(userId, routed.guards?.users ?? "shared"));
	}
	for (const employeeId of sortedUnique(routed.employees)) {
		await take(employeeCoordinationGuard(employeeId));
	}
	const canonical = canonicalRoute(routed);
	let confirmed = await route();
	if (adapter.scopeChanged?.(attempt.attempt) || canonicalRoute(confirmed) !== canonical) {
		rollBack(false);
	}
	for (const identity of sortedUnique(
		(routed.sourceIdentities ?? []).map((id) => JSON.stringify(id)),
	)) {
		await take(sourceIdentityGuard(JSON.parse(identity) as string[]));
	}
	if (plan.lockRows) {
		recordGuard(transaction, Rank.rows, "rows", "exclusive");
		await plan.lockRows(client, routed);
		confirmed = await route();
		if (canonicalRoute(confirmed) !== canonical) rollBack(false);
	}

	let active = true;
	const assertActive = () => {
		if (!active) throw new Error("Work transaction is no longer active");
	};
	const seal = (db: object): WorkTransactionScope<R, A> => {
		const scope: WorkTransactionScope<R, A> = Object.freeze({
			[protectedTransaction]: true as const,
			db: db as WorkTransactionClient,
			admission,
			route: confirmed,
			approval,
			assertEmployee(organizationId: string, employeeId: string) {
				assertActive();
				if (organizationId !== plan.organizationId || !writeTargets.has(employeeId)) {
					throw new Error("Employee scope is outside the work transaction");
				}
			},
			restart(options?: { widen: true }): never {
				assertActive();
				return rollBack(options?.widen === true);
			},
			savepoint<U>(work: (scope: WorkTransactionScope<R, A>) => Promise<U>): Promise<U> {
				assertActive();
				return adapter.savepoint(db, (savepoint) =>
					insideSavepoint(db, savepoint, () => work(seal(savepoint))),
				);
			},
		});
		scopesByTransaction.set(db, scope);
		return scope;
	};
	try {
		const value = await operation(seal(transaction));
		// A restart the operation swallowed still rolls this attempt back.
		if (restart.requested) rollBack(false);
		return value;
	} finally {
		active = false;
	}
}

function sortedUnique(values: readonly string[]): string[] {
	return [...new Set(values)].sort();
}

/** The route as canonical JSON: sets sorted, guard modes defaulted. */
function canonicalRoute(route: WorkRoute): string {
	return canonicalJson({
		users: sortedUnique(route.users),
		employees: sortedUnique(route.employees),
		writeTargets: sortedUnique(route.writeTargets),
		organization: route.guards?.organization ?? "shared",
		userMode: route.guards?.users ?? "shared",
		approvalGate: route.approvalGate ?? null,
		sourceIdentities: sortedUnique((route.sourceIdentities ?? []).map((id) => JSON.stringify(id))),
		snapshot: route.snapshot ?? null,
	});
}

/**
 * Whether two routes protect the same scope. For coordinators not yet migrated
 * that still compare their routing by hand (#491).
 */
export function sameWorkRoute(left: WorkRoute, right: WorkRoute): boolean {
	return canonicalRoute(left) === canonicalRoute(right);
}

/**
 * The organization's append admission, read under the shared adoption gate so an
 * exclusive adoption holder drains this transaction before a mode change is
 * visible. No control row, or an inactive one, keeps legacy head selection.
 */
export async function readAppendAdmission(
	transaction: Pick<Transaction, "select">,
	organizationId: string,
): Promise<WorkTransactionAdmission> {
	const [control] = await transaction
		.select({ mode: timeEntryAppendControl.mode })
		.from(timeEntryAppendControl)
		.where(eq(timeEntryAppendControl.organizationId, organizationId))
		.limit(1);
	return control?.mode === "active" ? "append" : "legacy";
}

// Primitives for the coordinators not yet migrated. They lock without recording
// in the ledger, as before the coordinator existed.

export async function acquireAdoptionGate(
	transaction: Pick<Transaction, "execute">,
	organizationId: string,
) {
	await lockGuard(transaction, adoptionGate(organizationId));
}

export async function acquireUserConfigurationAccessGuards(
	transaction: Pick<Transaction, "execute">,
	userIds: readonly string[],
) {
	for (const userId of sortedUnique(userIds)) {
		await lockGuard(transaction, userConfigurationAccessGuard(userId, "shared"));
	}
}

/**
 * Exclusive user configuration/access protection for a writer of a user's
 * manual dependencies (#313), sorted, taken after any organization protection
 * and before the writer's first dependent mutation; never upgrade from shared.
 */
export async function acquireExclusiveUserConfigurationAccessGuards(
	transaction: Pick<Transaction, "execute">,
	userIds: readonly string[],
) {
	for (const userId of sortedUnique(userIds)) {
		await lockGuard(transaction, userConfigurationAccessGuard(userId, "exclusive"));
	}
}

/** Exclusive originating-source identity (#264 step 6), e.g. a provider record. */
export async function acquireSourceIdentity(
	transaction: Pick<Transaction, "execute">,
	identity: readonly string[],
) {
	await lockGuard(transaction, sourceIdentityGuard(identity));
}

/** Reuses the established exclusive employee key shared by every clocking writer. */
export async function acquireEmployeeCoordination(
	transaction: Pick<Transaction, "execute">,
	employeeIds: readonly string[],
) {
	for (const employeeId of sortedUnique(employeeIds)) {
		await lockGuard(transaction, employeeCoordinationGuard(employeeId));
	}
}
