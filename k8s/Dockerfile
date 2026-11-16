FROM docker.io/library/node:22-alpine

WORKDIR /app

COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node dist ./dist

ENV HOST=0.0.0.0 \
    PORT=5180 \
    NODE_ENV=production

USER node
EXPOSE 5180

CMD ["node", "server/start.mjs"]
