FROM docker.io/library/node:22-alpine
WORKDIR /app
# 服务端零 npm 依赖，无需 npm install；只带 dist + server + package.json
COPY package.json ./
COPY server ./server
COPY dist ./dist
ENV HOST=0.0.0.0 \
    PORT=5180 \
    NODE_ENV=production
EXPOSE 5180
CMD ["node", "server/start.mjs"]
