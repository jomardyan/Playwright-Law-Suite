SHELL := /bin/sh

NPM ?= npm
NPX ?= npx
URL ?=
CONFIG ?= config/profiles/eu-ecommerce.json
FORMAT ?= json,html,console
OUT ?= ./universcan-report
AUTOSCAN_CONFIG ?=
ARGS ?=

.PHONY: help install build typecheck test check browsers doctor scan autoscan cli clean

help:
	@printf '%s\n' \
		'make install    Install npm dependencies' \
		'make build      Compile TypeScript to dist/' \
		'make typecheck  Run TypeScript type checking' \
		'make test       Run the test suite' \
		'make check      Run typecheck, build, and tests' \
		'make browsers   Install Playwright Chromium and its dependencies' \
		'make doctor     Check the local UniVerscan environment' \
		'make scan URL=... [CONFIG=...] [FORMAT=...] [OUT=...]  Scan a live site' \
		'make autoscan URL=... [AUTOSCAN_CONFIG=...]  Detect scope, then scan a live site' \
		'make cli ARGS="..."  Run an arbitrary UniVerscan CLI command' \
		'make clean      Remove generated build and report output'

install:
	$(NPM) install

build:
	$(NPM) run build

typecheck:
	$(NPM) run typecheck

test:
	$(NPM) test

check: typecheck build test

browsers:
	$(NPX) playwright install --with-deps chromium

doctor: build
	$(NPM) run doctor

scan: build
	@test -n "$(URL)" || (printf '%s\n' 'URL is required. Example: make scan URL=https://example.com' >&2; exit 1)
	node dist/cli.js scan --url "$(URL)" --config "$(CONFIG)" --format "$(FORMAT)" --out "$(OUT)"

autoscan: build
	@test -n "$(URL)" || (printf '%s\n' 'URL is required. Example: make autoscan URL=https://example.com' >&2; exit 1)
	node dist/cli.js autoscan --url "$(URL)" $(if $(AUTOSCAN_CONFIG),--config "$(AUTOSCAN_CONFIG)") --format "$(FORMAT)" --out "$(OUT)"

cli: build
	@test -n "$(ARGS)" || (printf '%s\n' 'ARGS is required. Example: make cli ARGS="packs"' >&2; exit 1)
	node dist/cli.js $(ARGS)

clean:
	rm -rf dist universcan-report