# @ts-typed/express

Express integration for [`@ts-typed/compiler`](https://www.npmjs.com/package/@ts-typed/compiler). It converts runtime contract violations into safe HTTP responses without adding schemas or decorators to your application.

## Install

```bash
npm install @ts-typed/compiler @ts-typed/express
```

`express` remains your application's dependency. This package supports Express 4 and 5 on Node 18+.

## Automatic setup

`npx ts-typed init` detects an Express project through its `express` dependency. It offers to register `typedErrorHandler()` in the conventional bootstrap file, placing it right before the single `app.listen(...)` call. If that file does not contain exactly one such call, `init` leaves the file untouched, and you can register the middleware by hand as shown below.

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
import { StrictTypeError } from '@ts-typed/compiler';
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
