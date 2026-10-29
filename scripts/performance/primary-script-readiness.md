# Prospective primary Script readiness

`visible-content-and-observed-script-completion-v1` is a stricter prospective primary measurement method, used identically for Original and Head. It does not change the C9 plan, routes, selectors, cohorts, formulas or resource gates. Earlier captures retain their original method and failures; this change does not repair or qualify them.

`firstVisibleContentMs` retains the former usable-content marker: normal route verification and visible readiness, or the existing mutation-ready marker. `usableContentMs` now also includes completion of measured, observed Script transfers. The same primary CDP session and existing request map retain requests, completion bytes and failures. Scripts arriving during the wait must also finish. Failed transfers or unknown Script completion cannot satisfy readiness.

The wait has one absolute deadline, measured start plus the existing plan timeout: 90 seconds for Original and 30 seconds for Head. It does not reset that deadline, retry navigation, prewarm resources, or wait for unrelated Fetch/XHR/EventSource work. With no pending Script it adds no wait. A failed or expired wait leaves usable-content latency null and preserves the observed failure and pending resources.

Completed JavaScript bytes and elapsed wait time stay in the measured window. The new usable-content timestamp and existing resource snapshot follow the Script drain without another asynchronous browser operation. The original `pendingScriptRequests === 0` gate remains mandatory. CDP detachment, restoration and the separate finite cleanup still happen afterward; cleanup counts never substitute for measured resource coverage. Clock readiness and native paint observations keep their existing separate meanings.

Artifacts name the method in runtime metadata and each sample. This is a method amendment, not a claim that the historical plan alone defined Script-complete readiness. Source fingerprints and fresh evidence must bind the new method for both builds. Complete Original functional/method/cohort qualification and all nine frozen budgets still precede any Head timing.
