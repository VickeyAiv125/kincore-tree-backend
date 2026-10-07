FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=5000
ENV NODE_ENV=production
EXPOSE 5000
CMD ["node", "index.js"]
