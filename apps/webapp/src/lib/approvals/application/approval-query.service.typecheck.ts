/**
 * Type-level guard (#670): approval queries declare their real requirements.
 * Checked by `pnpm typecheck`; never imported at runtime.
 */
import { Effect } from "effect";
import { type DatabaseService, DatabaseServiceLive } from "@/lib/effect/services/database.service";
import type { ApprovalQueryParams } from "../domain/types";
import { ApprovalQueryService, ApprovalQueryServiceLive } from "./approval-query.service";

type Equal<Left, Right> =
	(<T>() => T extends Left ? 1 : 2) extends <T>() => T extends Right ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

declare const params: ApprovalQueryParams;

const listApprovals = Effect.gen(function* () {
	const service = yield* ApprovalQueryService;
	return yield* service.getApprovals(params);
}).pipe(Effect.provide(ApprovalQueryServiceLive));

export type ListApprovalsRequiresDatabase = Expect<
	Equal<Effect.Services<typeof listApprovals>, DatabaseService>
>;

// Running the query without DatabaseService is how the manager briefing silently
// showed zero approvals (#663); the compiler must reject it.
// @ts-expect-error DatabaseService is not provided
void Effect.runPromise(listApprovals);

void Effect.runPromise(listApprovals.pipe(Effect.provide(DatabaseServiceLive)));
