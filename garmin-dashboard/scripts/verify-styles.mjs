import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const DEFAULT_ROOT = path.resolve(import.meta.dirname, "..");
const STYLE_ATTRIBUTES = new Set(["style"]);
const VISUALIZATION_STYLE_ATTRIBUTES = new Set([
  "activeBar",
  "activeDot",
  "contentStyle",
  "dot",
  "itemStyle",
  "label",
  "labelStyle",
  "tick",
  "wrapperStyle",
]);
const TYPOGRAPHY_PROPERTIES = new Set([
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontWeight",
  "letterSpacing",
  "lineHeight",
  "textTransform",
]);
const ARBITRARY_CLASS_RE = /(?:^|\s)(?:[\w-]+:)*-?[a-z][\w-]*-\[[^\]]+\]/g;

function normalizePath(value) {
  return value.split(path.sep).join("/");
}

function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(absolute);
    if (!entry.isFile() || !entry.name.endsWith(".tsx") || entry.name.endsWith(".test.tsx")) return [];
    return [absolute];
  });
}

function unwrapExpression(node) {
  let current = node;
  while (
    ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isParenthesizedExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isNonNullExpression(current)
  ) current = current.expression;
  return current;
}

function propertyName(node) {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  if (ts.isComputedPropertyName(node) && ts.isStringLiteral(node.expression)) return node.expression.text;
  return null;
}

function isStaticExpression(node) {
  const current = unwrapExpression(node);
  if (
    ts.isStringLiteral(current)
    || ts.isNoSubstitutionTemplateLiteral(current)
    || ts.isNumericLiteral(current)
    || current.kind === ts.SyntaxKind.TrueKeyword
    || current.kind === ts.SyntaxKind.FalseKeyword
    || current.kind === ts.SyntaxKind.NullKeyword
    || current.kind === ts.SyntaxKind.UndefinedKeyword
  ) return true;
  if (ts.isPrefixUnaryExpression(current)) return isStaticExpression(current.operand);
  if (ts.isArrayLiteralExpression(current)) return current.elements.every(isStaticExpression);
  if (ts.isObjectLiteralExpression(current)) {
    return current.properties.every(property => (
      ts.isPropertyAssignment(property) && isStaticExpression(property.initializer)
    ));
  }
  return false;
}

function collectObjectDetails(expression, variables, seen = new Set()) {
  if (!expression) return { found: false, properties: [], isStatic: false };
  const node = unwrapExpression(expression);

  if (ts.isIdentifier(node)) {
    if (node.text === "undefined") return { found: false, properties: [], isStatic: true };
    if (seen.has(node.text)) return { found: true, properties: [`identifier:${node.text}`], isStatic: false };
    const initializer = variables.get(node.text);
    if (!initializer) return { found: true, properties: [`identifier:${node.text}`], isStatic: false };
    return collectObjectDetails(initializer, variables, new Set([...seen, node.text]));
  }

  if (ts.isConditionalExpression(node)) {
    const yes = collectObjectDetails(node.whenTrue, variables, seen);
    const no = collectObjectDetails(node.whenFalse, variables, seen);
    return {
      found: yes.found || no.found,
      properties: [...new Set([...yes.properties, ...no.properties])].sort(),
      isStatic: yes.isStatic && (!no.found || no.isStatic),
    };
  }

  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    const left = collectObjectDetails(node.left, variables, seen);
    const right = collectObjectDetails(node.right, variables, seen);
    return {
      found: left.found || right.found,
      properties: [...new Set([...left.properties, ...right.properties])].sort(),
      isStatic: left.isStatic && (!right.found || right.isStatic),
    };
  }

  if (!ts.isObjectLiteralExpression(node)) return { found: false, properties: [], isStatic: false };

  const properties = [];
  let staticValues = true;
  for (const property of node.properties) {
    if (ts.isPropertyAssignment(property)) {
      properties.push(propertyName(property.name) ?? "computed-property");
      staticValues &&= isStaticExpression(property.initializer);
    } else if (ts.isShorthandPropertyAssignment(property)) {
      properties.push(property.name.text);
      staticValues = false;
    } else if (ts.isSpreadAssignment(property)) {
      properties.push("spread");
      staticValues = false;
    } else {
      properties.push("dynamic-property");
      staticValues = false;
    }
  }
  return { found: true, properties: [...new Set(properties)].sort(), isStatic: staticValues };
}

