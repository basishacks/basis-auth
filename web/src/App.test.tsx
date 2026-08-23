// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { App } from "./App";

it("renders the loading state", () => {
  // jsdom cannot resolve relative URLs, so the startup fetch is stubbed out.
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })),
  );
  const documentCookieGetter = vi.spyOn(document, "cookie", "get").mockReturnValue("");
  render(<App />);
  expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  documentCookieGetter.mockRestore();
  vi.unstubAllGlobals();
});
