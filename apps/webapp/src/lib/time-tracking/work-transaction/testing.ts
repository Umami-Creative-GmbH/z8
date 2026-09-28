/**
 * The work transaction fake for unit suites. It runs the plan's real routing
 * (twice per attempt) and the real ledger, but records guards instead of
 * locking, so a rank bug shows up without a database. It can force a scope
 * change on chosen attempts to exercise the restart budget.
 */
import {
	runWorkTransactionWith,
	sealWorkTransactionScope,
	type WorkPlan,
	type WorkRoute,
	type WorkTransactionAdmission,
	type WorkTransactionClient,
	type WorkTransactionScope,
} from "./index";
import { approvalWriteGateGuard, type Guard, holdGuard } from "./ranks";

export interface RecordedGuard extends Guard {
	/** The attempt, from 1, that took the guard. */
	readonly attempt: number;
}

export interface FakeWorkTransactionOptions {
	/** The transaction client handed to routing and the operation; default `{}`. */
	client?: object;
	/** The admission read under the adoption gate; default `legacy`. */
	admission?: WorkTransactionAdmission;
	/** Attempts (from 1) whose re-route reports a concurrent scope change. */
	changeScopeOn?: readonly number[];
	/**
	 * Opens each attempt's transaction, such as a mocked `db.transaction` with
	 * rollback; default a fresh client derived from `client`.
	 */
	transaction?<T>(body: (client: object) => Promise<T>): Promise<T>;
	/**
	 * For approval ports whose write gate is a test double that takes no guard:
	 * the fake takes the routed gate's rank-2 guard once the port's `gate` returns.
	 */
	recordApprovalGate?: boolean;
	/**
	 * For mocked approval runtimes that carry their own database instead of the
	 * transaction they borrow: the database this returns for the borrowed
	 * approval. Routing reads it, and the scope is also registered for it, as it
	 * is for the transaction.
	 */
	approvalDatabase?(approval: unknown): object;
	/** Also takes each guard after recording it, such as a mocked advisory lock. */
	lock?(client: object, guard: Guard): Promise<void>;
}

export interface FakeWorkTransaction {
	run<R extends WorkRoute, A, T>(
		plan: WorkPlan<R, A>,
		operation: (scope: WorkTransactionScope<R, A>) => Promise<T>,
	): Promise<T>;
	/** Every guard taken, in order, across all attempts. */
	readonly guards: readonly RecordedGuard[];
	/** How many attempts the last run opened. */
	readonly attempts: number;
}

export function fakeWorkTransaction(options: FakeWorkTransactionOptions = {}): FakeWorkTransaction {
	const guards: RecordedGuard[] = [];
	let attempts = 0;
	const changeScopeOn = new Set(options.changeScopeOn ?? []);
	return {
		guards,
		get attempts() {
			return attempts;
		},
		run(plan, operation) {
			attempts = 0;
			let transaction: object = {};
			let borrowed: unknown;
			const { approval } = plan;
			const faked: typeof plan = {
				...plan,
				...(options.approvalDatabase && {
					route: (_db, attempt) =>
						plan.route(options.approvalDatabase?.(borrowed) as WorkTransactionClient, attempt),
				}),
				...(approval && {
					approval: {
						borrow: (db, body) =>
							approval.borrow(db, (context) => {
								borrowed = context;
								return body(context);
							}),
						async gate(context, organizationId, workflowType) {
							const pinned = await approval.gate(context, organizationId, workflowType);
							if (options.recordApprovalGate) {
								await holdGuard(
									transaction as Parameters<typeof holdGuard>[0],
									approvalWriteGateGuard(organizationId, workflowType),
								);
							}
							return pinned;
						},
					},
				}),
			};
			return runWorkTransactionWith(
				{
					async open(_database, body) {
						attempts += 1;
						if (options.transaction) {
							return options.transaction((client) => {
								transaction = client;
								return body(client);
							});
						}
						// A fresh client per attempt, as a fresh transaction would be.
						transaction = Object.create(options.client ?? {});
						return body(transaction);
					},
					async lock(client, guard) {
						guards.push({ ...guard, attempt: attempts });
						await options.lock?.(client, guard);
					},
					async readAdmission() {
						return options.admission ?? "legacy";
					},
					savepoint: (transaction, body) => body(Object.create(transaction)),
					scopeChanged: (attempt) => changeScopeOn.has(attempt),
				},
				faked,
				(scope) => {
					if (options.approvalDatabase) {
						sealWorkTransactionScope({ ...scope, db: options.approvalDatabase(borrowed) });
					}
					return operation(scope);
				},
			);
		},
	};
}