function enclosingSymbol(node) {
  for (let current = node; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    if (ts.isMethodDeclaration(current) && current.name) return propertyName(current.name) ?? "anonymous-method";
    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current))
      && ts.isVariableDeclaration(current.parent)
      && ts.isIdentifier(current.parent.name)
    ) return current.parent.name.text;
    if (ts.isFunctionExpression(current) && current.name) return current.name.text;
  }
  return "module";
}

function jsxElementName(attribute) {
  const attributes = attribute.parent;
  const opening = attributes.parent;
  return opening.tagName?.getText() ?? "unknown";
}

function expressionFromAttribute(attribute) {
  const initializer = attribute.initializer;
  if (!initializer) return null;
  if (ts.isStringLiteral(initializer)) return initializer;
  if (ts.isJsxExpression(initializer)) return initializer.expression ?? null;
  return null;
}

function importedVisualizationNames(sourceFile) {
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== "recharts") continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) names.add(element.name.text);
    }
  }
  return names;
}

function sourceVariables(sourceFile) {
  const variables = new Map();
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      variables.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return variables;
}

function addObservation(observations, sourceFile, file, node, details) {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  observations.push({
    file,
    line: line + 1,
    symbol: enclosingSymbol(node),
    ...details,
  });
}

function textFragments(expression) {
  if (!expression) return [];
  const node = unwrapExpression(expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map(span => span.literal.text)];
  if (ts.isConditionalExpression(node)) return [...textFragments(node.whenTrue), ...textFragments(node.whenFalse)];
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return [...textFragments(node.left), ...textFragments(node.right)];
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(textFragments);
  if (ts.isCallExpression(node)) return node.arguments.flatMap(textFragments);
  return [];
}

function hasRuntimeTailwindToken(expression) {
  if (!expression) return false;
  const node = unwrapExpression(expression);
  if (ts.isTemplateExpression(node)) {
    let left = node.head.text;
    for (const span of node.templateSpans) {
      const right = span.literal.text;
      const alternatives = textFragments(span.expression).filter(Boolean);
      const hasUnknownValue = alternatives.length === 0;
      const safelyStartsToken = alternatives.length > 0 && alternatives.every(value => /^\s/.test(value));
      const safelyEndsToken = alternatives.length > 0 && alternatives.every(value => /\s$/.test(value));
      if (left && !/\s$/.test(left) && hasUnknownValue && /[-:]$/.test(left)) return true;
      if (left && !/\s$/.test(left) && !hasUnknownValue && !safelyStartsToken) return true;
      if (right && !/^\s/.test(right) && (hasUnknownValue || !safelyEndsToken)) return true;
      left = right;
    }
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const leftText = textFragments(node.left).join("");
    const rightText = textFragments(node.right).join("");
    const leftDynamic = textFragments(node.left).length === 0;
    const rightDynamic = textFragments(node.right).length === 0;
    if (leftDynamic && rightText && !/^\s/.test(rightText)) return true;
    if (rightDynamic && leftText && !/\s$/.test(leftText)) return true;
  }
  let found = false;
  ts.forEachChild(node, child => { found ||= hasRuntimeTailwindToken(child); });
  return found;
}

