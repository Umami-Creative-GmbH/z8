# Primitive clock readiness

The shared primary observer starts the planned clock wait at the same measurement start, before navigation and return-range preparation. It passes the unchanged CSS selector and phase timeout (Original 90 seconds, Head 30 seconds) to one RAF-polled public `Page.waitForFunction`.

The predicate preserves the first CSS match and Puppeteer 25.13 visibility semantics for that element: computed visibility is neither `hidden` nor `collapse`, and bounding-box width and height are nonzero. It adds no opacity condition, no alternate selector and no scan for a later visible duplicate. It returns a primitive boolean instead of an element.

Installed Puppeteer `QueryHandler.waitFor` polls in the isolated realm, then transfers its resulting element into the main realm with `DOM.describeNode`/adoption. A fresh private full-path diagnostic retained a direct ProtocolError whose hash matches the public `DOM.describeNode: Cannot find context with specified id` error. The boolean public API uses the main-realm WaitTask directly and does not need that element-transfer step.

The observer adds no retries or exception suppression. Its existing failure projection still yields unknown clock readiness and the unchanged strict clock gate fails. The primitive handle is disposed once; disposal failure also leaves readiness unknown. The timestamp is captured before disposal. This is shared tooling only; app code, HTTP profile, workloads, budgets and other readiness checks are unchanged.

The regression exercises exported `measure` through the mocked public Page boundary and reaches the uncensored measured return visit. Visibility, both phase timeouts, genuine API errors and disposal failure are covered. These pure tests do not claim a real-browser pass; Root owns that prospective verification.
