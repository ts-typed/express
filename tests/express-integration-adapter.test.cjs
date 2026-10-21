'use strict';

const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const { expressIntegrationAdapter, resolveProject, installGlobalStrictTypeErrorFilter } = require('../dist/express-integration-adapter');

function writeBootstrap(root, body) {
  const sourceRoot = join(root, 'src');
  mkdirSync(sourceRoot, { recursive: true });
  const mainPath = join(sourceRoot, 'main.ts');
  writeFileSync(mainPath, body);
  return mainPath;
}

test('the Express adapter exposes apiVersion 1, a name, and both hooks', () => {
  assert.equal(expressIntegrationAdapter.apiVersion, 1);
  assert.equal(expressIntegrationAdapter.name, 'express');
  assert.equal(expressIntegrationAdapter.resolveProject, resolveProject);
  assert.equal(expressIntegrationAdapter.installGlobalStrictTypeErrorFilter, installGlobalStrictTypeErrorFilter);
});

test('resolveProject passes projectRoot and configPath through unchanged', () => {
  assert.deepEqual(resolveProject({ projectRoot: '/demo' }), {
    apiVersion: 1,
    integration: 'express',
    projectRoot: '/demo',
  });
  assert.deepEqual(resolveProject({ projectRoot: '/demo', configPath: '/demo/tsconfig.json' }), {
    apiVersion: 1,
    integration: 'express',
    projectRoot: '/demo',
    configPath: '/demo/tsconfig.json',
  });
});

test('installGlobalStrictTypeErrorFilter inserts app.use(typedErrorHandler()) right before the single app.listen call', () => {
  const root = mkdtempSync(join(tmpdir(), 'ts-typed-express-adapter-'));
  const mainPath = writeBootstrap(
    root,
    [
      "import express from 'express';",
      "import { usersRouter } from './users.router';",
      '',
      'const app = express();',
      "app.use('/users', usersRouter);",
      'app.listen(3000);',
      '',
    ].join('\n'),
  );

  const result = installGlobalStrictTypeErrorFilter({ projectRoot: root });

  assert.equal(result.changed, true);
  const updated = readFileSync(mainPath, 'utf8');
  assert.match(updated, /import \{ typedErrorHandler \} from '@ts-typed\/express';/);
  assert.match(updated, /app\.use\(typedErrorHandler\(\)\);\napp\.listen\(3000\);/);
});

test('installGlobalStrictTypeErrorFilter is idempotent, including under an aliased import', () => {
  const root = mkdtempSync(join(tmpdir(), 'ts-typed-express-adapter-alias-'));
  writeBootstrap(
    root,
    [
      "import express from 'express';",
      "import { typedErrorHandler as handler } from '@ts-typed/express';",
      '',
      'const app = express();',
      'app.use(handler());',
      'app.listen(3000);',
      '',
    ].join('\n'),
  );

  const result = installGlobalStrictTypeErrorFilter({ projectRoot: root });

  assert.deepEqual(result, {
    changed: false,
    message: 'typedErrorHandler is already registered globally in src/main.ts.',
  });
});

test('installGlobalStrictTypeErrorFilter is idempotent under a plain (unaliased) import', () => {
  const root = mkdtempSync(join(tmpdir(), 'ts-typed-express-adapter-plain-'));
  const mainPath = writeBootstrap(
    root,
    [
      "import express from 'express';",
      "import { typedErrorHandler } from '@ts-typed/express';",
      '',
      'const app = express();',
      'app.use(typedErrorHandler());',
      'app.listen(3000);',
      '',
    ].join('\n'),
  );
  const before = readFileSync(mainPath, 'utf8');

  const result = installGlobalStrictTypeErrorFilter({ projectRoot: root });

  assert.equal(result.changed, false);
  assert.equal(readFileSync(mainPath, 'utf8'), before);
});

test('installGlobalStrictTypeErrorFilter inserts the handler under its aliased name and adds no second import', () => {
  const root = mkdtempSync(join(tmpdir(), 'ts-typed-express-adapter-alias-nouse-'));
  const mainPath = writeBootstrap(
    root,
    [
      "import express from 'express';",
      "import { typedErrorHandler as handler } from '@ts-typed/express';",
      '',
      'const app = express();',
      'app.listen(3000);',
      '',
    ].join('\n'),
  );

  const result = installGlobalStrictTypeErrorFilter({ projectRoot: root });

  assert.equal(result.changed, true);
  const updated = readFileSync(mainPath, 'utf8');
  assert.match(updated, /app\.use\(handler\(\)\);\napp\.listen\(3000\);/);
  assert.doesNotMatch(updated, /app\.use\(typedErrorHandler\(\)\)/);
  assert.equal((updated.match(/import \{ typedErrorHandler \}/g) ?? []).length, 0);
  assert.equal((updated.match(/from '@ts-typed\/express'/g) ?? []).length, 1);
  assert.match(updated, /import \{ typedErrorHandler as handler \} from '@ts-typed\/express';/);
});

test('installGlobalStrictTypeErrorFilter leaves the file untouched when there is no app.listen call', () => {
  const root = mkdtempSync(join(tmpdir(), 'ts-typed-express-adapter-none-'));
  const mainPath = writeBootstrap(root, "import express from 'express';\nexport const app = express();\n");
  const before = readFileSync(mainPath, 'utf8');

  const result = installGlobalStrictTypeErrorFilter({ projectRoot: root });

  assert.equal(result.changed, false);
  assert.equal(readFileSync(mainPath, 'utf8'), before);
});

