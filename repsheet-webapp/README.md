# repsheet-webapp

The RepSheet web client: a mobile-first React app to log gym workouts block by block (single exercises, supersets and circuits), replay coach templates and follow each exercise's progression. It talks to the RepSheet API under `/api/v1`.

See the [root README](../README.md) for what RepSheet is and how to run the whole stack.

## Getting started

### Prerequisites

- Node.js at the version in [.nvmrc](.nvmrc), with npm
- The RepSheet API listening on `http://localhost:3100` (the dev server proxies `/api` to it)

### Installation

```sh
npm ci
```

### Usage

```sh
npm run dev
```

Then open the URL Vite prints (`http://localhost:5173` by default).

```sh
npm run build
```

builds the static site into `dist/`.

### Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `VITE_LOG_LEVEL` | no | `debug` in dev, `warn` in builds | Browser console verbosity: `debug`, `info`, `warn`, `error` or `silent` |
