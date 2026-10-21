import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import * as ts from 'typescript';
import type {
  GlobalErrorFilterSetupResult,
  IntegrationAdapterV1,
  IntegrationContext,
  ProjectResolution,
} from '@ts-typed/compiler';

const API_VERSION = 1 as const;
const NAME = 'express';
const DEFAULT_ENTRY = 'src/main.ts';
const TYPETS_CONFIG_FILE = 'typets.config.json';

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

  const insertion = `${indentationBefore(source, bootstrap.statement.getStart(sourceFile))}${bootstrap.applicationName}.use(typedErrorHandler());\n`;
  let updated = `${source.slice(0, bootstrap.statement.getStart(sourceFile))}${insertion}${source.slice(bootstrap.statement.getStart(sourceFile))}`;

  if (handlerImportLocalName(sourceFile) === undefined) {
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
  const results: ExpressBootstrap[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'listen' &&
      ts.isIdentifier(node.expression.expression)
    ) {
      const statement = enclosingStatement(node);
      if (statement !== undefined) {
        results.push({ applicationName: node.expression.expression.text, statement });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return results;
}

function enclosingStatement(node: ts.Node): ts.Statement | undefined {
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
