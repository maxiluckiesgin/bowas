SHELL := /bin/bash

.PHONY: start docker-build docker-up docker-down docker-logs frontend-install frontend-dev
start:
	@source ./projectrc && node index.js

docker-build:
	@docker compose build

docker-up:
	@docker compose up -d
	@echo "Waiting for bowas startup log..."
	@timeout=120; elapsed=0; \
	until docker compose logs --no-color bowas 2>&1 | grep -Fq "REST API listening on http://0.0.0.0:3000"; do \
		sleep 2; \
		elapsed=$$((elapsed + 2)); \
		if [ $$elapsed -ge $$timeout ]; then \
			echo "Timed out waiting for startup log after $$timeout seconds"; \
			docker compose logs --no-color --tail=100 bowas; \
			exit 1; \
		fi; \
	done
	@echo "bowas is ready"

docker-down:
	@docker compose down

docker-logs:
	@docker compose logs -f bowas

frontend-install:
	@cd frontend && npm install

frontend-dev:
	@cd frontend && npm run dev

.PHONY: sync-personal-api
OPENAPI_JSON ?= ./openapi.json
TARGET_DIR ?=

sync-personal-api:
	@set -a; [ -f ./.env ] && . ./.env; set +a; \
	OPENAPI_JSON_VAL="$(OPENAPI_JSON)"; \
	TARGET_DIR_VAL="$(TARGET_DIR)"; \
	if [ -z "$$OPENAPI_JSON_VAL" ]; then OPENAPI_JSON_VAL="$$OPENAPI_JSON"; fi; \
	if [ -z "$$OPENAPI_JSON_VAL" ]; then OPENAPI_JSON_VAL="./openapi.json"; fi; \
	if [ -z "$$TARGET_DIR_VAL" ]; then TARGET_DIR_VAL="$$TARGET_DIR"; fi; \
	test -n "$$TARGET_DIR_VAL" || (echo "TARGET_DIR is required (set in .env or pass TARGET_DIR=...)" && exit 1); \
	python3 ./scripts/sync_personal_bowas_api.py --openapi-json "$$OPENAPI_JSON_VAL" --target-dir "$$TARGET_DIR_VAL"
