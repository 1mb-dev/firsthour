.PHONY: dev mock install lint test test-watch check types fixtures snapshots audit clean help setup

# Development
dev:                ## Start the Worker locally (wrangler dev)
	npm run dev

mock:               ## Start the Worker on fixture data; /__mock/<state> switches state
	npm run mock

install:            ## Install dependencies
	npm ci

types:              ## Regenerate worker-configuration.d.ts after editing wrangler.jsonc
	npm run types

# Quality
lint:               ## Type-check with tsc
	npm run lint

test:               ## Run tests once
	npm run test

test-watch:         ## Run tests in watch mode
	npm run test:watch

check:              ## Lint + test (CI gate)
	npm run check

audit:              ## Dependency audit (production only)
	npm run audit:deps

# Live sources (manual only; CI never calls them)
fixtures:           ## Re-record anonymized fixtures from live sources
	node scripts/probe.mjs fixtures

SNAPSHOTS := .wrangler/snapshots
snapshots:          ## Build the boards snapshot and hn baseline live, load them into the local KV
	@rm -rf $(SNAPSHOTS)
	@node scripts/snapshots.ts $(SNAPSHOTS); status=$$?; \
	for key in boards hn; do \
	  if [ -f $(SNAPSHOTS)/$$key.json ]; then \
	    npx wrangler kv key put --local --binding SNAPSHOTS $$key:latest --path $(SNAPSHOTS)/$$key.json || status=1; \
	  fi; \
	done; exit $$status

clean:              ## Remove local Worker state
	rm -rf .wrangler

# Help
help:               ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-16s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help

.PHONY: setup
setup: ## Bootstrap repo: install git hooks
	@scripts/setup.sh
