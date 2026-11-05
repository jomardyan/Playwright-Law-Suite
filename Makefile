# GNU Make needs one shell executable, not "/usr/bin/env bash".
ifeq ($(OS),Windows_NT)
BASH ?= $(subst \,/,$(or $(ProgramW6432),$(PROGRAMW6432),$(ProgramFiles),$(PROGRAMFILES)))/Git/bin/bash.exe
else
BASH ?= bash
endif
SHELL := $(BASH)
.DEFAULT_GOAL := help
.NOTPARALLEL:
NODE ?= node

NPM ?= npm
NPX ?= npx
URL ?=
CONFIG ?= config/profiles/eu-ecommerce.json
FORMAT ?= json,html,console
OUT ?= ./universcan-report
AUTOSCAN_CONFIG ?=
ARGS ?=

.PHONY: help install dev build lint typecheck test check package browsers doctor scan autoscan cli clean

help: ## Show commands without running a compliance scan
	@"$(NODE)" scripts/make-support.mjs help

install: ## Install locked npm dependencies
	"$(NPM)" ci

dev: ## Run the TypeScript CLI from source with ARGS
	"$(NPM)" run dev -- $(ARGS)

lint: typecheck ## Alias for full source/test type checking

package: build ## Compile and create a local npm archive without publishing
	"$(NPM)" pack --ignore-scripts

build: ## Compile TypeScript into dist
	"$(NPM)" run build

typecheck: ## Check source and test TypeScript
	"$(NPM)" run typecheck

test: ## Run Vitest suites
	"$(NPM)" test

check: typecheck build test ## Run type, compilation and test gates in order

browsers: ## Explicitly install Playwright Chromium/system prerequisites
	"$(NPX)" playwright install --with-deps chromium

doctor: build ## Compile and inspect the local scanner environment
	"$(NPM)" run doctor

scan: build ## Explicit live-site scan; URL is required
	@test -n "$(URL)" || (printf '%s\n' 'URL is required. Example: make scan URL=https://example.com' >&2; exit 1)
	"$(NODE)" dist/cli.js scan --url "$(URL)" --config "$(CONFIG)" --format "$(FORMAT)" --out "$(OUT)"

autoscan: build ## Explicit live-site scope detection and scan; URL is required
	@test -n "$(URL)" || (printf '%s\n' 'URL is required. Example: make autoscan URL=https://example.com' >&2; exit 1)
	"$(NODE)" dist/cli.js autoscan --url "$(URL)" $(if $(AUTOSCAN_CONFIG),--config "$(AUTOSCAN_CONFIG)") --format "$(FORMAT)" --out "$(OUT)"

cli: build ## Run an explicit scanner CLI command from ARGS
	@test -n "$(ARGS)" || (printf '%s\n' 'ARGS is required. Example: make cli ARGS="packs"' >&2; exit 1)
	"$(NODE)" dist/cli.js $(ARGS)

clean: ## Remove compiled/npm-package output; preserve scan reports
	"$(NODE)" scripts/make-support.mjs clean

.PHONY: security
security: ## Audit production npm dependencies
	"$(NPM)" audit --omit=dev --audit-level=moderate
