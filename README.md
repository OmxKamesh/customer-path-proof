# Customer Path Proof

**The screen says “Saved!” Did the application actually save it?**

Customer Path Proof pairs a customer journey with an independent readback of its result. A tiny Playwright runner collects screenshots, failed network responses, console errors, and the first failed outcome. A standalone CLI runs without an AI account. An optional Claude skill helps turn evidence into a focused diagnosis and a clean replay after a fix.

By **Kamesh Jindal / OMX Digital**. Early, focused MVP; no adoption or comprehensive coverage claims.

![Actual Chrome evidence: the broken app shows success but fails saved-state verification; the repaired replay passes.](docs/proof.png)

## Run the proof in two minutes

Requires Node.js 20+ and a supported Playwright browser.

```sh
npm ci
npx playwright install chromium
npm run demo
```

Open the printed `artifacts/extended-.../index.html`. The demo starts its own loopback servers and closes them afterward. No login, API key, cloud service, or real customer data is used.

The command runs six scenarios and exits successfully only when all three deliberate bugs are detected and all three repaired fixtures pass:

| Contract | Deliberately broken | Fixed |
| --- | --- | --- |
| Feedback saved | UI says saved despite a 503 write; readback is empty | Server returns the submitted value |
| Refresh + new session | Session-only data survives refresh, then disappears in a fresh browser context | Server-held data survives both checks |
| Upload readback | UI says saved, but backend truncates the bytes | Downloaded bytes have the fixture's SHA-256 hash |

The original feedback-only demonstration remains available with `npm run demo:original`. Existing evidence under `docs/evidence/` and `docs/proof.png` is from that original demonstration, not evidence of the new scenarios.

To use an already installed Chrome instead of downloading Chromium, set `CPP_BROWSER_CHANNEL=chrome` for the demo (PowerShell: `$env:CPP_BROWSER_CHANNEL='chrome'`). The CLI equivalent is `--channel chrome`. Alternatively set `CPP_BROWSER_EXECUTABLE` (or `--executable`) to an installed compatible browser binary.

## Test your authorized local or staging app

Copy `demo/journey.json`; replace selectors and the persisted outcome endpoint with your app's own test fixture. Then:

```sh
node scripts/run.cjs --contract journey.json --origin http://127.0.0.1:3000 --out artifacts/my-run --allow-write POST:/api/feedback
```

The output directory must not already exist. Each run preserves its own evidence. Omit `--allow-write` for read-only journeys; repeat it for additional exact method/path pairs. Only the given origin is allowed. Query strings do not change write-path matching. Explicit origin and write flags express scope, not proof of ownership: run only on systems you are authorized to test.

Contract version 1 supports:

| Action | Required fields | What it checks |
| --- | --- | --- |
| `open` | `path` | Same-origin navigation succeeds |
| `fill` | `selector`, `value` | Fill an input using Playwright |
| `click` | `selector` | Click an element |
| `visible` | `selector`, `value` | Exact visible text |
| `saved` | `path`, `field`, `equals` | Independent GET returns 200 and a top-level JSON field deeply equals the expected value; optional `adapter: "json-field"` |
| `refresh` | none | Reloads the current page; follow with an outcome assertion |
| `newSession` | `path` | Closes the context, creates one without the previous cookies/storage, reapplies scope controls and opens the path |
| `upload` | `selector`, `fixture` | Sets a file input from an explicitly allowed local synthetic fixture |
| `fileSaved` | `path`, `fixture`, `adapter: "bytes-sha256"` | Independent GET returns 200 and raw response bytes hash to the fixture's SHA-256 |

Every step needs a unique `id`. At least one `saved` or `fileSaved` check is required. Readback is immediate: this MVP intentionally does not guess an eventual-consistency window. Use deterministic fixtures and endpoints that expose the relevant saved result. There is no arbitrary JavaScript step, imported browser profile, login management, account creation, or payment workflow.

Exit codes: `0` passed, `1` check failed, `2` blocked/incomplete/invalid invocation. Inspect `report.json` for the exact status, first divergence, and unexecuted steps. `report.html` is a standalone visual report linked to PNG evidence. Console and HTTP errors are diagnostic context, not automatic assertion failures.

## Explicit adapters, not arbitrary-URL magic

