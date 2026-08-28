import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSource, verifyObservations } from "./verify-styles.mjs";

const emptyLedger = { version: 1, exceptions: [] };

function categories(source) {
  return verifyObservations(analyzeSource(source), emptyLedger).failures.map(item => item.category);
}

test("rejects static JSX styles and literal component typography", () => {
  const result = categories(`export function Demo() { return <div style={{ marginTop: 8, fontSize: 12 }} />; }`);
  assert.deepEqual(result.sort(), ["literal-component-typography", "static-jsx-style"]);
});

test("rejects runtime-generated Tailwind tokens and arbitrary values", () => {
  const result = categories("export function Demo({ size }) { return <div className={`text-${size} w-[13px]`} />; }");
  assert.deepEqual(result.sort(), ["arbitrary-tailwind-value", "runtime-tailwind-class"]);
});

test("accepts complete conditional utility names", () => {
  const result = categories("export function Demo({ active }) { return <div className={`card ${active ? 'opacity-100' : 'opacity-50'}`} />; }");
  assert.deepEqual(result, []);
});

test("requires a stable, rationale-bearing exception with an exact count", () => {
  const observations = analyzeSource(`
    import type { CSSProperties } from "react";
    export function Demo({ color }) { return <div style={{ "--demo-color": color } as CSSProperties} />; }
  `);
  const [group] = verifyObservations(observations, emptyLedger).groups;
  const ledger = { version: 1, exceptions: [{
    file: group.file,
    symbol: group.symbol,
    category: group.category,
    element: group.element,
    attribute: group.attribute,
    properties: group.properties,
    count: 1,
    rationale: "The value is supplied at runtime through a named CSS custom-property hook.",
  }] };
  assert.deepEqual(verifyObservations(observations, ledger).failures, []);
  ledger.exceptions[0].count = 2;
  assert.match(verifyObservations(observations, ledger).failures[0].reason, /count/);
});

test("rejects stale ledger entries", () => {
  const ledger = { version: 1, exceptions: [{
    file: "src/Demo.tsx",
    symbol: "Demo",
    category: "custom-property-style",
    element: "div",
    attribute: "style",
    properties: ["--demo-color"],
    count: 1,
    rationale: "No longer used.",
  }] };
  assert.match(verifyObservations([], ledger).failures[0].reason, /stale/);
});

test("reports Recharts object props as visualization-library exceptions", () => {
  const observations = analyzeSource(`
    import { YAxis } from "recharts";
    export function Demo() { return <YAxis tick={{ fill: "var(--text-secondary)", fontSize: 9 }} />; }
  `);
  assert.equal(observations[0].category, "visualization-library");
  assert.deepEqual(observations[0].properties, ["fill", "fontSize"]);
});
