/**
 * Event Subscriber Registry
 *
 * Manages event subscribers for the event bus.
 */

import type { EventSubscriber } from "./types";

// Global subscriber registry
const subscribers: EventSubscriber[] = [];
let initialized = false;

/**
 * Register an event subscriber
 */
export function registerSubscriber(subscriber: EventSubscriber): void {
	// Check for duplicate names
	if (subscribers.some((s) => s.name === subscriber.name)) {
		throw new Error(`Subscriber with name "${subscriber.name}" already registered`);
	}

	subscribers.push({
		...subscriber,
		priority: subscriber.priority ?? 100,
	});

	// Sort by priority (lower = higher priority)
	subscribers.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
}

/**
 * Unregister an event subscriber (mainly for testing)
 */
export function unregisterSubscriber(name: string): boolean {
	const index = subscribers.findIndex((s) => s.name === name);
	if (index !== -1) {
		subscribers.splice(index, 1);
		return true;
	}
	return false;
}

/**
 * Get all registered subscribers
 */
export function getSubscribers(): EventSubscriber[] {
	return [...subscribers];
}

/**
 * Clear all subscribers (for testing)
 */
export function clearSubscribers(): void {
	subscribers.length = 0;
	initialized = false;
}

/**
 * Check if subscribers have been initialized
 */
export function isInitialized(): boolean {
	return initialized;
}

/**
 * Mark subscribers as initialized
 */
export function markInitialized(): void {
	initialized = true;
}
