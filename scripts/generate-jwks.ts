import { exportJWK, generateKeyPair } from "jose";

const { privateKey } = await generateKeyPair("RS256", { extractable: true });
const jwk = await exportJWK(privateKey);
jwk.use = "sig";
jwk.alg = "RS256";
jwk.kid = crypto.randomUUID();
process.stdout.write(`${JSON.stringify({ keys: [jwk] })}\n`);
