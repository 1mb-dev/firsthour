# Contributing

1. Fork the repo and create a branch from `main`.
2. Run `make install` and `make setup` (activates the tracked git hooks).
3. Make your changes. Keep commits atomic — one concern per commit.
4. Run `make check` (lint + tests) and fix any issues.
5. Open a pull request.

Tests run against sanitized fixtures in `test/fixtures/`; CI never calls live sources. If a source changes shape, re-record with `make fixtures` and check the diff for authors, usernames or emails before committing.
