FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node src/share-protocol.cjs ./src/share-protocol.cjs
COPY --chown=node:node cloud/server.cjs ./cloud/server.cjs
COPY --chown=node:node cloud/public ./cloud/public
USER node
ENV HOST=0.0.0.0 PORT=8787 STATE_FILE=/app/data/state.json
EXPOSE 8787
CMD ["node", "cloud/server.cjs"]
