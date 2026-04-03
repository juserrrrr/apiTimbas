# Timbas API — Claude Context

## Project Overview
NestJS REST API + Discord bot for managing custom League of Legends matches.
- **Framework:** NestJS with Necord (Discord.js wrapper)
- **ORM:** Prisma (PostgreSQL)
- **Auth:** JWT (access 7d + refresh 30d) via HttpOnly cookies
- **Rate limiting:** ThrottlerGuard (50 req/60s default, 5 req/60s on auth endpoints in production)
- **Bot library:** Necord — use `@SlashCommand`, `@On`, `@Once`, `@Button`, `@StringSelect` decorators

## Module Structure
```
src/
├── app.module.ts           # Root module
├── main.ts                 # Bootstrap, security headers, CORS, seedAdmin
├── auth/                   # JWT auth, Discord OAuth2, bot token
├── user/                   # User CRUD
├── discord/
│   ├── commands/           # Slash commands (one file per command)
│   ├── events/             # ready, member events
│   ├── interactions/       # Button/select menu handlers
│   ├── helpers/            # embed.helper.ts, team.helper.ts
│   └── services/           # channel-manager, event-state, match-state
├── customLeagueMath/       # Match lifecycle (create, join, draw, start, finish)
├── leaderboard/            # Win/loss ranking per server
├── riot/                   # Riot Games API integration + tournament API
├── discordServer/          # Discord server registration
└── prisma/                 # PrismaService
```

## Code Standards

### General
- **No unused imports.** Remove them immediately.
- **No dead code.** If a function is not called anywhere, delete it.
- **Comments only where logic is non-obvious.** One line, direct. No "this does X" when X is obvious from the code.
- **No speculative abstractions.** Solve what exists, not hypothetical future cases.
- **No error handling for things that cannot fail.** Trust NestJS/Prisma/Necord guarantees.
- Validate only at system boundaries: HTTP request DTOs, Discord interaction payloads, external API responses.

### NestJS Patterns
- Services are `@Injectable()` and receive dependencies via constructor.
- Use NestJS built-in exceptions: `BadRequestException`, `NotFoundException`, `ForbiddenException`, `UnauthorizedException`, `InternalServerErrorException`.
- Use Prisma `$transaction` with `Serializable` isolation for concurrent-sensitive operations (e.g., joining a match).
- DTOs use `class-validator` decorators. Always `whitelist: true` + `forbidNonWhitelisted: true`.

### Discord / Necord
- One slash command per file under `discord/commands/`.
- Button/select handlers go under `discord/interactions/`.
- Embed helpers go in `discord/helpers/`.
- Always `deferReply()` or `deferUpdate()` before async work.
- Delete ephemeral follow-ups after a timeout when they are confirmations.
- Guild-scoped commands use `guilds: process.env.DISCORD_GUILD_ID ? [process.env.DISCORD_GUILD_ID] : undefined`.

### Security (non-negotiable)
- Never log or expose secrets, tokens, or passwords.
- Use `timingSafeEqual` for secret comparison (already done in `auth.service.ts`).
- JWT issuer must be validated on verify calls.
- All auth endpoints must be rate-limited.
- CORS must enumerate allowed origins — no wildcards in production.
- Passwords hashed with bcrypt + genSalt (never hardcoded rounds < 10).
- Bot tokens expire: `24h` for secret-based, `1y` only for persistent bots.
- Input from Discord interactions must be treated as untrusted user input.

### Testing
- Tests go next to the file they test as `*.spec.ts`.
- Use real Prisma with a test database — **no mocking the database**.
- Mock only external services (Riot API, Discord API, HttpService).
- Test the happy path + at least one error path per public method.
- Spec files that only assert `expect(service).toBeDefined()` are useless — delete them.

### Git
- Commits in English, one line, imperative mood. Example: `fix: correct member count in presence status`
- No `Co-Authored-By` lines.
- No `--no-verify`.

## Known Incomplete / Stubs
- `auth.service.ts` → `forgotPassword()`: finds user but does not send email. Either implement or remove.
- `riot.service.ts` → `handleMatchCallback()`: stub, not processing tournament callbacks.
- `team.helper.ts` → `drawChampionForPosition()` and `getRandomChampions()`: exported but never called.

## Environment Variables (required)
```
DATABASE_URL, JWT_SECRET, DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET,
DISCORD_GUILD_ID, DISCORD_REDIRECT_URI, BOT_SECRET, WEB_URL,
ADMIN_DISCORD_ID, ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD
```

## Agents Available
Use these subagents for specialized tasks:

- **security** — Review code for security vulnerabilities before merging
- **backend** — Enforce NestJS best practices and architecture patterns
- **test-runner** — Write and run tests for new or modified services
- **code-review** — Full code review: dead code, unused imports, standards compliance
