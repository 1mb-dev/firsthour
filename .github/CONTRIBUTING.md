# Contributing

1. Fork the repo and create a branch from `main`.
2. Run `make install` and `make setup` (activates the tracked git hooks).
3. Make your changes. Keep commits atomic — one concern per commit.
4. Run `make check` (lint + tests) and fix any issues.
5. Open a pull request.

Tests run against fixtures in `test/fixtures/`; CI never calls live sources. If a source changes shape, re-record with `make fixtures`: `scripts/anonymize.mjs` keeps the real response shapes and replaces the content, and `test/fixtures.test.ts` fails on any real link, slug or email that gets through.

Report security issues through GitHub Security Advisories, not public issues (1mb-dev policy).
