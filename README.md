# firsthour

Fresh remote roles from Hacker News and the companies hiring there, while they are still new: https://firsthour.1mb.dev

The monthly "Ask HN: Who is hiring?" thread is a burst. Most remote postings land in its first day, and applying early matters. firsthour lists remote roles from the last seven days, grouped by age (first hour, last 24 hours, this week), and marks the ones that arrived since your last visit.

## Sources

- **HN thread:** top-level postings in the current "Who is hiring?" thread.
- **HN jobs:** job stories posted on Hacker News.
- **Boards:** the Ashby, Greenhouse and Lever job boards of companies that posted in the last three threads.

Thread postings need a `Company | Role | …` header. Every role must pass a remote gate and a deny list and be under seven days old. Titles and bodies are untrusted: the page renders text only, and every link is built from a validated id.

## How it runs

```
snapshots.yml (GitHub Actions, every 2h; hourly on days 1-5)
  builds boards.json + hn.json  ->  GitHub Pages (data only)

Cloudflare Worker (Workers Free)
  cron */15     Pages -> validate -> KV
  /api/posts    KV snapshots + live HN delta -> select -> cached 5 min, last good kept 24h
  /             static page (public/)
```

The scheduled job holds no Cloudflare credential; the Worker pulls. Two things break the pipeline silently:

- **GitHub Pages carries data only.** Deploying anything else there, or adding a custom domain, removes or redirects `boards.json` and `hn.json`, and the refresh cron fails.
- **GitHub disables scheduled workflows** on a public repository after 60 days without activity. The page then shows HN and Boards as stale; re-enable `snapshots.yml` from the Actions tab.

## Develop

Node 22.18+.

```bash
make install && make setup
make check      # type-check + tests
make mock       # Worker on fixture data; /__mock/<success|empty|partial|stale|down|error>
make dev        # Worker against live sources (seed the local KV with make snapshots)
node scripts/probe.mjs https://firsthour.1mb.dev   # live check of a running Worker
```

Tests run on recorded, anonymized fixtures; CI never calls live sources. The design language is in [docs/design.md](docs/design.md).

MIT licensed.
