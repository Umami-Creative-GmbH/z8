# R168 capability inventory

Recorded before production edits at 87b431bd6116ab90aed9d822db835dc78107bffb.
The original owners and final locations below are intentionally the same unless stated.

| Capability / complete field group | Authority and state owner | Final location |
| --- | --- | --- |
| Owner current report vs reviewer/finance frozen read; explicit cycle; sensitive unavailable/no employee | RSC report-read, current-owner; actual actions reauthorize | Full-page route; scope gate and fresh read arrival |
| Back to personal expenses; reviewer inbox; approved finance; earlier owner cycle to current report | Route access and existing financeActorReads | Back link above heading, exact original destinations |
| Report kind/name/status; deletion only never-submitted drafts; legacy conversion provenance/link | report-name, report-deletion, legacy-conversion | PageHeader and original notices; delete public props unchanged |
| Trip purpose, first/last travel day, travel-date zone, ordered destinations/place/country, trip project | TripDetailsEditor + versioned saveTripDetailsDraftAction | Trip details full-page form; TanStack and plain dates retained |
| Receipt date, category, description, original amount/currency, paid by employee/company, accounting reference | ReceiptItemEditor + saveReceiptItemDraftAction | Expense editor, same field labels and decimal-string parse |
| Item project inherit/none/explicit, eligible choices and attribution exceptions | project-picker and project actions; saved version exclusivity | Existing project fields; original policy and messages |
| Receipt upload/type/size/progress/error; preview/download/remove/confirm; missing-receipt reason and version | receipt-attachments, file-upload hook, receipt-exception actions | Existing item evidence sections |
| Conversion original/effective amount, manual rate/date/evidence receipt, reference-rate provenance/refresh/unsupported/refusals | currency-conversion-field and domain conversion | Existing conversion field and review summary |
| Mileage date, route, vehicle type, distance, accounting reference, project; server-calculated amount/currency, statutory/company rate breakdown and override evidence | MileageItemEditor + mileage action and canonical calculation | Existing full-page mileage editor |
| Per diem departure/return date/time/each zone; overnight, prolonged workplace; daily destination/country, breakfast/lunch/dinner provided and employee payment deductions; calculated amount/currency and allowance override | PerDiemItemEditor + canonical actions | Existing itinerary/day editors and calculation panel |
| Add receipt/mileage/per diem (one per diem), remove exact item and receipt evidence, pending/errors/focus new item | useTripExpenseItems | Trip expense list and add controls |
| Autosave/manual native submit, unsaved/saving/saved/refused/invalid/conflict; Retry/use theirs/keep mine; hide/unload | useDraftSaver + versioned domain saver; each form retains typed fields | Each editor's local save status; retirement guards added |
| Still needed, future date/trip-end/return, project eligibility, unsaved values; live reimbursement/company-paid/excluded totals | existing requirements, useSubmissionNow, receiptReportTotals | Original guidance, totals, submission footer |
| Review exact saved version/items/receipts/exception/conversion/amount; submit, self approval, all refusal outcomes and settings link | SubmitReportPanel + submitTravelExpenseReportAction | Review dialog, original frozen payload and outcomes |
| Current pending owner withdraw; return notes/item comments including removed items; reopen reason and returned allowed action; adjustment original/baseline/delta/reason and create | report-review-cycle, report-reopen, report-adjustments and their actions | Existing lifecycle/evidence sections; task lifetime safeguards |
| Frozen trip/items/receipts, cycle-specific links, late receipt supplier/time, missing exception acceptance/allowance evidence, decisions/deputies/UTC timeline, every cycle | getTravelExpenseReportSubmission + immutable submitted facts | Cycle context leads, evidence/history remain; local refresh Retry |
| Approved latest owner/finance settlement; reviewer reopen; owner adjustment; no earlier cycle settlement form | Returned access/status plus settlement panel's independent authorization | Public SettlementPanel source props preserved; shared finance files read-only |
| Expanded/collapsed/mobile shell, global refresh/clock/timezone/search/account/org, theme/text preference/reload, keyboard/Escape/return focus | Existing F1/F3 shell/providers/primitives | Inherited owners preserved; exact UUID detail heading opt-in only |

No form under this route imports react-hook-form. No new money/date/schema/policy/authorization semantics.
1747 list/history and 1748 conversion are fixed-source compatibility reads only; 1749 settlement files remain read-only.
Public component and action/PostgreSQL tests are the approved seams; browser/live revocation is a separate acceptance boundary.
