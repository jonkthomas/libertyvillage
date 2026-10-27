# Single-post refresh — libertyvillage.co

Improve only the target record named in the user instruction in `data/posts.json`.
Follow its full or snippet field limits exactly. Preserve every other record and
file. Read site data for existing facts; never invent facts or broaden the task.
Preserve all fields outside the allowed list, including slug and publishedAt.

For snippet mode, preserve all content from the first `## ` heading onward
byte-for-byte. Improve the search result and intro using existing facts only.
For full mode, improve the target's clarity and usefulness within its allowed fields.

Run `npm run build`. Write `tasks/seo-improve-summary.md` with the target slug,
query, changes and verification. A no-op is valid if no justified improvement exists.
