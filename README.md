<p align="center">
  <a href="https://ts-typed.com" target="_blank" rel="noopener noreferrer">
    <img src=".github/logo.svg" alt="ts-typed" width="260" />
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@ts-typed/express"><img src="https://img.shields.io/npm/v/@ts-typed/express.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@ts-typed/express"><img src="https://img.shields.io/npm/dm/@ts-typed/express.svg" alt="npm downloads"></a>
  <a href="https://github.com/ts-typed/express/actions/workflows/ci.yml"><img src="https://github.com/ts-typed/express/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white" alt="Node >=18">
  <a href="https://github.com/ts-typed/express/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="License"></a>
</p>

# @ts-typed/express

Express integration for [`@ts-typed/core`](https://www.npmjs.com/package/@ts-typed/core). It converts runtime contract violations into safe HTTP responses without adding schemas or decorators to your application.

## Install

```bash
npm install @ts-typed/core @ts-typed/express
```

`express` remains your application's dependency. This package supports Express 4 and 5 on Node 18+.

## Automatic setup

`npx ts-typed init` detects an Express project through its `express` dependency. It offers to register `typedErrorHandler()` in the conventional bootstrap file, placing it right before the app's `.listen(...)` call. That call must be the single, top-level `.listen(...)` invoked directly on an app created by `express()` in that file; if `init` cannot identify exactly one such call, it leaves the file untouched, and you can register the middleware by hand as shown below.

## Register the middleware

Register `typedErrorHandler()` after your routes and before any fallback error handler:

```ts
import express from 'express';
import { typedErrorHandler } from '@ts-typed/express';
import { usersRouter } from './users.router';

const app = express();

app.use(express.json());
app.use('/users', usersRouter);

// Must be after routes: Express only enters error middleware after next(error)
// or a thrown error reaches the end of the route chain.
app.use(typedErrorHandler());

app.listen(3000);
```

The compiler instruments the TypeScript contract. The Express package only adapts the resulting `StrictTypeError` to HTTP; it does not replace Express routing, body parsing, or application validation.

## What the response looks like

Given a runtime violation such as a string received where a number was declared:

```json
{
  "statusCode": 400,
  "message": "CreateUserDto.age expected number, received string",
  "code": "TYPE_MISMATCH",
  "contractKind": "parameter",
  "propertyPath": "CreateUserDto.age",
  "expected": "number",
  "received": "string",
  "operation": "argument"
}
```

The response contains safe diagnostic metadata only. It never includes the rejected raw value or a stack trace.

## Status mapping

- `400` is used for client-facing parameter and DTO violations.
- `500` is used for `return`/`resolve` violations, server variables, and fields marked with `ServerPopulated()`.
- A `TypeErrorResponse()` status takes precedence when the field explicitly defines one.
- `AggregateStrictTypeError` includes its safe `errors` list in the same response.
- Errors unrelated to ts-typed are passed to the next Express error handler.

## Custom hooks

Use `onError` for safe logging and `formatResponse` when your API has a response envelope:

```ts
app.use(typedErrorHandler({
  onError(error, request) {
    logger.warn({ path: request.path, propertyPath: error.propertyPath });
  },
  formatResponse(body) {
    return { ok: false, error: body };
  },
}));
```

The formatter receives the already-sanitized body. The raw received value is never exposed by this package.

## Manual conversion

For applications that need to handle the error themselves, use `toTypedErrorResponse()`:

```ts
import { StrictTypeError } from '@ts-typed/core';
import { toTypedErrorResponse } from '@ts-typed/express';

try {
  await service.execute();
} catch (error) {
  if (error instanceof StrictTypeError) {
    return response.status(toTypedErrorResponse(error).statusCode).json(toTypedErrorResponse(error));
  }
  throw error;
}
```

## Development

```bash
npm install
npm run typecheck
npm test
npm pack --dry-run
```

The `main` branch publishes automatically after CI passes when the repository has an `NPM_TOKEN` secret configured.

## License

Apache-2.0
