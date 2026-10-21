import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type * as ts from 'typescript';
import type {
  GlobalErrorFilterSetupResult,
  IntegrationAdapterV1,
  IntegrationContext,
  ProjectResolution,
} from '@ts-typed/core';

const API_VERSION = 1 as const;
const NAME = 'express';
const DEFAULT_ENTRY = 'src/main.ts';
const TYPETS_CONFIG_FILE = 'typets.config.json';

// Loaded on demand: the TypeScript compiler is needed only by the init-time
// filter, never by typedErrorHandler at request time.
let cachedTs: typeof import('typescript') | undefined;
function loadTypescript(): typeof import('typescript') {
  cachedTs ??= require('typescript') as typeof import('typescript');
  return cachedTs;
}

export function resolveProject(context: IntegrationContext): ProjectResolution {
  return {
    apiVersion: API_VERSION,
    integration: NAME,
    projectRoot: context.projectRoot,
    ...(context.configPath === undefined ? {} : { configPath: context.configPath }),
  };
}

/**
 * Adds the global error-handling middleware selected by `ts-typed init`. The
 * adapter modifies only a conventional Express bootstrap with exactly one
 * `<app>.listen(...)` call; an ambiguous file (none, or more than one) is
 * left untouched and receives an actionable result message instead, same
 * rule `@ts-typed/nestjs`'s adapter applies to `NestFactory.create`.
 */
export function installGlobalStrictTypeErrorFilter(
  context: IntegrationContext,
): GlobalErrorFilterSetupResult {
  const ts = loadTypescript();
  const entryPath = resolveEntryPath(context.projectRoot);
  if (!existsSync(entryPath)) {
    return {
      changed: false,
      message: `Could not find the Express bootstrap at ${relative(context.projectRoot, entryPath)}; global error handling was not registered.`,
    };
  }

  const source = readFileSync(entryPath, 'utf8');
  const sourceFile = ts.createSourceFile(entryPath, source, ts.ScriptTarget.Latest, true);
  const importedLocalName = handlerImportLocalName(sourceFile);
  if (importedLocalName !== undefined && hasUseHandlerCall(sourceFile, importedLocalName)) {
    return {
      changed: false,
      message: `typedErrorHandler is already registered globally in ${relative(context.projectRoot, entryPath)}.`,
    };
  }

  const listenCalls = findListenStatements(sourceFile);
  if (listenCalls.length !== 1) {
    return {
      changed: false,
      message: `Could not identify a single app.listen(...) call in ${relative(context.projectRoot, entryPath)}; no source file was modified.`,
    };
  }
  const [bootstrap] = listenCalls;

  const handlerName = importedLocalName ?? 'typedErrorHandler';
  const insertion = `${indentationBefore(source, bootstrap.statement.getStart(sourceFile))}${bootstrap.applicationName}.use(${handlerName}());\n`;
  let updated = `${source.slice(0, bootstrap.statement.getStart(sourceFile))}${insertion}${source.slice(bootstrap.statement.getStart(sourceFile))}`;

  if (importedLocalName === undefined) {
    const importEnd = lastImportEnd(sourceFile);
    const importStatement = importEnd === 0
      ? "import { typedErrorHandler } from '@ts-typed/express';\n"
      : "\nimport { typedErrorHandler } from '@ts-typed/express';\n";
    updated = `${updated.slice(0, importEnd)}${importStatement}${updated.slice(importEnd)}`;
  }

  writeFileSync(entryPath, updated, 'utf8');
  return {
    changed: true,
    message: `Registered the global error handler in ${relative(context.projectRoot, entryPath)}.`,
  };
}

function resolveEntryPath(projectRoot: string): string {
  return resolve(projectRoot, readEntryFromConfig(projectRoot) ?? DEFAULT_ENTRY);
}

