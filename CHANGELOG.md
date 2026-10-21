# Changelog

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
