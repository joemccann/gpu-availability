FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

FROM base AS build-web
RUN npm run build:web

FROM node:22-alpine AS api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=base /app/package.json /app/package-lock.json ./
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/src ./src
COPY --from=base /app/server ./server
COPY --from=base /app/scripts ./scripts
COPY --from=base /app/data ./data
COPY --from=base /app/public ./public
EXPOSE 3001
CMD ["npm", "run", "start:api"]

FROM node:22-alpine AS web
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build-web /app/package.json /app/package-lock.json ./
COPY --from=build-web /app/node_modules ./node_modules
COPY --from=build-web /app/web ./web
COPY --from=build-web /app/public ./public
EXPOSE 3000
CMD ["npm", "run", "start:web"]
