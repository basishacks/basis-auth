// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { App } from "./App";

beforeEach(() => window.history.replaceState({}, "", "/"));

it("renders the starter page", () => {
  render(<App />);
  expect(screen.getByText("Identity starts here.")).toBeInTheDocument();
});

it("renders the not-found page for an unknown route", () => {
  window.history.replaceState({}, "", "/missing");
  render(<App />);
  expect(screen.getByText("Page not found")).toBeInTheDocument();
});
