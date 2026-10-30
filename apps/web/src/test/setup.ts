import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// vitest runs with globals:false, so @testing-library/react cannot register its
// own auto-cleanup; unmount between files so renders never stack.
afterEach(cleanup);
