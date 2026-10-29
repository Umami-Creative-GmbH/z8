# Compact artifact output

Primary and companion checkpoint and finalization writes use compact JSON. Parsing produces the same values, keys and array order; string contents, including opaque evidence payloads, remain unchanged. Primary keeps its existing lack of a trailing newline, and companion keeps its newline. Plans and certificates keep their existing formatting.

This reduces prospective artifact size without changing the private 256 MiB read admission or any observation, resource, count, timeout, error or numerical gate. A small worked example is 73 bytes when pretty printed and 29 bytes compact (74 and 30 with the companion newline). It demonstrates the format difference without creating a large test artifact or changing the real limit.

Previously failed captures remain failed and unchanged. Formatting does not repair their observation failures or make their evidence eligible. New captures still require every existing validation and acceptance check.
