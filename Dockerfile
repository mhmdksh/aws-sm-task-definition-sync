FROM node:22-alpine

RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

WORKDIR /usr/src/app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev && \
    npm cache clean --force

COPY src/ ./src/

RUN chown -R appuser:appgroup /usr/src/app

USER appuser

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD pgrep -f "node src/index.js" || exit 1

CMD ["node", "src/index.js"]
