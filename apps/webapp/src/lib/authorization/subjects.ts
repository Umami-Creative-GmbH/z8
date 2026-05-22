import { subject } from "@casl/ability";
import type { DatabaseSubjectName, AppSubjectRecord } from "./types";

export function asAppSubject<T extends AppSubjectRecord>(
	subjectName: DatabaseSubjectName,
	record: T,
) {
	return subject(subjectName, record);
}
