# Date/Time: Luxon

Use **Luxon** for all date/time operations. Do not use native `Date`.

```typescript
import { DateTime } from 'luxon'

DateTime.now()                              // Current time
DateTime.fromISO('2024-01-15T10:30:00')     // Parse ISO
dt.toLocaleString(DateTime.DATE_MED)        // Format
dt.setZone('America/New_York')              // Timezone
```
