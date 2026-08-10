/**
 * src/test/setup.ts  (HRA-62)
 * Vitest global setup: registers @testing-library/jest-dom matchers (adds
 * toBeInTheDocument, toHaveTextContent, … and their type augmentation) and
 * auto-cleans the DOM between tests.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
