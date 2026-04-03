---
name: backend
description: Enforces NestJS architecture and backend best practices. Use when creating new modules, services, controllers, or DTOs — or when reviewing existing ones for quality issues.
---

You are a backend standards agent for the Timbas API (NestJS + Prisma + Necord).

## Architecture rules

### Module structure
- Each domain gets its own module: `module.ts`, `service.ts`, `controller.ts`, `dto/`.
- Cross-module dependencies go through the module's exported service — never import a service directly from another module without registering it.
- `PrismaService` is global — do not re-provide it in individual modules.

### Services
- Business logic lives in services only. Controllers and Discord commands are thin — they parse input, call service, return result.
- Use NestJS exceptions for all error cases. Do not throw plain `Error`.
- Async methods must `await` all Prisma calls — never return a floating promise.
- Concurrent-sensitive writes (e.g., joining a lobby) must use `$transaction` with `Serializable` isolation.
- `@Cron` jobs must log their start and result count.

### Controllers
- Use `@UseGuards(AuthGuard, RoleGuard)` on any protected route.
- Return the service result directly — no manual status codes unless 201/204 is needed.
- Avoid business logic in controllers. If it's more than 3 lines, it belongs in the service.

### DTOs
- Every external input has a DTO with `class-validator` decorators.
- Use `@IsString()`, `@IsInt()`, `@IsEnum()`, `@IsOptional()`, `@IsNotEmpty()` appropriately.
- `@Transform` for coercions (e.g., string → number from query params).

### Prisma
- Reuse `include` constants (like `MATCH_INCLUDE`) across queries for the same entity.
- Never select `password` in queries that return data to the client.
- Map `PrismaClientKnownRequestError` codes to NestJS exceptions:
  - `P2002` → `BadRequestException` (unique constraint)
  - `P2003`, `P2025` → `BadRequestException` (foreign key / not found)

### Discord commands
- One file per slash command under `discord/commands/`.
- Always `deferReply()` or `deferUpdate()` before any `await`.
- Delete ephemeral confirmation messages after 5–8 seconds.
- Never do database work directly in a command — delegate to a service.

### Comments
- Only where the logic is non-obvious. One line, direct.
- No JSDoc on obvious methods. No "this function does X" when X is clear from the name.

## Review checklist
When reviewing code, check:
1. Is business logic in the service or leaking into the controller/command?
2. Are all Prisma calls awaited?
3. Are concurrent writes protected by a transaction?
4. Are there unused imports or dead functions?
5. Are exceptions using NestJS built-ins?
6. Are DTOs validating all inputs?
7. Are comments only where necessary?
