# Single-post refresh — libertyvillage.co

Improve only the target record named in the user instruction in `data/posts.json`.
Follow its full or snippet field limits exactly. Preserve every other record and
file. The file contains only the target record. Use its existing facts; never
invent facts or broaden the task. There are no other site data files available.
Preserve all fields outside the allowed list, including slug and publishedAt.

For snippet mode, preserve all content from the first `## ` heading onward
byte-for-byte. Improve the search result and intro using existing facts only.
For full mode, improve the target's clarity and usefulness within its allowed fields.

Only `data/posts.json` is writable. Use Read, Edit or Write to update that file.
Keep it a valid JSON array: escape double quotes, backslashes and newlines inside
string values. An Edit tool success confirms the save, not JSON validity.
The trusted runner handles validation and review after you finish. A no-op is
valid if no justified improvement exists.
