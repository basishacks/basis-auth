import {
  createLocalJWKSet,
  importJWK,
  jwtVerify,
  SignJWT,
  type JWK,
  type JWTPayload,
} from "jose";
import type { AppConfig } from "../config.js";
import type { IdentityService } from "../identity.js";

const privateFields = new Set(["d", "p", "q", "dp", "dq", "qi", "oth", "k"]);

function toPublicJwk(jwk: JWK): JWK {
  return Object.fromEntries(Object.entries(jwk).filter(([key]) => !privateFields.has(key))) as JWK;
}

export interface AccessTokenClaims extends JWTPayload {
  sub: string;
  client_id: string;
  scope: string;
  permissions: string[];
}

export async function createKeyService(config: AppConfig, identity: IdentityService) {
  const signingJwk = config.jwks.keys[0];
  if (!signingJwk?.d || signingJwk.kty !== "RSA") {
    throw new Error("The first OIDC signing JWK must be a private RSA key");
  }
  const activeJwk = signingJwk;
  const signingKey = await importJWK(signingJwk, "RS256");
  const publicJwks = { keys: config.jwks.keys.map(toPublicJwk) };
  const verifier = createLocalJWKSet(publicJwks);

  async function issueAccessToken(input: {
    userId: string;
    clientId: string;
    scopes: string[];
    resource: string;
  }) {
    const permissions = await identity.permissionsFor(input.userId);
    return new SignJWT({
      client_id: input.clientId,
      scope: input.scopes.join(" "),
      permissions,
    })
      .setProtectedHeader({ alg: "RS256", kid: activeJwk.kid, typ: "at+jwt" })
      .setIssuer(config.issuer)
      .setSubject(input.userId)
      .setAudience(input.resource)
      .setJti(crypto.randomUUID())
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(signingKey);
  }

  async function issueIdToken(input: {
    userId: string;
    clientId: string;
    scopes: string[];
    nonce: string;
    authenticatedAt: Date;
    accessToken: string;
  }) {
    const account = await identity.findAccount(input.userId);
    if (!account) throw new Error("User no longer exists");
    const claims = await account.claims("id_token", input.scopes.join(" "));
    const digest = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.accessToken)));
    const atHash = digest.subarray(0, digest.length / 2).toString("base64url");
    return new SignJWT({ ...claims, nonce: input.nonce, auth_time: Math.floor(input.authenticatedAt.getTime() / 1000), at_hash: atHash })
      .setProtectedHeader({ alg: "RS256", kid: activeJwk.kid, typ: "JWT" })
      .setIssuer(config.issuer)
      .setSubject(input.userId)
      .setAudience(input.clientId)
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(signingKey);
  }

  async function verifyAccessToken(token: string) {
    const { payload, protectedHeader } = await jwtVerify(token, verifier, {
      algorithms: ["RS256"],
      issuer: config.issuer,
      typ: "at+jwt",
    });
    if (
      protectedHeader.typ !== "at+jwt" ||
      !payload.sub ||
      typeof payload.client_id !== "string" ||
      typeof payload.scope !== "string" ||
      !Array.isArray(payload.permissions)
    ) {
      throw new Error("Access token claims are invalid");
    }
    return payload as AccessTokenClaims;
  }

  return { publicJwks, issueAccessToken, issueIdToken, verifyAccessToken };
}

export type KeyService = Awaited<ReturnType<typeof createKeyService>>;
