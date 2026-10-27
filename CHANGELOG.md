# Changelog

## 0.1.7

- Bumped the `@ts-typed/core` peer/dev dependency to `0.3.0`, to pick up
  `closeAggregateWindowOrThrow()` and array-of-DTOs parameter aggregation,
  and to avoid a dual-module-instance of `@ts-typed/core` from a stale pin.

## 0.1.6

- Bumped the `@ts-typed/core` peer/dev dependency to `0.2.0`. The previous
  published peer range (`>=0.1.36 <0.2`) was never republished when the
  peer dep was last updated in source, so `npm install` kept pulling an
  incompatible pair and risked a dual-module-instance of `@ts-typed/core`.

## 0.1.2

- Fixed: an `onError`/`formatResponse` hook that returned a rejected Promise
  crashed the process with an unhandled rejection, after the client had
  already received its response. Both hook calls are now awaited inside the
  same try/catch that already protected against a synchronous throw.
- Fixed: an async `formatResponse` was not awaited, so `res.json()` silently
  serialized the unresolved `Promise` itself (`{}`) instead of the hook's
  result.
- Fixed: `response.status().json(payload)` was outside every try/catch. A
  `formatResponse` result that `JSON.stringify` cannot serialize (a
  circular reference, a `BigInt`, …), or a `typeErrorResponseStatus`
  outside the 100-999 range, fell through to Express's default handler —
  which, outside production, responds with an HTML page containing the
  full stack trace. `resolveStatus()` now validates the status value, and
  the final write falls back to the always-safe, JSON-serializable body on
  any failure.
- Bumped the devDependency compiler pin to 0.1.35.

## 0.1.1

- Fixed: `typedErrorHandler()` crashed with `ERR_HTTP_HEADERS_SENT` when a
  route had already written a response (`res.status().send()`) before
  throwing. The handler now forwards the error to `next()` instead of trying
  to send a second response when `response.headersSent` is true.
- Fixed: an `onError`/`formatResponse` hook throwing lost the safe typed
  response entirely (the error fell through to the generic Express fallback
  handler). Hook calls are now wrapped so a failing hook cannot prevent the
  client from receiving the classified 400/500 body.

## 0.1.0

- Initial Express integration for `@ts-typed/compiler`.
- Added `typedErrorHandler()` and `toTypedErrorResponse()`.
- Added safe 400/500 mapping, aggregate error support, custom response hooks, tests and CI release workflow.
