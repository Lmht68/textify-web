FROM node:22.22.2-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.29-alpine

COPY nginx/textify.conf.template /etc/nginx/templates/textify.conf.template
COPY docker/textify-nginx-entrypoint.sh /usr/local/bin/textify-nginx-entrypoint
COPY --from=build /app/dist /usr/share/nginx/html

RUN rm /etc/nginx/conf.d/default.conf \
  && chmod 755 /usr/local/bin/textify-nginx-entrypoint

EXPOSE 80

ENTRYPOINT ["/usr/local/bin/textify-nginx-entrypoint"]
CMD ["nginx", "-g", "daemon off;"]
