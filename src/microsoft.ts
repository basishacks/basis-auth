import { and, eq, gt } from "drizzle-orm";
import * as client from "openid-client";
import type { AppConfig } from "./config.js";
import type { Database } from "./database/client.js";
import { upstreamAuthRequests } from "./database/schema.js";
import type { IdentityService } from "./identity.js";

export function createMicrosoftService(
  appConfig: AppConfig,
  db: Database,
  identity: IdentityService,
) {
  let discovered: Promise<client.Configuration> | undefined;

  function microsoftConfig() {
    if (!appConfig.microsoft) throw new Error("Microsoft login is not configured");
    discovered ??= client.discovery(
      new URL(appConfig.microsoft.issuer),
      appConfig.microsoft.clientId,
      appConfig.microsoft.clientSecret,
    );
    return discovered;
  }

  async function begin(authorizationRequestId: string) {
    const configuration = await microsoftConfig();
    const state = client.randomState();
    const nonce = client.randomNonce();
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
    await db.insert(upstreamAuthRequests).values({
      state,
      authorizationRequestId,
      codeVerifier,
      nonce,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    return client.buildAuthorizationUrl(configuration, {
      redirect_uri: `${appConfig.issuer}/oauth/callback/microsoft`,
      scope: "openid profile email",
      response_type: "code",
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
  }

  async function callback(currentUrl: URL) {
    const state = currentUrl.searchParams.get("state");
    if (!state) throw new Error("Microsoft callback is missing state");
    const [request] = await db
      .delete(upstreamAuthRequests)
      .where(
        and(
          eq(upstreamAuthRequests.state, state),
          gt(upstreamAuthRequests.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!request) throw new Error("Microsoft login request is invalid or expired");

    const configuration = await microsoftConfig();
    const tokens = await client.authorizationCodeGrant(configuration, currentUrl, {
      pkceCodeVerifier: request.codeVerifier,
      expectedState: state,
      expectedNonce: request.nonce,
    });
    const claims = tokens.claims();
    console.log(claims)
    if (!claims?.sub) throw new Error("Microsoft ID token is missing sub");
    const emailValue = claims.email ?? claims.unique_name;
    if (typeof emailValue !== "string" || !emailValue) {
      throw new Error("Microsoft ID token is missing email or unique_name");
    }

    const user = await identity.upsertFromMicrosoft({
      issuer: claims.iss,
      subject: claims.sub,
      email: emailValue,
      emailVerified: claims.email_verified === true || Boolean(claims.preferred_username),
      displayName: typeof claims.name === "string" ? claims.name : undefined,
      picture: typeof claims.picture === "string" ? claims.picture : undefined,
    });
    return { authorizationRequestId: request.authorizationRequestId, user };
  }

  return { begin, callback };
}

export type MicrosoftService = ReturnType<typeof createMicrosoftService>;
