FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
COPY contracts /contracts
COPY backend/examples /backend/examples
COPY backend/docs /backend/docs
ARG API_PROXY_URL=http://research_api:5000
ENV API_PROXY_URL=$API_PROXY_URL NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_RESEARCH_ENABLED=true
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev
# Next loads next.config.ts at runtime; include the exact build-time compiler
# rather than allowing it to download/install TypeScript when the server starts.
COPY --from=build /app/node_modules/typescript ./node_modules/typescript
COPY --from=build /app/public ./public
COPY --from=build /app/.next ./.next
COPY --from=build /app/next.config.ts ./next.config.ts
EXPOSE 3000
CMD ["npm", "start", "--", "--hostname", "0.0.0.0"]
