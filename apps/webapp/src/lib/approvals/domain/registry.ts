/**
 * Unified Approval Center - Type Registry
 *
 * Central registry for approval type handlers.
 * Use this to register new approval types and look them up at runtime.
 */

import { Context, Effect, Layer } from "effect";
import type { ApprovalType, ApprovalTypeHandler } from "./types";
import { NotFoundError } from "@/lib/effect/errors";

// ============================================
// REGISTRY SERVICE
// ============================================

/**
 * Approval Type Registry Service.
 *
 * Manages registration and lookup of approval type handlers.
 * Implemented as an Effect service for DI and testability.
 */
export class ApprovalTypeRegistry extends Context.Tag("ApprovalTypeRegistry")<
	ApprovalTypeRegistry,
	{
		/**
		 * Register a new approval type handler.
		 */
		readonly register: (handler: ApprovalTypeHandler) => Effect.Effect<void>;

		/**
		 * Get a handler by type identifier.
		 */
		readonly get: (type: ApprovalType) => Effect.Effect<ApprovalTypeHandler, NotFoundError>;

		/**
		 * Get all registered handlers.
		 */
		readonly getAll: () => Effect.Effect<ApprovalTypeHandler[]>;

		/**
		 * Check if a type is registered.
		 */
		readonly exists: (type: ApprovalType) => Effect.Effect<boolean>;

		/**
		 * Get registered type identifiers.
		 */
		readonly getTypes: () => Effect.Effect<ApprovalType[]>;
	}
>() {}

// In-memory storage for handlers
const handlers = new Map<ApprovalType, ApprovalTypeHandler>();

/**
 * Live implementation of the registry service.
 */
export const ApprovalTypeRegistryLive = Layer.succeed(
	ApprovalTypeRegistry,
	ApprovalTypeRegistry.of({
		register: (handler) =>
			Effect.sync(() => {
				handlers.set(handler.type, handler);
			}),

		get: (type) =>
			Effect.gen(function* (_) {
				const handler = handlers.get(type);
				if (!handler) {
					return yield* _(
						Effect.fail(
							new NotFoundError({
								message: `Approval type '${type}' is not registered`,
								entityType: "approval_type",
								entityId: type,
							}),
						),
					);
				}
				return handler;
			}),

		getAll: () => Effect.succeed(Array.from(handlers.values())),

		exists: (type) => Effect.succeed(handlers.has(type)),

		getTypes: () => Effect.succeed(Array.from(handlers.keys())),
	}),
);

// ============================================
// DIRECT ACCESS (for non-Effect contexts)
// ============================================

/**
 * Register a handler directly (for initialization).
 * Use this in the init file to register handlers at startup.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerApprovalHandler(handler: ApprovalTypeHandler<any>): void {
	handlers.set(handler.type, handler);
}

/**
 * Get a handler directly (for contexts where Effect isn't used).
 * Returns undefined if not found.
 */
export function getApprovalHandler(type: ApprovalType): ApprovalTypeHandler | undefined {
	return handlers.get(type);
}

/**
 * Get all handlers directly.
 */
export function getAllApprovalHandlers(): ApprovalTypeHandler[] {
	return Array.from(handlers.values());
}

/**
 * Check if a type is registered directly.
 */
export function hasApprovalHandler(type: ApprovalType): boolean {
	return handlers.has(type);
}
