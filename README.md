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

`compose.yaml` publishes on `0.0.0.0:${TEXTIFY_FRONTEND_HOST_PORT:-4173}` and explicitly maps `host.docker.internal` to Docker's host gateway.

To deploy the frontend and backend together, run the root Compose application from their parent directory:

```sh
cd ..
docker compose --profile gpu up --build --detach --wait
```

The root Compose application configures this image with `TEXTIFY_API_UPSTREAM=http://api:8182` so Nginx reaches the API over the shared Docker network.

## Browser API boundary

Browsers always call the frontend origin's relative `/api` paths.
Nginx proxies those paths to the runtime `TEXTIFY_API_UPSTREAM` without rewriting them.
No browser CORS configuration or `VITE_*` backend variable is used.
The image refuses to start unless `TEXTIFY_API_UPSTREAM` is set to a credential-free absolute HTTP or HTTPS origin.

## Direct HTTP access

The packaged site supports direct HTTP access from LAN and private-IP origins, including the Compose port published on `0.0.0.0`.
The image does not send `Cross-Origin-Opener-Policy` because browsers ignore that policy on potentially untrustworthy HTTP origins.
An HTTPS deployment edge can add an opener policy if the deployment later requires cross-origin isolation.
