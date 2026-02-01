/**
 * Date/time formatting utilities for user display
 */

import { DateTime } from "luxon";

/**
 * Format a date as a relative distance from now (e.g., "2 hours ago", "in 3 days")
 * @param date Date or DateTime to format
 * @returns Relative time string (e.g., "2 hours ago")
 */
export function formatDistance(date: Date | DateTime): string {
	const dt = date instanceof Date ? DateTime.fromJSDate(date) : date;
	return dt.toRelative() || "";
}

/**
 * Format a date as a short relative time (e.g., "2h ago", "3d ago")
 * @param date Date or DateTime to format
 * @returns Short relative time string
 */
export function formatDistanceShort(date: Date | DateTime): string {
	const dt = date instanceof Date ? DateTime.fromJSDate(date) : date;
	const now = DateTime.now();
	const diff = now.diff(dt, ["years", "months", "days", "hours", "minutes"]);

	if (diff.years >= 1) return `${Math.floor(diff.years)}y ago`;
	if (diff.months >= 1) return `${Math.floor(diff.months)}mo ago`;
	if (diff.days >= 1) return `${Math.floor(diff.days)}d ago`;
	if (diff.hours >= 1) return `${Math.floor(diff.hours)}h ago`;
	if (diff.minutes >= 1) return `${Math.floor(diff.minutes)}m ago`;
	return "just now";
}

/**
 * Format duration in hours and minutes (e.g., "8h 30m")
 * @param minutes Total minutes
 * @returns Formatted duration string
 */
export function formatDuration(minutes: number): string {
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	if (hours === 0) return `${mins}m`;
	if (mins === 0) return `${hours}h`;
	return `${hours}h ${mins}m`;
}

/**
 * Format a date and time for display
 * @param date Date or DateTime to format
 * @returns Formatted date/time string (e.g., "Jan 15, 2:30 PM")
 */
export function formatDateTime(date: Date | DateTime): string {
	const dt = date instanceof Date ? DateTime.fromJSDate(date) : date;
	return dt.toLocaleString({
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

/**
 * Format a date for display (no time)
 * @param date Date or DateTime to format
 * @returns Formatted date string (e.g., "Jan 15, 2024")
 */
export function formatDateOnly(date: Date | DateTime): string {
	const dt = date instanceof Date ? DateTime.fromJSDate(date) : date;
	return dt.toLocaleString({
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

/**
 * Format a time for display (no date)
 * @param date Date or DateTime to format
 * @returns Formatted time string (e.g., "2:30 PM")
 */
export function formatTimeOnly(date: Date | DateTime): string {
	const dt = date instanceof Date ? DateTime.fromJSDate(date) : date;
	return dt.toLocaleString({
		hour: "2-digit",
		minute: "2-digit",
	});
}