test('installGlobalStrictTypeErrorFilter leaves the file untouched when there is more than one app.listen call', () => {
  const root = mkdtempSync(join(tmpdir(), 'ts-typed-express-adapter-ambiguous-'));
  const mainPath = writeBootstrap(
    root,
    [
      "import express from 'express';",
      '',
      'const app = express();',
      'if (process.env.TEST) {',
      '  app.listen(0);',
      '} else {',
      '  app.listen(3000);',
      '}',
      '',
    ].join('\n'),
  );
  const before = readFileSync(mainPath, 'utf8');

  const result = installGlobalStrictTypeErrorFilter({ projectRoot: root });

  assert.equal(result.changed, false);
  assert.equal(readFileSync(mainPath, 'utf8'), before);
});

test('installGlobalStrictTypeErrorFilter reports a clear message when the entry file does not exist', () => {
  const root = mkdtempSync(join(tmpdir(), 'ts-typed-express-adapter-missing-'));

  const result = installGlobalStrictTypeErrorFilter({ projectRoot: root });

  assert.equal(result.changed, false);
  assert.match(result.message, /Could not find/);
});

test('installGlobalStrictTypeErrorFilter reads the entry path from typets.config.json when present', () => {
  const root = mkdtempSync(join(tmpdir(), 'ts-typed-express-adapter-entry-'));
  writeFileSync(join(root, 'typets.config.json'), JSON.stringify({ entry: 'src/server.ts' }));
  const serverDir = join(root, 'src');
  mkdirSync(serverDir, { recursive: true });
  writeFileSync(join(serverDir, 'server.ts'), "import express from 'express';\nconst app = express();\napp.listen(3000);\n");

  const result = installGlobalStrictTypeErrorFilter({ projectRoot: root });

  assert.equal(result.changed, true);
  assert.match(result.message, /src\/server\.ts/);
  const updated = readFileSync(join(serverDir, 'server.ts'), 'utf8');
  assert.match(updated, /app\.use\(typedErrorHandler\(\)\);\napp\.listen\(3000\);/);
});

test('loading the package entry point does not load typescript; only the init-time filter does', () => {
  const root = mkdtempSync(join(tmpdir(), 'ts-typed-express-adapter-lazy-ts-'));
  writeBootstrap(root, "import express from 'express';\nconst app = express();\napp.listen(3000);\n");
  const script = `
    const Module = require('node:module');
    const originalLoad = Module._load;
    let typescriptLoads = 0;
    Module._load = function (request, ...rest) {
      if (request === 'typescript') typescriptLoads += 1;
      return originalLoad.call(this, request, ...rest);
    };
    require(${JSON.stringify(join(__dirname, '..', 'dist', 'index.js'))});
    const afterEntryLoad = typescriptLoads;
    require(${JSON.stringify(join(__dirname, '..', 'dist', 'express-integration-adapter.js'))})
      .installGlobalStrictTypeErrorFilter({ projectRoot: ${JSON.stringify(root)} });
    process.stdout.write(JSON.stringify({ afterEntryLoad, afterInstall: typescriptLoads }));
  `;

  const run = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const { afterEntryLoad, afterInstall } = JSON.parse(run.stdout);
  assert.equal(afterEntryLoad, 0, 'typescript must not be required when the package entry point loads');
  assert.equal(afterInstall, 1, 'typescript is required exactly once, when the init-time filter runs');
});

test('installGlobalStrictTypeErrorFilter leaves the file untouched when listen is called on a wrapper server, not the Express app', () => {
  const root = mkdtempSync(join(tmpdir(), 'ts-typed-express-adapter-wrapper-'));
  const mainPath = writeBootstrap(
    root,
    [
      "import express from 'express';",
      "import http from 'node:http';",
      '',
      'const app = express();',
      "app.get('/', (_req, res) => res.send('ok'));",
      'const server = http.createServer(app);',
      'server.listen(3000);',
      '',
    ].join('\n'),
  );
  const before = readFileSync(mainPath, 'utf8');

  const result = installGlobalStrictTypeErrorFilter({ projectRoot: root });

  assert.deepEqual(result, {
    changed: false,
    message: 'Could not identify a single app.listen(...) call in src/main.ts; no source file was modified.',
  });
  assert.equal(readFileSync(mainPath, 'utf8'), before);
});

test('installGlobalStrictTypeErrorFilter leaves the file untouched when app.listen is nested in a callback', () => {
  const root = mkdtempSync(join(tmpdir(), 'ts-typed-express-adapter-callback-'));
  const mainPath = writeBootstrap(
    root,
    [
      "import express from 'express';",
      '',
      'const app = express();',
      "app.get('/', (_req, res) => res.send('ok'));",
      'async function bootstrap(): Promise<void> {',
      '  await Promise.resolve();',
      '}',
      'bootstrap().then(() => app.listen(3000));',
      '',
    ].join('\n'),
  );
  const before = readFileSync(mainPath, 'utf8');

  const result = installGlobalStrictTypeErrorFilter({ projectRoot: root });

  assert.deepEqual(result, {
    changed: false,
    message: 'Could not identify a single app.listen(...) call in src/main.ts; no source file was modified.',
  });
  assert.equal(readFileSync(mainPath, 'utf8'), before);
});

test('installGlobalStrictTypeErrorFilter also recognizes a namespace-imported express factory', () => {
  const root = mkdtempSync(join(tmpdir(), 'ts-typed-express-adapter-namespace-'));
  const mainPath = writeBootstrap(
    root,
    [
      "import * as express from 'express';",
      '',
      'const app = express();',
      'app.listen(3000);',
      '',
    ].join('\n'),
  );

  const result = installGlobalStrictTypeErrorFilter({ projectRoot: root });

  assert.equal(result.changed, true);
  assert.match(readFileSync(mainPath, 'utf8'), /app\.use\(typedErrorHandler\(\)\);\napp\.listen\(3000\);/);
});
