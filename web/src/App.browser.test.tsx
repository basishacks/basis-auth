// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { expect, it, vi, afterEach } from "vitest";
import { createElement } from "react";
import { App } from "./App";

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = "basis_bridge_error=; path=/oauth; max-age=0";
});

function mockFetch(respond: (url: string) => Response) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    return Promise.resolve(respond(url));
  }) as unknown as typeof fetch;
}

it("renders the loading state before the interaction resolves", () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
  const spy = vi.spyOn(document, "cookie", "get").mockReturnValue("");
  render(createElement(App));
  expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  spy.mockRestore();
});

it("renders a login prompt for an unauthenticated interaction", async () => {
  const interaction = JSON.stringify({
    uid: "uid-1",
    prompt: "login",
    client: { name: "Example App", id: "client-1" },
    scopes: ["openid"],
    resources: [],
    csrfToken: "token",
    microsoftConfigured: true,
  });
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/oauth/interaction")) {
      return Promise.resolve(new Response(interaction, { status: 200 }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }));
  const spy = vi.spyOn(document, "cookie", "get").mockReturnValue("");
  render(createElement(App));
  await vi.waitFor(() => {
    expect(screen.getByText(/Sign in to/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /microsoft/i })).toBeInTheDocument();
  });
  spy.mockRestore();
});

it("shows the upstream error card when a bridge error cookie exists", async () => {
  const payload = btoa(JSON.stringify({
    status: 403,
    error: "access_denied",
    code: 403,
    error_description: "This account is not allowed to sign in to this application.",
  }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
  const spy = vi.spyOn(document, "cookie", "get")
    .mockReturnValue(`basis_bridge_error=${encodeURIComponent(payload)}`);
  render(createElement(App));
  await vi.waitFor(() => {
    expect(screen.getByText(/Unable to Login/i)).toBeInTheDocument();
    expect(screen.getByText(/This account is not allowed/i)).toBeInTheDocument();
  });
  spy.mockRestore();
});
