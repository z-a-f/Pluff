# @murmu/web

Vite + React client shell for [Murmu](https://github.com/z-a-f/Murmu).

This package is private and is not published to npm. It is part of the Murmu
workspace and exists to run the browser client locally and in deployment.

## Role

The web app is a thin client around [`@murmu/client`](../../packages/client) and
[`@murmu/protocol`](../../packages/protocol). All private key material stays in
the browser; the app talks only to the untrusted relay over its HTTP API.

## Development

```sh
pnpm dev:web
```

This runs Vite bound to `0.0.0.0`, served at `http://localhost:5173/`. The app
defaults to a relay at `http://localhost:8787`, so start the relay in a separate
terminal:

```sh
pnpm dev:relay
```

## Scripts

```sh
pnpm --filter @murmu/web dev        # vite dev server
pnpm --filter @murmu/web build      # vite production build
pnpm --filter @murmu/web preview    # preview the production build
pnpm --filter @murmu/web test       # vitest
pnpm --filter @murmu/web typecheck
```

## License

Apache-2.0
