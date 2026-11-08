FROM node:22-bookworm-slim AS node
FROM python:3.12-slim-bookworm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=ghcr.io/astral-sh/uv:0.10.11 /uv /bin/uv
WORKDIR /app
COPY jcst_runtime/pyproject.toml jcst_runtime/uv.lock /runtime/
RUN uv sync --project /runtime --frozen --no-dev
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
COPY backend/package*.json ./
COPY backend/prisma ./prisma
COPY backend/prisma.config.js ./
RUN node /usr/local/lib/node_modules/npm/bin/npm-cli.js ci --include=dev && node node_modules/prisma/build/index.js generate
COPY backend/src ./src
COPY backend/openapi.yaml backend/research-openapi.yaml ./
COPY backend/scripts ./scripts
COPY ai_services /ai_services
COPY contracts /contracts
COPY scripts/demo-seed-plan.py /scripts/demo-seed-plan.py
ENV NODE_ENV=production JCST_PYTHON=/runtime/.venv/bin/python
ENV OPERATIONS_PYTHON=/runtime/.venv/bin/python
CMD ["node", "src/research/worker.js"]
