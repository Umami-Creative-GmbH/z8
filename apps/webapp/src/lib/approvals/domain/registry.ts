/**
 * Unified Approval Center - Type Registry
 *
 * Central registry for approval type handlers.
 * Use this to register new approval types and look them up at runtime.
 */

import type { ApprovalType, ApprovalTypeHandler } from "./types";

// In-memory storage for handlers
const handlers = new Map<ApprovalType, ApprovalTypeHandler>();

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
