FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY bin/ ./bin/
COPY lib/ ./lib/
COPY mcp/ ./mcp/
ENV PORT=8000
EXPOSE 8000
CMD ["node", "mcp/http-server.mjs"]
