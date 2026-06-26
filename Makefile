.PHONY: install dev build start check typecheck lint format smoke e2e clean db-up db-down db-reset db-generate db-migrate

install: ## install all workspace dependencies
	npm install

db-up: ## start the Postgres container and wait until it's healthy
	docker compose up -d db
	@printf 'waiting for postgres'; \
	for i in $$(seq 1 30); do \
	  s=$$(docker inspect -f '{{.State.Health.Status}}' senior-bro-db 2>/dev/null); \
	  if [ "$$s" = "healthy" ]; then echo ' ✓'; exit 0; fi; \
	  printf '.'; sleep 1; \
	done; echo ' ✗ postgres did not become healthy'; exit 1

db-down: ## stop the Postgres container (keeps the data volume)
	docker compose down

db-reset: ## stop Postgres and DROP its data volume (fresh DB)
	docker compose down -v

db-generate: ## generate a new Drizzle migration from src/schema.ts
	cd server && npx drizzle-kit generate

db-migrate: db-up ## apply pending Drizzle migrations to the running DB
	cd server && npx drizzle-kit migrate

dev: db-up ## run server :4747 + hot-reloading web :5173 (starts Postgres first)
	npm run dev

build: ## build web bundle + compile server
	npm run build

start: build db-up ## run production app on http://localhost:4747
	npm start

typecheck: ## strict TS check on both workspaces
	npm run typecheck

lint: ## eslint (strict, type-checked) + prettier check
	npm run lint && npm run format:check

format: ## auto-format the codebase
	npm run format

smoke: db-up ## boot built server (needs Postgres) and verify key endpoints
	npm run smoke

test: ## red-team guardrail unit tests (needs a prior build)
	npm run test:guardrail

e2e: db-up ## playwright happy-path against the built app (mock provider, isolated test DB)
	npm run e2e

check: lint typecheck build test smoke ## full verification gate (run before any commit; needs Docker)

clean: ## remove build artifacts and node_modules
	rm -rf node_modules server/node_modules web/node_modules server/dist web/dist

help: ## list targets
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'
