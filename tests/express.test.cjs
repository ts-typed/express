const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const test = require('node:test');
const {
  AggregateStrictTypeError,
  StrictTypeError,
} = require('@ts-typed/compiler');
const { typedErrorHandler } = require('../dist');

function typeError(overrides = {}) {
  return new StrictTypeError({
    code: 'TYPE_MISMATCH',
    contractKind: 'parameter',
    propertyPath: 'CreateUserDto.age',
    expected: 'number',
    received: 'string',
    operation: 'argument',
    ...overrides,
  });
}

test('maps a client-side StrictTypeError to a safe 400 response', async () => {
  const app = express();
  app.get('/users', () => {
    throw typeError();
  });
  app.use(typedErrorHandler());

  const response = await request(app).get('/users');

  assert.equal(response.status, 400);
  assert.deepEqual(response.body, {
    statusCode: 400,
    message: 'CreateUserDto.age expected number, received string',
    code: 'TYPE_MISMATCH',
    contractKind: 'parameter',
    propertyPath: 'CreateUserDto.age',
    expected: 'number',
    received: 'string',
    operation: 'argument',
  });
  assert.equal('stack' in response.body, false);
  assert.equal('value' in response.body, false);
});

test('maps server-side return violations to 500', async () => {
  const app = express();
  app.get('/users', () => {
    throw typeError({ contractKind: 'return', operation: 'return' });
  });
  app.use(typedErrorHandler());

  const response = await request(app).get('/users');

  assert.equal(response.status, 500);
  assert.equal(response.body.statusCode, 500);
});

test('preserves custom response status and message', async () => {
  const app = express();
  app.get('/users', () => {
    throw typeError({
      typeErrorResponseMessage: 'Idade inválida',
      typeErrorResponseStatus: 422,
    });
  });
  app.use(typedErrorHandler());

  const response = await request(app).get('/users');

  assert.equal(response.status, 422);
  assert.equal(response.body.message, 'Idade inválida');
});

test('serializes aggregate violations without raw values', async () => {
  const app = express();
  app.get('/users', () => {
    throw new AggregateStrictTypeError([
      typeError(),
      typeError({ propertyPath: 'CreateUserDto.name', expected: 'string', received: 'number' }),
    ]);
  });
  app.use(typedErrorHandler());

  const response = await request(app).get('/users');

  assert.equal(response.status, 400);
  assert.equal(response.body.errors.length, 2);
  assert.equal(response.body.errors[1].propertyPath, 'CreateUserDto.name');
  assert.equal('value' in response.body.errors[0], false);
});

test('delegates unrelated errors to the next Express handler', async () => {
  const app = express();
  app.get('/users', () => {
    throw new Error('database offline');
  });
  app.use(typedErrorHandler());
  app.use((error, _request, response, _next) => {
    response.status(503).json({ message: error.message });
  });

  const response = await request(app).get('/users');

  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { message: 'database offline' });
});

test('supports safe logging and response formatting hooks', async () => {
  const seen = [];
  const app = express();
  app.get('/users', () => {
    throw typeError();
  });
  app.use(typedErrorHandler({
    onError: (error, request) => seen.push({ path: request.path, propertyPath: error.propertyPath }),
    formatResponse: (body) => ({ ok: false, error: body }),
  }));

  const response = await request(app).get('/users');

  assert.deepEqual(seen, [{ path: '/users', propertyPath: 'CreateUserDto.age' }]);
  assert.equal(response.status, 400);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error.propertyPath, 'CreateUserDto.age');
});
