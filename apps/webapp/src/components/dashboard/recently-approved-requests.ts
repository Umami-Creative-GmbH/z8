type RecentlyApprovedRequestRow = {
	id: string;
	entityType: string;
	updatedAt: Date;
	requester: {
		user: {
			name: string | null;
		};
	};
	approver: {
		user: {
			name: string | null;
		};
	} | null;
};

export function mapRecentlyApprovedRequestRows(requests: RecentlyApprovedRequestRow[]) {
	return requests.map((request) => ({
		id: request.id,
		type: request.entityType === "absence_entry" ? "absence" : "time_correction",
		updatedAt: request.updatedAt,
		requestedByEmployee: request.requester,
		approverEmployee: request.approver,
	}));
}
