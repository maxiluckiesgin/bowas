SHELL := /bin/bash

.PHONY: start docker-build docker-up docker-down docker-logs
start:
	@source ./projectrc && node index.js

docker-build:
	@docker compose build

docker-up:
	@docker compose up -d

docker-down:
	@docker compose down

docker-logs:
	@docker compose logs -f bowas
