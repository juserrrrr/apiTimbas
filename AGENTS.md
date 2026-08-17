# Timbas API: Agent Context

## Project Overview
NestJS REST API + Discord bot for managing custom League of Legends matches.
- **Framework:** NestJS with Necord (Discord.js wrapper)
- **ORM:** Prisma (PostgreSQL)
- **Auth:** JWT (access 7d + refresh 30d) via HttpOnly cookies
- **Rate limiting:** ThrottlerGuard (50 req/60s default, 5 req/60s on auth endpoints in production)
- **Bot library:** Necord, use `@SlashCommand`, `@On`, `@Once`, `@Button`, `@StringSelect` decorators

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
├── common/                 # ActorService (discordId → User), global module
├── economy/                # Coin wallet: credit/debit/transfer, statement, ranking
├── score-reader/           # Pluggable scoreboard reading from photos (admin-configured)
├── tournament/             # Brackets for any game (single/double elim, league, groups)
├── draft/                  # Draft leagues: pool, live draft, fixtures, transfer market
├── football/               # Pure football math: attributes, match engine, development
└── prisma/                 # PrismaService
```

### Competition modules
`tournament/` and `draft/` are **separate products** and must not import from each
other. They share `score-reader/` and the `MatchProof` table (two nullable FKs, one
per domain).

Money is not shared. `economy/` is the account wallet, one balance per user, and
only `tournament/` pays into it. A draft league runs on its own cash: `DraftRoster.
budget`, seeded from `DraftLeague.startingBudget` when the draft starts, spent on
signings, transfers and the wage bill, and reset on the next draft. Every move is
logged in `DraftBudgetEntry`, which dies with the league. Voluntary spending is
blocked without cash; salary is an obligation, so it goes through and leaves the
roster in the red, which blocks signings until it recovers.

Neither is scoped to a Discord server, competitions are platform-wide. Only
match/ranking features use `serverId`.

Permissions inside a competition are per-competition (`CompetitionRole`), separate
from the platform `Role`:
- **OWNER**: edits rules, deletes, starts the bracket/draft, manages staff
- **MODERATOR**: approves/rejects proofs, reports results, schedules, declares W.O.
- A global `ADMIN` passes both checks.

`bracket.builder.ts` and `draft-order.ts` are pure functions with no I/O, the
bracket shapes and pick order are covered by `*.spec.ts` next to them. Change the
tests when you change the pairing rules.

### AI
`ai/` owns every AI call in the product. Never hardcode a provider or read a
provider key outside `AiProviderRegistry`.

- **Keys live only in environment variables**, one per provider. The registry
  reports whether each is present; nothing else may expose or store them.
- `AiSettings` (single row, id=1) holds only non-secret choices: which provider
  and model each feature uses, and the on/off switches. Admins edit it at
  `PATCH /admin/ai`.
- `ChatClient` speaks both wire protocols (Gemini `generateContent` and the
  OpenAI-compatible `chat/completions`), so swapping providers needs no code
  change. Add new providers to `AI_PROVIDERS`, not to call sites.
- Two features consume it: `analysis` (Clash scout, player profile, match recap)
  and `scoreReader` (photo proofs).

Score reading has two modes. `VISION` sends the image to the model. `OCR_TEXT`
extracts text with `LocalOcrService` and hands it to a text-only model, which is
how DeepSeek is usable. **OCR runs inside this API** via tesseract.js, with no
external service and no key; the worker is shared and terminates after five idle
minutes.

When AI is off or a call fails, reads return unavailable and the proof falls back
to manual approval. It must never block a result from being filed.

### Player catalog
`player-catalog/` is the global squad database that feeds draft league pools. It
is separate from `DraftPlayer`, which is a per-league copy taken at import time so
a later sync never rewrites a league already in progress.

Order of preference for filling it: a public API first (`FOOTBALL_DATA` via
`FOOTBALL_DATA_TOKEN`, or `GENERIC` for any JSON URL), then manual entry, then
image import through the AI stack. Syncing never deletes: players missing from the
source are flagged inactive so rosters that already picked them keep working.

Each player carries the six card attributes in the EA FC order (`pace`,
`shooting`, `passing`, `dribbling`, `defending`, `physical`). Goalkeepers reuse the
same six columns with the GK meanings, exactly like the card in the game, so the
labels come from `attributes.ts` and never from a second set of columns. They are
nullable: nobody has estimated yet.

`football/` holds the pure football math shared by the catalog and the draft:
the card attributes, the match engine and player development. No I/O, no Nest
module, covered by `*.spec.ts` next to each file. Change the tests when you change
the rules.

`simulateMatch` turns two lineups plus tactics into a score and a rating per
player. It is seeded by the match id, so a round replays to the same result and
the job stays idempotent. Attack, midfield and defense come from the attributes of
the players in each line, form shifts individual output, mentality and pressing
trade attack for defense, and goals are drawn from a Poisson with the expected
goals of each side. A lineup missing a whole line still plays, just worse.

Two jobs keep a league alive. `DraftSimulationService` runs every five minutes: it
plays matches whose kickoff has passed in leagues with `resultMode = SIMULATED`,
and opens or closes the transfer window around the round. `WorldSimulationService`
runs hourly but ticks each competition at most once a day, pairing its teams at
random so players outside our leagues keep playing, taking ratings and evolving.
A player picked into an active league is skipped there: he plays for his roster
now, not for his real club.

Development is deliberately slow: one attribute point at a time, only after four
matches, growth for the young in form and decline for the veteran in a bad run.
Without a birth date nobody declines by age, since the age is unknown.

`AttributeAiService` fills them by asking the `analysis` provider to rate players
it knows, in batches of twelve, and returns a confidence plus a one-line
justification so an admin can judge before keeping it. Editing an attribute by
hand clears `attributesModel`/`attributesNote`, since the number stopped being the
model's guess. `realTeam` on a pool player is only there to identify who the guy
is, it has no bearing on which roster he ends up in.

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
- CORS must enumerate allowed origins, no wildcards in production.
- Passwords hashed with bcrypt + genSalt (never hardcoded rounds < 10).
- Bot tokens expire: `24h` for secret-based, `1y` only for persistent bots.
- Input from Discord interactions must be treated as untrusted user input.

### Testing
- Tests go next to the file they test as `*.spec.ts`.
- Use real Prisma with a test database, **no mocking the database**.
- Mock only external services (Riot API, Discord API, HttpService).
- Test the happy path + at least one error path per public method.
- Spec files that only assert `expect(service).toBeDefined()` are useless, delete them.

### Git
- Commits in English, one line, imperative mood. Example: `fix: correct member count in presence status`
- No `Co-Authored-By` lines.
- No `--no-verify`.

## Writing
User-facing text is Portuguese and must never contain an em dash. Split the
sentence, or use a comma, colon or period instead. This applies to API error
messages, wallet descriptions and match labels, since all of them reach the
screen. The AI prompts in `ai.service.ts` state the same rule to the model.

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
AI providers, all optional; the admin panel shows which are present and only
offers those:
```
GEMINI_API_KEY, DEEPSEEK_API_KEY, OPENAI_API_KEY
```
Player catalog sync, optional: `FOOTBALL_DATA_TOKEN`.
OCR model cache directory, optional: `OCR_CACHE_PATH` (defaults to the system temp
dir; set it to a writable path on read-only filesystems).

## Agents Available
Use these subagents for specialized tasks:

- **security**: Review code for security vulnerabilities before merging
- **backend**: Enforce NestJS best practices and architecture patterns
- **test-runner**: Write and run tests for new or modified services
- **code-review**: Full code review: dead code, unused imports, standards compliance
