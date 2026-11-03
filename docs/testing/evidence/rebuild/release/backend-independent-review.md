# Backend task-level verification

Verdict: CONFIRMED for the two reported security fixes; no blocking issue found in the reviewed backend baseline. This is a precommit task check, not a release audit.

Date: 2026-11-04. Scope: backend/*.js, server.js, production-server.js, tools/http-server.js, package.json, docs/ACCOUNTS.md, tests/account-backend*.test.js. No implementation files changed. No build executed.

## Reproducible test evidence

Command (workspace E:/HowdoIgetthere):

```powershell
node --test tests/account-backend-api.test.js tests/account-backend-store.test.js tests/account-backend-network.test.js
```

Exit 0: 24 tests, 24 pass, 0 fail, 0 skipped (1979.5565 ms).

Tests exercise actual HTTP and SQLite; only external providers are replaced. Confirmed canonical compressed/expanded/uppercase/rotated IPv6 /64 behavior, mapped IPv4 forms, trusted forwarded header use, and rejection of untrusted forwarded header attempts to reset login budgets. Ownership, version conflicts, session expiry/logout, single-use auth state, quotas, failure-charged idempotency and eight SQLite connections racing for the final reservation all passed.

## Independent runtime probe

Executed a PowerShell single-quoted here-string piped to `node --input-type=module`; imports were node:assert/strict, node:http, backend/api.js, backend/store.js, backend/config.js. The fixture used an isolated in-memory SQLite database, loopback HTTP, an explicit fixture secret and fake authorization/exchange functions. No live external service or credentials were used.

Observed sequence:

1. Preserve a real HTTP login flow from 198.51.100.2.
2. From a configured trusted loopback proxy, alternate X-Forwarded-For among `192.0.2.1`, `::ffff:192.0.2.1`, `::FFFF:C000:0201`, and `0:0:0:0:0:ffff:c000:201`.
3. First ten login requests return 302. Next 1,010 requests all return 429/login_rate_limit. Authorization provider call count stays at 11 including the preserved independent flow.
4. Submit the preserved cookie/state to the real callback endpoint: 302 success. A new independent network 203.0.113.1 can also initiate login (302).
5. In a second isolated SQLite store with injected time, insert 1,000 flows across 100 networks (10 each). The next independent network receives login_busy. Consume the first flow: its original state is preserved. A new independent flow succeeds in the freed slot. Reusing the first network still receives login_rate_limit, demonstrating consumption does not reset attempts. Advance 600,001 ms: that network may initiate again.

Probe exit 0, output:

```text
PASS real HTTP mapped IPv4 flood: 10 admitted, 1010 denied, no excess provider calls; preexisting login callback and independent network remain usable
PASS SQLite global cap: 1000 flows, overflow rejected without eviction; consuming flow does not reset network attempts; budget expires after ten minutes
```

## Code findings and boundary

- network.js expands IPv6 before extracting the first four 16-bit words; mapped IPv4 becomes dotted IPv4 before hashing. api.js uses this shared function for login and SMS network budgets.
- store.putFlow performs expiry cleanup, network-attempt check, global pending-flow check and insertion in one BEGIN IMMEDIATE transaction. api.js reserves this before authorizationUrl and removes failed-provider flows without refunding attempts.
- Trusted proxy matching is exact socket-address matching. The documented proxy requirement to overwrite inbound X-Forwarded-For remains important; arbitrary untrusted sockets do not influence the bucket.
- Distributed exhaustion across 100 or more source networks remains possible by design and is documented. This does not reopen the original single-network 1,000-flow exhaustion.
- Baseline review found ownership checks before travel access/mutation and AI identity, atomic quota/reservation checks, request-fingerprint conflicts and no retry refunds. No obvious precommit blocker identified.
- Actual Google OAuth, SMS delivery, Gemini billing, deployed proxy configuration, persistence/restore and whole-release behavior were not verified by this task.
