# Textify Web

## Production image

Prerequisites: Docker Engine, a running Textify API, and host port `8182` reachable from Docker.

Build the standalone frontend image:

```sh
docker build --tag textify-frontend .
```

Run it against the sibling API running on the host:

```sh
docker run --rm \
  --name textify-frontend \
  --add-host host.docker.internal:host-gateway \
  --env TEXTIFY_API_UPSTREAM=http://host.docker.internal:8182 \
  --publish 127.0.0.1:4173:80 \
  textify-frontend
```

Confirm the edge is ready:

```sh
curl --include http://127.0.0.1:4173/healthz
```

The response is `200` with body `ok`.

## Compose

Copy the documented defaults if needed, then start the frontend against the sibling API on host port `8182`:

```sh
cp .env.example .env
TEXTIFY_API_UPSTREAM=http://host.docker.internal:8182 docker compose up --build
```

`compose.yaml` publishes only to `127.0.0.1:${TEXTIFY_FRONTEND_HOST_PORT:-4173}` and explicitly maps `host.docker.internal` to Docker's host gateway.

For a future global Compose deployment where `frontend` and an `api` service share a Docker network, use the same image with:

```sh
TEXTIFY_API_UPSTREAM=http://api:8182 docker compose up --build
```

## Browser API boundary

Browsers always call the frontend origin's relative `/api` paths.
Nginx proxies those paths to the runtime `TEXTIFY_API_UPSTREAM` without rewriting them.
No browser CORS configuration or `VITE_*` backend variable is used.
The image refuses to start unless `TEXTIFY_API_UPSTREAM` is set to a credential-free absolute HTTP or HTTPS origin.
