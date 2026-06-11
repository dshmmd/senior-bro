.PHONY: install dev build start check typecheck smoke clean

install: ## install all workspace dependencies
	npm install

dev: ## run server :4747 + hot-reloading web :5173
	npm run dev

build: ## build web bundle + compile server
	npm run build

start: build ## run production app on http://localhost:4747
	npm start

typecheck: ## strict TS check on both workspaces
	npm run typecheck

smoke: ## boot built server and verify key endpoints
	npm run smoke

check: typecheck build smoke ## full verification gate (run before any commit)

clean: ## remove build artifacts and node_modules
	rm -rf node_modules server/node_modules web/node_modules server/dist web/dist

help: ## list targets
	@grep -E '^[a-z]+:.*##' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'
