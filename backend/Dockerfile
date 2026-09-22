FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./
COPY backend/prisma ./prisma
COPY backend/prisma.config.js ./
RUN npm ci

COPY backend/scripts ./scripts
# Required explicitly: omission from the build context must fail the build.
COPY backend/scripts/validate-operations.py ./scripts/validate-operations.py
COPY backend/src ./src
COPY backend/openapi.yaml ./openapi.yaml
COPY ai_services /ai_services
COPY contracts /contracts
COPY scripts/demo-seed-plan.py /scripts/demo-seed-plan.py

RUN python3 -m venv .venv-operations \
  && .venv-operations/bin/pip install --no-cache-dir -r scripts/requirements-operations.txt

# Exercise the packaged Python runtime and canonical bridge without a database.
RUN .venv-operations/bin/python -c "import sys; sys.path.insert(0, '/ai_services'); import domain.operations.validator" \
  && node -e "const c = require('./src/services/operations-contract.service'); c.loadCanonicalSeedPlan().then(plan => c.validatePayload(plan, 'seed')).then(() => console.log('Operations validator smoke check passed')).catch(error => { console.error(error.message); process.exit(1); })"

ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

CMD ["node", "src/server.js"]
