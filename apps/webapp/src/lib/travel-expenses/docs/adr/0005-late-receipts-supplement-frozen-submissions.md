---
status: accepted
---

# Late receipts supplement frozen submissions

A report handler may receive a missing receipt document after an expense report has been submitted or approved. We keep that document as supplemental evidence for the expense item and submission cycle, with the actual supplier and upload time, because changing the frozen submission would misrepresent what was originally reviewed. The decision was accepted in [spec #1254](https://github.com/Umami-Creative-GmbH/z8/issues/1254).

Current review authority permits supplying a missing document during review. After approval, an expense officer needs export or record-reimbursements capability within the report's officer scope; owners and admins keep their implicit handling authority. Approval authority and officer grants remain separate, and officer scope keeps using the employee's teams captured at approval.

## Consequences

- Supplying a document preserves the original submission, missing-receipt reason and acceptance, expense details, approval history and financial state. It cannot replace an existing document or add another one to an item that already has one.
- Report readers can see and download the later document and identify who supplied it and when.
- A new export batch freezes the supplemental documents available when it is created. Earlier manifests and generated files stay fixed, including on retry. An already-exported report remains ineligible for duplicate export; its later document can be downloaded separately.
