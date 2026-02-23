export type CoverageSlotStatus = "under" | "met" | "over";

export interface CoverageTimeSlotSnapshot {
	startTime: string;
	endTime: string;
	required: number;
	actual: number;
	shortfall: number;
	status: CoverageSlotStatus;
	ruleIds: string[];
}

export interface CoverageSnapshotEntity {
	date: Date;
	subareaId: string;
	subareaName: string;
	locationName?: string;
	timeSlots: CoverageTimeSlotSnapshot[];
	totalRequired: number;
	totalActual: number;
	totalShortfall: number;
	status: CoverageSlotStatus;
	utilizationPercent: number;
	gapCount: number;
}

export interface HeatmapDataPoint {
	date: Date;
	subareaId: string;
	subareaName: string;
	locationName?: string;
	status: CoverageSlotStatus;
	gapCount: number;
	utilizationPercent: number;
	totalRequired: number;
	totalActual: number;
	totalShortfall: number;
}

export function snapshotToHeatmapDataPoint(
	snapshot: CoverageSnapshotEntity,
): HeatmapDataPoint {
	return {
		date: snapshot.date,
		subareaId: snapshot.subareaId,
		subareaName: snapshot.subareaName,
		locationName: snapshot.locationName,
		status: snapshot.status,
		gapCount: snapshot.gapCount,
		utilizationPercent: snapshot.utilizationPercent,
		totalRequired: snapshot.totalRequired,
		totalActual: snapshot.totalActual,
		totalShortfall: snapshot.totalShortfall,
	};
}
