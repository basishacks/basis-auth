// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { App } from "./App";

it("renders the loading state", () => {
  render(<App />);
  expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
});
