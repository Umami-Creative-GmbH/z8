---
status: accepted
---

# Payroll connectors ship on documented vendor APIs, or are withdrawn

None of the three payroll connectors had ever delivered to a real vendor account. Research for #1004 and the grilling of #1052–#1054 on 2026-10-30 found that the Workday connector's auth grant, worker lookup and endpoints are not in Workday's documentation. The SuccessFactors API connector authenticates in a way SAP doesn't document, posts absences to an `EmployeeTimeOff` entity that doesn't exist, and posts attendance to `EmployeeTime`, which SAP forbids for attendance. We decided that a payroll connector ships once it is contract-verified and counts as done only once it is tenant-verified. A connector we can't fix and verify is withdrawn rather than left on offer. Workday and the SuccessFactors API connector are withdrawn. Personio moves to its documented v2 API, as described in ADR 0003. The trade-off is fewer integrations on offer, in exchange for not offering connectors that fail against every real tenant while reporting success.

## Consequences

- **A withdrawn connector disappears from use:**
  - It is not offered in settings, the export form or scheduled exports.
  - Existing configurations are deactivated.
  - Scheduled exports to it are paused.
  - Its stored credentials are deleted from the secret store.
  - Its past payroll exports stay in the history.
- **Format ids stay, code goes.** The format ids remain, marked withdrawn, because jobs and configurations reference them. Their implementation code is removed: a rebuild starts from this record, not from the old code.
- **Admins are told.** Admins of every organization with a configuration or scheduled export for a withdrawn connector get an in-app notice on the payroll export settings and a one-time notification. The notification says what stopped and names the file alternative.
- **The landing claim stays at five.** The approved "5 payroll export targets" still holds: DATEV, Lexware, Personio, SAP SuccessFactors as an import file, and Sage. Copy must not claim a SuccessFactors API connection, and Workday is not named. The SuccessFactors CSV's own column layout has not been checked against SAP's documented import either; that is a separate follow-up.
- **How a withdrawn connector returns:** it is rebuilt against the documented design below, contract-verified, and tenant-verified in a customer's sandbox or implementation tenant. Neither vendor documents a free developer tenant for a vendor like Z8.

## Documented design for a rebuild

**Workday** (researched 2026-10-30 in the Workday Web Services v47.0 directory, the REST OpenAPI files and doc.workday.com):

- **Auth:** an API client for an Integration System User, using either a non-expiring refresh token or a JWT bearer grant with an x509 key, at `https://{host}/ccx/oauth2/{tenant}/token`. `client_credentials` is documented only for Workday Extend apps.
- **Worker:** referenced by `Employee_ID`, as `GET …/staffing/v7/…/workers/Employee_ID={id}`. Staffing v7 also filters `GET /workers` by `email`.
- **Worked time goes to Workday Time Tracking:**
  - Use [`Put_Reported_Time_Blocks_for_Worker`](https://community.workday.com/sites/default/files/file-hosting/productionapi/Time_Tracking/v47.0/Put_Reported_Time_Blocks_for_Worker.html). Its reference IDs allow updates without duplicates.
  - The REST alternative is timeTracking v7 `POST /workers/{ID}/workerTimeBlock`, which has no client reference ID.
  - Both need a time entry code per tenant.
- **Absences go to Absence Management:**
  - Use [`Enter_Time_Off`](https://community.workday.com/sites/default/files/file-hosting/productionapi/Absence_Management/v47.0/Enter_Time_Off.html), with `Auto_Complete`, `Time_Off_Entry_ID` and a time off type per tenant.
  - REST `requestTimeOff` starts a business process and has no auto-complete.
- **What the customer needs:**
  - Both paths require the customer to run those Workday modules.
  - Payroll input is not an alternative for DACH customers: Workday Payroll does not cover Germany or Austria.

**SAP SuccessFactors** (researched 2026-10-30 in the OData v2 API reference and the Time Management guides, release 2611):

- **Auth:**
  - The method is an OAuth 2.0 SAML bearer assertion (`grant_type=urn:ietf:params:oauth:grant-type:saml2-bearer`), signed with an X.509 key pair registered in the customer's tenant.
  - `client_credentials` with a client secret is not documented.
  - `/oauth/idp` is deprecated and is deleted on 2027-05-14.
  - Basic auth for APIs is deleted on 2027-11-12.
- **Absences:** [`EmployeeTime`](https://help.sap.com/docs/successfactors-platform/sap-successfactors-api-reference-guide-odata-v2/employeetime), with an absence time type and keyed by `externalCode`.
- **Worked time:**
  - Use [`ExternalTimeData`](https://help.sap.com/docs/successfactors-platform/sap-successfactors-api-reference-guide-odata-v2/externaltimedata), which writes into the Time Sheet.
  - It takes local dates and times and needs a time profile with a default import attendance time type.
  - Never use `EmployeeTime`: SAP states "You must not use Time Off to record attendances".
