import { subject, type ForcedSubject } from "@casl/ability";
import type {
	AbsenceAuthorizationSubject,
	ApprovalAuthorizationSubject,
	DatabaseSubjectName,
	EmployeeAuthorizationSubject,
	TimeEntryAuthorizationSubject,
} from "./types";

type AppSubjectRecordByName = {
	Employee: EmployeeAuthorizationSubject;
	TimeEntry: TimeEntryAuthorizationSubject;
	Absence: AbsenceAuthorizationSubject;
	Approval: ApprovalAuthorizationSubject;
};

export function asAppSubject<
	TSubjectName extends DatabaseSubjectName,
	TRecord extends AppSubjectRecordByName[TSubjectName],
>(subjectName: TSubjectName, record: TRecord): TRecord & ForcedSubject<TSubjectName> {
	return subject(subjectName, record);
}
