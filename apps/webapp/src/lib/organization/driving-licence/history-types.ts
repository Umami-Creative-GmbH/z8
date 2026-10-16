import type { LicenceClass } from "./check-types";
export type DrivingCheckCorrection =
	| { field: "documentIssuedOn" | "documentExpiresOn"; value: string }
	| { field: "classExpiry"; classCode: LicenceClass; value: string | null }
	| { field: "classRestrictions"; classCode: LicenceClass; value: string }
	| {
			field: "classResult";
			classCode: LicenceClass;
			value: "successful" | "unsuccessful" | "inconclusive";
	  };