export function analyzeSource(sourceText, file = "fixture.tsx") {
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const variables = sourceVariables(sourceFile);
  const visualizationNames = importedVisualizationNames(sourceFile);
  const observations = [];

  const visit = node => {
    if (ts.isJsxAttribute(node)) {
      const attribute = node.name.getText(sourceFile);
      const expression = expressionFromAttribute(node);
      const element = jsxElementName(node);

      if (attribute === "className") {
        for (const fragment of textFragments(expression)) {
          const matches = fragment.match(ARBITRARY_CLASS_RE) ?? [];
          for (const match of matches) {
            addObservation(observations, sourceFile, file, node, {
              category: "arbitrary-tailwind-value",
              attribute,
              element,
              properties: [match.trim()],
            });
          }
        }
        if (hasRuntimeTailwindToken(expression)) {
          addObservation(observations, sourceFile, file, node, {
            category: "runtime-tailwind-class",
            attribute,
            element,
            properties: ["dynamic-token"],
          });
        }
      }

      const visualization = visualizationNames.has(element) && VISUALIZATION_STYLE_ATTRIBUTES.has(attribute);
      if (STYLE_ATTRIBUTES.has(attribute) || visualization) {
        const details = collectObjectDetails(expression, variables);
        if (details.found) {
          const category = visualization
            ? "visualization-library"
            : details.properties.length > 0 && details.properties.every(name => name.startsWith("--"))
              ? "custom-property-style"
              : details.isStatic ? "static-jsx-style" : "runtime-jsx-style";
          addObservation(observations, sourceFile, file, node, {
            category,
            attribute,
            element,
            properties: details.properties,
          });

          if (!visualization && details.properties.some(name => TYPOGRAPHY_PROPERTIES.has(name))) {
            addObservation(observations, sourceFile, file, node, {
              category: "literal-component-typography",
              attribute,
              element,
              properties: details.properties.filter(name => TYPOGRAPHY_PROPERTIES.has(name)),
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return observations;
}

function observationKey(item) {
  return JSON.stringify({
    file: item.file,
    symbol: item.symbol,
    category: item.category,
    element: item.element,
    attribute: item.attribute,
    properties: item.properties,
  });
}

function groupObservations(observations) {
  const groups = new Map();
  for (const observation of observations) {
    const key = observationKey(observation);
    const current = groups.get(key) ?? { ...observation, lines: [], count: 0 };
    current.lines.push(observation.line);
    current.count += 1;
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => observationKey(a).localeCompare(observationKey(b)));
}

export function verifyObservations(observations, ledger) {
  const groups = groupObservations(observations);
  const ledgerEntries = ledger.exceptions ?? [];
  const ledgerKeys = new Map(ledgerEntries.map(entry => [observationKey(entry), entry]));
  const hardFailureCategories = new Set([
    "arbitrary-tailwind-value",
    "literal-component-typography",
    "runtime-tailwind-class",
    "static-jsx-style",
  ]);
  const failures = [];
  const matched = new Set();

  for (const group of groups) {
    const key = observationKey(group);
    const exception = ledgerKeys.get(key);
    if (exception) matched.add(key);
    if (hardFailureCategories.has(group.category)) {
      failures.push({ ...group, reason: "forbidden styling pattern" });
    } else if (!exception) {
      failures.push({ ...group, reason: "missing exception-ledger entry" });
    } else if (!exception.rationale?.trim()) {
      failures.push({ ...group, reason: "exception has no rationale" });
    } else if (exception.count !== group.count) {
      failures.push({ ...group, reason: `exception count ${exception.count} does not match observed ${group.count}` });
    }
  }

  for (const entry of ledgerEntries) {
    const key = observationKey(entry);
    if (!matched.has(key)) failures.push({ ...entry, lines: [], reason: "stale exception-ledger entry" });
  }
  return { groups, failures };
}

function formatGroup(group) {
  const location = group.lines?.length ? ` lines ${group.lines.join(",")}` : "";
  return `${group.category.padEnd(28)} ${group.file}#${group.symbol} <${group.element}> ${group.attribute} [${group.properties.join(", ")}] x${group.count}${location}`;
}

export function scanRepository(root = DEFAULT_ROOT) {
  const sourceRoot = path.join(root, "src");
  const observations = walkFiles(sourceRoot).flatMap(absolute => {
    const file = normalizePath(path.relative(root, absolute));
    return analyzeSource(fs.readFileSync(absolute, "utf8"), file);
  });
  return groupObservations(observations);
}

export function run({ root = DEFAULT_ROOT, ledgerPath = path.join(root, "scripts", "style-exceptions.json") } = {}) {
  const groups = scanRepository(root);
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  const observations = groups.flatMap(group => Array.from({ length: group.count }, () => group));
  const { failures } = verifyObservations(observations, ledger);

  console.log("=== STYLE INVARIANT REPORT ===");
  for (const category of ["static-jsx-style", "runtime-jsx-style", "custom-property-style", "visualization-library", "arbitrary-tailwind-value", "runtime-tailwind-class", "literal-component-typography"]) {
    const matches = groups.filter(group => group.category === category);
    const count = matches.reduce((sum, group) => sum + group.count, 0);
    console.log(`${category}: ${count}`);
    for (const match of matches) console.log(`  ${formatGroup(match)}`);
  }
  console.log(`Exception ledger: ${(ledger.exceptions ?? []).length} stable entries`);

  if (failures.length > 0) {
    console.error("\nSTYLE INVARIANT FAILED");
    for (const failure of failures) console.error(`  ${formatGroup(failure)} — ${failure.reason}`);
    return 1;
  }
  console.log("STYLE INVARIANT PASSED: zero unjustified static styles; every direct exception is accounted for.");
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) process.exitCode = run();
