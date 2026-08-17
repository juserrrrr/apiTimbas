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
├── access/                 # Platform permissions, dynamic groups, entry approval
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

`startMode` decides how the draft opens. `LIVE` is the default: every owner marks
ready in the waiting room and the draft opens the instant the last one does, since
picking together is half the point. A scheduled `draftStartsAt` holds it back until
that time, a minute cron opens it when both conditions are met, and the league owner
can always force it. `ASYNC` is the old behaviour, the owner opens it and the clock
picks for whoever is missing. Vacant teams never need to mark ready.

A roster can have no owner: `DraftRoster.userId` is nullable, and a vacant team
lets the league start without waiting for everyone. The vacant team picks
instantly in the draft instead of burning the clock, loses 3 to 0 by walkover in
REPORTED rounds, plays normally in SIMULATED ones, and the next person who joins
takes it over with its squad, cash and history intact.

A squad is a real squad: `rosterSize` defaults to 25, the same as EA FC, with 11
starters picked by the formation and the rest on the bench and in reserve.

Money is in reais on the real transfer market's scale, not coins. `football/
market-value.ts` is calibrated against Transfermarkt and CIES 2026 at R$ 6,30 per
euro, so 70 overall costs around R$ 20 mi, 80 around R$ 140 mi, 90 around R$ 815 mi
and 99 around R$ 2,17 bi, which is the CIES projection for Yamal. The curve has two
slopes on purpose: it opens fast up to 88 and flattens above it, because only a
handful of clubs can pay at the top, and without the brake a 99 would cost tens of
billions. Salary per round is 0,4% of the value, and `DEFAULT_ROUND_PRIZE` is sized
against the wage bill so winning covers it and losing does not. `economy.spec.ts`
locks that balance: change one of the three numbers without the others and it fails.

Because a top player costs more than a 32-bit integer holds, every league-money
column is `Float`, which is `double precision` in Postgres and stays a `number` in
TypeScript, exact for whole reais well past the trillions. Do not narrow one back
to `Int`.

Value follows overall, always. Anything that writes an overall (AI estimation, the
admin correcting it by hand, an import) writes `marketValueFor` with it, so nobody
sits in the base as a star priced like a reserve. `football/overall-tier.ts` cuts
the base into bands of ten, which is how the draft board and the base screen group
players: 90+ craques, 80-89 estrelas, 70-79 titulares, below that elenco.

Money is not shared. `economy/` is the account wallet, one balance per user, and
only `tournament/` pays into it. A draft league runs on its own cash: `DraftRoster.
budget`, seeded from `DraftLeague.startingBudget` when the draft starts, spent on
signings, transfers and the wage bill, and reset on the next draft. Every move is
logged in `DraftBudgetEntry`, which dies with the league. Voluntary spending is
blocked without cash; salary is an obligation, so it goes through and leaves the
roster in the red, which blocks signings until it recovers.

Tactics belong to `SIMULATED` only. In `REPORTED` the match happens inside EA FC
26, so the platform has no business asking for mentality or pressing: the API
refuses `setTactics` there and the screen does not show it. The lineup still exists
in both, but it means different things: who takes the field in the simulation, and
who counts as having played in the real one.

In `REPORTED` mode nobody simulates the match, so goals only exist if someone
types them: `report` takes an optional list of scorers, checked against the two
squads and against the score, and that is what fills the league's top scorers.
`SIMULATED` fills the same columns from the engine.

Auctions are open bids. The leader's money leaves the budget on the bid and is
refunded when someone outbids, so nobody wins an auction without the cash. A bid
inside the anti-snipe window pushes the deadline, and closing happens at the
deadline even with the transfer window shut, since closing is settlement and not
negotiation. A roster auctions its own players; the pool's free agents are
auctioned by the organization. `auction-rules.ts` holds the minimum bid and the
deadline extension as pure functions with a spec.

Neither is scoped to a Discord server, competitions are platform-wide. Only
match/ranking features use `serverId`.

### Access and permissions
`access/` owns who gets in and who can do what on the platform. `Role.ADMIN` is the
fixed super admin and always has every permission; everything else comes from
`PermissionGroup`, which an admin builds in the panel by ticking keys from
`permissions.ts`. That file is the only source of valid keys, and a group can never
store one that is not there.

Guard admin endpoints with `@RequirePermissions('key')` and `PermissionGuard`, not
with `@Roles(Role.ADMIN)`, so a dynamic group can be given the same power. The
panel decides its own menu from `GET /admin/access/me`, and entering the panel
needs at least one permission, not the ADMIN role.

`PlatformSettings.requireApproval` closes the door: with it on, a new Discord login
lands as `UserStatus.PENDING` and gets no token until someone with `users.approve`
releases it. Existing users stay APPROVED, so turning it on never locks the team
out.

Permissions inside a competition are per-competition (`CompetitionRole`), separate
from the platform `Role`:
- **OWNER**: edits rules, deletes, starts the bracket/draft, manages staff
- **MODERATOR**: approves/rejects proofs, reports results, schedules, declares W.O.
- A global `ADMIN` passes both checks.

### Match room
A tournament match is a room the two teams share: chat, schedule proposal, claimed
score and the opponent's confirmation, in `tournament-match.service.ts`. A team
claims the score, the other confirms and it settles, or disputes and the
organization decides. `Tournament.requireOpponentConfirm` turns the confirmation
step off; `woAfterHours` is the clock.

The clock starts at `TournamentMatch.readyAt`, set the moment the match becomes
playable. When it runs out, the hourly job looks at who engaged, meaning proposed a
time, claimed a score or talked in the chat: one side engaged wins by walkover, no
side engaged gives it to the better seed so the bracket keeps moving, and both
sides engaged goes to DISPUTED, since that is a human call. Every step writes a
system message, so the decision always has a trail.

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
