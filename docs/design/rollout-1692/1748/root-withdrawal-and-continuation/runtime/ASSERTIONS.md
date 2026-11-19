# R166 current-source assertion ledger

140 distinct final assertions: 140 pass, 0 fail. Repeated attempts are nonadditive. No unit/PG suites rerun.

| ID | Result | Kind | Assertion |
| --- | --- | --- | --- |
| 1 | PASS | runtime | Exact fresh fixture credentials verified before UI submit |
| 2 | PASS | runtime | Fresh canonical UI sign-in |
| 3 | PASS | runtime | Draft identity |
| 4 | PASS | runtime | Draft notes |
| 5 | PASS | runtime | Draft filename |
| 6 | PASS | runtime | Draft originalAmount |
| 7 | PASS | runtime | Draft calculatedAmount |
| 8 | PASS | runtime | Draft capturedZone |
| 9 | PASS | runtime | Draft missingDestination |
| 10 | PASS | runtime | One claim h1 and safe shell |
| 11 | PASS | runtime | Own draft continuation appears after canonical conversion read settles |
| 12 | PASS | runtime | Actual Preview click opens decoded receipt in new tab |
| 13 | PASS | runtime | Actual Download click completes with exact seeded bytes, checksum and valid PNG dimensions |
| 14 | PASS | runtime | Real missing owned receipt refuses conversion with no partial report/provenance graph |
| 15 | PASS | runtime | Actual Continue action creates one canonical owned report/item/receipt/provenance graph |
| 16 | PASS | runtime | Converted claim retains original evidence and opens same existing report |
| 17 | PASS | runtime | Converted claim reload has exactly same report and no duplicate |
| 18 | PASS | runtime | Retained submitted identity |
| 19 | PASS | runtime | Retained submitted notes |
| 20 | PASS | runtime | Retained submitted filename |
| 21 | PASS | runtime | Retained submitted originalAmount |
| 22 | PASS | runtime | Retained submitted calculatedAmount |
| 23 | PASS | runtime | Retained submitted capturedZone |
| 24 | PASS | runtime | Retained submitted missingDestination |
| 25 | PASS | runtime | Retained submitted statusSubmitted |
| 26 | PASS | runtime | Retained submitted utc |
| 27 | PASS | runtime | Retained missing checksum disclosure |
| 28 | PASS | runtime | UTC timeline creation then submission |
| 29 | PASS | runtime | Synthetic non-auth claim GET 503 retains authorized record and safe heading |
| 30 | PASS | runtime | Keyboard local Retry restores fresh authorized read |
| 31 | PASS | runtime | Large preference saved through real account UI and survives reload at 18px |
| 32 | PASS | runtime | Phone 390 at 18px has one bounded h1 and main |
| 33 | PASS | runtime | Phone first Escape closes sidebar and restores trigger focus |
| 34 | PASS | runtime | Synthetic initial claim GET failure has safe heading and local Retry |
| 35 | PASS | runtime | Keyboard local Retry returns authorized claim after synthetic initial failure |
| 36 | PASS | runtime | Synthetic background claim failure retains record and local Retry |
| 37 | PASS | runtime | Local Retry recovers synthetic background failure |
| 38 | PASS | runtime | Real UI dark theme and collapsed sidebar survive reload |
| 39 | PASS | runtime | Wide 2400 dark Large layout keeps h1/main within viewport |
| 40 | PASS | runtime | small-restricted actual fresh UI reader cannot see other owner claim |
| 41 | PASS | runtime | large-employee actual fresh UI reader cannot see other owner claim |
| 42 | PASS | runtime | Actual rendered React fiber names include both target detail and conversion panel |
| 43 | PASS | runtime | Canonical permitted local partial reimbursement records EUR 1.25 and EUR 119.25 balance |
| 44 | PASS | runtime | Actual React tree names include TravelExpenseClaimDetail on approved claim |
| 45 | PASS | runtime | Approved retained evidence preserves reason/comment and ordered UTC timeline |
| 46 | PASS | runtime | Retained decision actor label matches original fixture actor |
| 47 | PASS | database-readback/preservation | own-org time_entry preserved |
| 48 | PASS | database-readback/preservation | own-org time_record preserved |
| 49 | PASS | database-readback/preservation | own-org travel_expense_allowance_override preserved |
| 50 | PASS | database-readback/preservation | own-org travel_expense_allowance_policy preserved |
| 51 | PASS | database-readback/preservation | own-org travel_expense_allowance_policy_version preserved |
| 52 | PASS | database-readback/preservation | own-org travel_expense_attachment preserved |
| 53 | PASS | database-readback/preservation | own-org travel_expense_claim preserved |
| 54 | PASS | database-readback/preservation | own-org travel_expense_decision_log preserved |
| 55 | PASS | database-readback/preservation | own-org travel_expense_export_batch preserved |
| 56 | PASS | database-readback/preservation | own-org travel_expense_export_batch_revision preserved |
| 57 | PASS | database-readback/preservation | own-org travel_expense_legacy_draft_conversion expected canonical delta |
| 58 | PASS | database-readback/preservation | own-org travel_expense_mileage_rate preserved |
| 59 | PASS | database-readback/preservation | own-org travel_expense_payroll_run_inclusion preserved |
| 60 | PASS | database-readback/preservation | own-org travel_expense_payroll_run_preview_control preserved |
| 61 | PASS | database-readback/preservation | own-org travel_expense_per_diem_rate preserved |
| 62 | PASS | database-readback/preservation | own-org travel_expense_policy preserved |
| 63 | PASS | database-readback/preservation | own-org travel_expense_project_attribution_exception preserved |
| 64 | PASS | database-readback/preservation | own-org travel_expense_project_history_capture preserved |
| 65 | PASS | database-readback/preservation | own-org travel_expense_receipt_upload preserved |
| 66 | PASS | database-readback/preservation | own-org travel_expense_reference_rate_policy preserved |
| 67 | PASS | database-readback/preservation | own-org travel_expense_report expected canonical delta |
| 68 | PASS | database-readback/preservation | own-org travel_expense_report_adjustment preserved |
| 69 | PASS | database-readback/preservation | own-org travel_expense_report_cycle_closure preserved |
| 70 | PASS | database-readback/preservation | own-org travel_expense_report_item expected canonical delta |
| 71 | PASS | database-readback/preservation | own-org travel_expense_report_item_conversion preserved |
| 72 | PASS | database-readback/preservation | own-org travel_expense_report_per_diem preserved |
| 73 | PASS | database-readback/preservation | own-org travel_expense_report_receipt expected canonical delta |
| 74 | PASS | database-readback/preservation | own-org travel_expense_report_review_note preserved |
| 75 | PASS | database-readback/preservation | own-org travel_expense_report_supplemental_receipt preserved |
| 76 | PASS | database-readback/preservation | own-org travel_expense_settings preserved |
| 77 | PASS | database-readback/preservation | own-org travel_expense_settlement_entry expected canonical delta |
| 78 | PASS | database-readback/preservation | own-org work_period preserved |
| 79 | PASS | database-readback/preservation | foreign-org time_entry preserved |
| 80 | PASS | database-readback/preservation | foreign-org time_record preserved |
| 81 | PASS | database-readback/preservation | foreign-org travel_expense_allowance_override preserved |
| 82 | PASS | database-readback/preservation | foreign-org travel_expense_allowance_policy preserved |
| 83 | PASS | database-readback/preservation | foreign-org travel_expense_allowance_policy_version preserved |
| 84 | PASS | database-readback/preservation | foreign-org travel_expense_attachment preserved |
| 85 | PASS | database-readback/preservation | foreign-org travel_expense_claim preserved |
| 86 | PASS | database-readback/preservation | foreign-org travel_expense_decision_log preserved |
| 87 | PASS | database-readback/preservation | foreign-org travel_expense_export_batch preserved |
| 88 | PASS | database-readback/preservation | foreign-org travel_expense_export_batch_revision preserved |
| 89 | PASS | database-readback/preservation | foreign-org travel_expense_legacy_draft_conversion preserved |
| 90 | PASS | database-readback/preservation | foreign-org travel_expense_mileage_rate preserved |
| 91 | PASS | database-readback/preservation | foreign-org travel_expense_payroll_run_inclusion preserved |
| 92 | PASS | database-readback/preservation | foreign-org travel_expense_payroll_run_preview_control preserved |
| 93 | PASS | database-readback/preservation | foreign-org travel_expense_per_diem_rate preserved |
| 94 | PASS | database-readback/preservation | foreign-org travel_expense_policy preserved |
| 95 | PASS | database-readback/preservation | foreign-org travel_expense_project_attribution_exception preserved |
| 96 | PASS | database-readback/preservation | foreign-org travel_expense_project_history_capture preserved |
| 97 | PASS | database-readback/preservation | foreign-org travel_expense_receipt_upload preserved |
| 98 | PASS | database-readback/preservation | foreign-org travel_expense_reference_rate_policy preserved |
| 99 | PASS | database-readback/preservation | foreign-org travel_expense_report preserved |
| 100 | PASS | database-readback/preservation | foreign-org travel_expense_report_adjustment preserved |
| 101 | PASS | database-readback/preservation | foreign-org travel_expense_report_cycle_closure preserved |
| 102 | PASS | database-readback/preservation | foreign-org travel_expense_report_item preserved |
| 103 | PASS | database-readback/preservation | foreign-org travel_expense_report_item_conversion preserved |
| 104 | PASS | database-readback/preservation | foreign-org travel_expense_report_per_diem preserved |
| 105 | PASS | database-readback/preservation | foreign-org travel_expense_report_receipt preserved |
| 106 | PASS | database-readback/preservation | foreign-org travel_expense_report_review_note preserved |
| 107 | PASS | database-readback/preservation | foreign-org travel_expense_report_supplemental_receipt preserved |
| 108 | PASS | database-readback/preservation | foreign-org travel_expense_settings preserved |
| 109 | PASS | database-readback/preservation | foreign-org travel_expense_settlement_entry preserved |
| 110 | PASS | database-readback/preservation | foreign-org work_period preserved |
| 111 | PASS | database-readback/preservation | draft original travel_expense_claim unchanged |
| 112 | PASS | database-readback/preservation | draft original travel_expense_attachment unchanged |
| 113 | PASS | database-readback/preservation | draft original travel_expense_decision_log unchanged |
| 114 | PASS | database-readback/preservation | submitted original travel_expense_claim unchanged |
| 115 | PASS | database-readback/preservation | submitted original travel_expense_attachment unchanged |
| 116 | PASS | database-readback/preservation | submitted original travel_expense_decision_log unchanged |
| 117 | PASS | database-readback/preservation | approved original travel_expense_claim unchanged |
| 118 | PASS | database-readback/preservation | approved original travel_expense_attachment unchanged |
| 119 | PASS | database-readback/preservation | approved original travel_expense_decision_log unchanged |
| 120 | PASS | database-readback/preservation | unavailable original travel_expense_claim unchanged |
| 121 | PASS | database-readback/preservation | unavailable original travel_expense_attachment unchanged |
| 122 | PASS | database-readback/preservation | unavailable original travel_expense_decision_log unchanged |
| 123 | PASS | database-readback/preservation | same-org-sentinel original travel_expense_claim unchanged |
| 124 | PASS | database-readback/preservation | same-org-sentinel original travel_expense_attachment unchanged |
| 125 | PASS | database-readback/preservation | same-org-sentinel original travel_expense_decision_log unchanged |
| 126 | PASS | database-readback/preservation | foreign-sentinel original travel_expense_claim unchanged |
| 127 | PASS | database-readback/preservation | foreign-sentinel original travel_expense_attachment unchanged |
| 128 | PASS | database-readback/preservation | foreign-sentinel original travel_expense_decision_log unchanged |
| 129 | PASS | database-readback/preservation | One conversion provenance for valid draft |
| 130 | PASS | database-readback/preservation | Converted receipt keeps exact original storage/checksum/filename identity |
| 131 | PASS | database-readback/preservation | Converted item retains entered amount/currency and multiline notes |
| 132 | PASS | database-readback/preservation | Conversion immutable snapshot preserves original and calculated money, zone, destination and notes |
| 133 | PASS | database-readback/preservation | Only intended local partial reimbursement persisted once |
| 134 | PASS | database-readback/preservation | Missing receipt draft has no partial conversion |
| 135 | PASS | source/resource preservation | Frozen HEAD, app tree and branch |
| 136 | PASS | source/resource preservation | All tracked file hashes unchanged |
| 137 | PASS | source/resource preservation | Git index byte hash unchanged |
| 138 | PASS | source/resource preservation | All 158 root/app dependency links unchanged |
| 139 | PASS | source/resource preservation | Lock and genuine 125-entry license unchanged |
| 140 | PASS | source/resource preservation | All owned live resources zero |
