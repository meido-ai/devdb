FROM node:bullseye-slim

WORKDIR /app

COPY package*.json ./
COPY dist ./dist
COPY .env ./
RUN test -f ./.env || (echo ".env file not found in dist directory!" && exit 1)
COPY node_modules ./node_modules

EXPOSE $PORT
CMD ["node", "dist/app.js"]