function readEntryFromConfig(projectRoot: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(projectRoot, TYPETS_CONFIG_FILE), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) {
      return undefined;
    }
    const entry = (parsed as Record<string, unknown>).entry;
    return typeof entry === 'string' ? entry : undefined;
  } catch {
    return undefined;
  }
}

interface ExpressBootstrap {
  readonly applicationName: string;
  readonly statement: ts.Statement;
}

function findListenStatements(sourceFile: ts.SourceFile): ExpressBootstrap[] {
  const ts = loadTypescript();
  const factoryNames = expressFactoryLocalNames(sourceFile);
  const results: ExpressBootstrap[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'listen' &&
      ts.isIdentifier(node.expression.expression)
    ) {
      const applicationName = node.expression.expression.text;
      const statement = enclosingStatement(node);
      if (
        statement !== undefined &&
        isExpressApplication(sourceFile, applicationName, factoryNames) &&
        !isInsideFunctionBody(node)
      ) {
        results.push({ applicationName, statement });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return results;
}

/** Local names under which the `express` module's app factory is imported. */
function expressFactoryLocalNames(sourceFile: ts.SourceFile): Set<string> {
  const ts = loadTypescript();
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'express'
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (clause?.name !== undefined) {
      names.add(clause.name.text);
    }
    if (clause?.namedBindings !== undefined && ts.isNamespaceImport(clause.namedBindings)) {
      names.add(clause.namedBindings.name.text);
    }
  }
  return names;
}

/**
 * True only when `name` is a top-level `const/let/var` whose initializer is a
 * direct call to an Express factory, i.e. `const app = express();`.
 */
function isExpressApplication(
  sourceFile: ts.SourceFile,
  name: string,
  factoryNames: ReadonlySet<string>,
): boolean {
  const ts = loadTypescript();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) {
        continue;
      }
      const initializer = declaration.initializer;
      return (
        initializer !== undefined &&
        ts.isCallExpression(initializer) &&
        ts.isIdentifier(initializer.expression) &&
        factoryNames.has(initializer.expression.text)
      );
    }
  }
  return false;
}

/** Conservative scope check: a listen call nested in any function is ambiguous. */
function isInsideFunctionBody(node: ts.Node): boolean {
  const ts = loadTypescript();
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isFunctionLike(current)) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function enclosingStatement(node: ts.Node): ts.Statement | undefined {
  const ts = loadTypescript();
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined && !ts.isStatement(current)) {
    current = current.parent;
  }
  return current as ts.Statement | undefined;
}

function indentationBefore(source: string, position: number): string {
  const lineStart = source.lastIndexOf('\n', position - 1) + 1;
  const prefix = source.slice(lineStart, position);
  return /^[\t ]*$/.test(prefix) ? prefix : '';
}

function handlerImportLocalName(sourceFile: ts.SourceFile): string | undefined {
  const ts = loadTypescript();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    if (statement.moduleSpecifier.text !== '@ts-typed/express') {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) {
      continue;
    }
    const element = bindings.elements.find(
      (candidate) => (candidate.propertyName ?? candidate.name).text === 'typedErrorHandler',
    );
    if (element !== undefined) {
      return element.name.text;
    }
  }
  return undefined;
}

function hasUseHandlerCall(sourceFile: ts.SourceFile, localName: string): boolean {
  const ts = loadTypescript();
  let found = false;

  const visit = (node: ts.Node): void => {
    if (found) {
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'use' &&
      node.arguments.some(
        (argument) =>
          ts.isCallExpression(argument) &&
          ts.isIdentifier(argument.expression) &&
          argument.expression.text === localName,
      )
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

function lastImportEnd(sourceFile: ts.SourceFile): number {
  const ts = loadTypescript();
  let end = 0;
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      end = statement.end;
      continue;
    }
    break;
  }
  return end;
}

export const expressIntegrationAdapter: IntegrationAdapterV1 = {
  apiVersion: API_VERSION,
  name: NAME,
  resolveProject,
  installGlobalStrictTypeErrorFilter,
};

export default expressIntegrationAdapter;
