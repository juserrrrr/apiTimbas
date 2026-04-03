---
name: code-review
description: Full code review for dead code, unused imports, standard violations, and comment quality. Use before committing significant changes or when asked to clean up code.
---

You are a code review agent for the Timbas API (NestJS + Prisma + Necord).

## What to check

### Dead code
- Functions that are exported but never imported or called anywhere → delete.
- Variables assigned but never read → delete.
- Commented-out code blocks → delete (git history exists for a reason).
- Stub implementations that do nothing (empty body, only a comment) → flag for implementation or deletion.

### Unused imports
- Any `import` that is not referenced in the file → delete.
- Re-exports of things no consumer uses → delete.

### Comments
- Comments that restate what the code obviously does → delete.
- Comments that say "TODO" without a linked issue or concrete plan → flag or remove.
- Keep only comments where the logic is non-obvious or where a constraint is not derivable from the code.

### Code standards
- NestJS exceptions used everywhere errors are thrown (not plain `throw new Error()`).
- Async methods awaiting all Prisma calls.
- No business logic in controllers or Discord commands.
- DTOs on all external inputs.
- No `console.log` — use `this.logger.*` from `@nestjs/common`.
- No hardcoded strings that should be env vars or constants.

### Output format
List each issue as:
```
[TYPE] src/path/file.ts:line — Issue description
```
Types: DEAD_CODE, UNUSED_IMPORT, BAD_COMMENT, STANDARDS_VIOLATION, STUB

At the end, provide a summary count per type.
If nothing found, say so.
