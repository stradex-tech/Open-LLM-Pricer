FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
# better-sqlite3 requires native build tools on Alpine
RUN apk add --no-cache python3 make g++ su-exec && npm install --production

COPY server ./server
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Create an unprivileged user for runtime (we drop privileges in entrypoint).
RUN addgroup -S app && adduser -S -G app -h /app app && mkdir -p /app/data && chown -R app:app /app

ENV PORT=3000
EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["npm","start"]

