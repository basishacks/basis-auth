import { describe, expect, it } from "vitest";
import { oauthServiceInternals } from "./service.js";

const metadata = {
  name: "Portal",
  redirectUris: ["https://portal.example.test/callback"],
  public: false,
  scopes: ["openid"],
};

describe("stored client metadata", () => {
  it.each([
    ["RoLe.AdMiN", "role.ADMIN"],
    ["ROLE.GENERAL", "role.GENERAL"],
  ])("accepts the case-insensitive owner role %s", (role, expected) => {
    const parsed = oauthServiceInternals.parseMetadata({
      ...metadata,
      owners: [{ id: "c6ba1588-03bb-4c61-a4e1-3c7c82e919b5", role }],
    });

    expect(parsed.owners).toEqual([
      { id: "c6ba1588-03bb-4c61-a4e1-3c7c82e919b5", role: expected },
    ]);
  });

  it("rejects unsupported owner roles", () => {
    expect(() =>
      oauthServiceInternals.parseMetadata({
        ...metadata,
        owners: [{ id: "c6ba1588-03bb-4c61-a4e1-3c7c82e919b5", role: "role.OWNER" }],
      }),
    ).toThrow("Stored client metadata is invalid");
  });
});
