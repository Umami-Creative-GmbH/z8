import { approverGoLiveCheck } from "./approver";
import { payrollSetupGoLiveCheck } from "./payroll-setup";
import type { GoLiveCheck } from "./types";
import { workPolicyGoLiveCheck } from "./work-policy";

export type { GoLiveCheck, GoLiveCheckContext } from "./types";

/** Every go-live check, in display order. A new check appends one line here. */
export const GO_LIVE_CHECKS: readonly GoLiveCheck[] = [
	workPolicyGoLiveCheck,
	approverGoLiveCheck,
	payrollSetupGoLiveCheck,
];
