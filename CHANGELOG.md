# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- CI also runs on main daily and on manual dispatch, and tests Node 22 and 24

## [0.1.0] - 2026-10-11

First release, live at https://firsthour.1mb.dev.

### Added

- Sources: the HN "Who is hiring?" thread, HN job stories, and the Ashby, Greenhouse and Lever boards of companies that posted in the last three threads.
- Selection: posting shape, deny list, remote gate, seven-day window, newest first.
- Board roles that ATS data marks remote but list by city read `Remote (New York)`.
- Page: groups by age (first hour, last 24 hours, this week), a filter mirrored in `?q=`, new-since-last-visit ticks, dimmed rows once read, auto/light/dark theme, and the expected time of the next thread. Job links open in a new tab.
- Logbook design language with a self-hosted font and one token block; see `docs/design.md`.
- Scheduled job (every 2 hours, hourly on days 1-5) that publishes the boards snapshot and the HN baseline to GitHub Pages; a Worker cron copies them into KV every 15 minutes.
- `/api/posts` cached for 5 minutes with a 24-hour last-good fallback, and an HN path that serves the baseline plus postings since its watermark.
- A strict CSP (same-origin only, plus a per-response nonce for the scripts Cloudflare injects).
- Deploy by workflow with a check that the active Worker deployment is this commit; `scripts/probe.mjs` for live checks.

[Unreleased]: https://github.com/1mb-dev/firsthour/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/1mb-dev/firsthour/releases/tag/v0.1.0
