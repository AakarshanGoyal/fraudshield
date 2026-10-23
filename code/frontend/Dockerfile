# Build the Vite app, then serve the static files with nginx.
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# The browser calls the backend directly, so this is the address as seen from the user's browser.
# No default: docker-compose.yml passes it; a build without it fails instead of guessing.
ARG VITE_API_URL
RUN test -n "$VITE_API_URL" || (echo "VITE_API_URL build arg is required" && exit 1)
# Never ship the in-browser mock backend in an image.
ENV VITE_API_URL=$VITE_API_URL VITE_USE_MOCKS=false
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
