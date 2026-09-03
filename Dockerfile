# Playwright's own image already carries Chromium and every system library it
# needs, which is the part that is painful to reproduce on a bare base image.
# The tag MUST match the resolved playwright version, not the caret range in
# package.json - a driver newer than the image's browser is the usual cause
# of a container that builds but cannot launch. Check with:
#   node -p "require('playwright/package.json').version"
# and keep this tag in step.
FROM mcr.microsoft.com/playwright:v1.62.1-jammy

WORKDIR /app

# Dependencies first, so a source change does not invalidate the install layer.
COPY package.json package-lock.json ./
# The browsers are already in the image; skip the download.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --omit=dev --ignore-scripts

COPY dist ./dist
COPY config ./config

# Run as a non-root user so Chromium keeps its sandbox. The Playwright image
# ships this account. Without it UniVerscan detects uid 0 and adds
# --no-sandbox, which works but gives up a real protection.
USER pwuser

ENV UNIVERSCAN_OUTPUT=/reports
VOLUME ["/reports"]

ENTRYPOINT ["node", "/app/dist/cli.js"]
CMD ["doctor"]