Choose the readback contract for your application. `json-field` compares a top-level JSON field; `bytes-sha256` compares raw bytes. There is no automatic backend discovery, DOM inference, or proof that a success message means a database write. The endpoint must expose the actual result, not echo a request or return a hard-coded fixture. Avoid stale fixture values: use an isolated test database and unique synthetic values.

For a file journey, copy `demo/upload.json`, adapt its selectors/endpoints and explicitly grant both the file and exact write:

```sh
node scripts/run.cjs --contract upload.json --origin http://127.0.0.1:3000 --out artifacts/upload-run --allow-write POST:/api/upload --file sample=demo/fixtures/sample.txt
```

Contracts can reference fixture IDs, never read arbitrary local paths. `--file` explicitly grants that file for the run. Use synthetic fixtures only (maximum 1 MiB). Raw file readback is also capped at 1 MiB and redirects are never followed. The same in-memory bytes are uploaded and hashed, avoiding a between-step file-change mismatch. File bodies are not included in the report, but the filename may appear in screenshots. A raw-byte adapter will intentionally fail if your application transforms files; define an application-specific readback rather than calling that a successful byte-preserving upload.

`newSession` does not copy cookies, local/session storage or login state. For authenticated flows, supply a separately authorized deterministic login journey in the new context; no credential importing or auth bypass is provided. It demonstrates fresh-session visibility, not survival after a server restart, disk durability, backup health or multi-user access correctness. Demo data lives only in memory and is discarded when the server closes.

## Use with Claude Code

Place this repository's contents in `.claude/skills/customer-path-proof/` in your project and install dependencies in that directory. Ask Claude: “Use customer-path-proof to verify that submitting synthetic feedback on my local app really persists it. The authorized write is POST /api/feedback.” The runner also works without Claude.

## Scope and limits

- Designed for trusted local/staging applications and synthetic data. Browser routing reduces accidental scope expansion; it is not a security sandbox. Even GET requests can mutate poorly designed endpoints.
- Cross-origin HTTP requests, unapproved write methods, all HTTP redirects (including same-origin redirects), WebSockets, service workers, and popups are blocked. Use final URLs directly. A dependency blocked by scope yields a blocked result, not an app defect. Saved-state readback uses a separate HTTP client that application JavaScript cannot mock.
- No production testing, auth/CAPTCHA bypass, credential scraping, or automatic external publishing. No claim to discover all bugs.
- Query strings, headers, and response bodies are omitted from network event summaries. Screenshots, console text, expected values, and exception messages can still contain secrets or personal data. Review artifacts before sharing.
- UI plus independent readback is stronger than a toast alone, but only as meaningful as the endpoint and fixture you choose. It does not prove storage durability after a restart or correctness of other customer paths.

## Verification

```sh
npm test
```

Unit tests run by default; browser tests are explicitly skipped, not counted as passes. Run the full browser suite with:

```sh
npm run test:browser
```

The browser suite covers the original false-success, repaired write, denied write, fabricated browser readback, redirect protection, PNG evidence, no-overwrite behavior, session-only storage, corrupt upload and policy reapplication after a fresh session. `npm run demo` always requires a real browser. GitHub Actions installs Chromium, runs the full suite and all six demo cases, then saves evidence as an artifact. A green unit-only run does not establish browser behavior.

Each journey uses CLI exit `0` for passed, `1` for a failed assertion, `2` for blocked/incomplete/invalid invocation. The demo's exit code instead checks the expected broken/fixed matrix: expected failures count as successful bug detection. Reports are JSON plus readable HTML; the demo also emits `summary.json`. Inspect the result, never treat report-file creation alone as success.

Playwright already provides browser automation and traces; [Checkly](https://www.checklyhq.com/docs/detect/synthetic-monitoring/playwright-checks/overview/) provides production monitoring, and [Browser Use](https://github.com/browser-use/browser-use) provides AI browser agents. This project focuses on small, reviewable customer-outcome contracts and the gap between an apparent UI success and independently observable saved state. It builds on [Playwright](https://playwright.dev/docs/intro), rather than replacing it.

## License

MIT, see [LICENSE](LICENSE).

---

Built by Kamesh Jindal at OMX Digital (https://omxdigital.ai). Part of the OMX Claude Skills toolkit (https://github.com/OmxKamesh/claude-code-skills). Need this set up for your business? kamesh@omxdigital.ai
