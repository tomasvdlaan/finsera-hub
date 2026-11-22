/**
 * A stand-in for the Hub's identity signer, for developing an artefact without the Hub.
 *
 *   node scripts/identity-test-kit.mjs keygen [dir]            # new throwaway key + jwks.json
 *   node scripts/identity-test-kit.mjs mint [dir] [options]    # print a signed x-finsera-identity
 *   node scripts/identity-test-kit.mjs serve [dir] [port]      # serve jwks.json over http
 *
 * mint options: --aud <slug> --email <a@b> --name <n> --kind client|staff --sub <id>
 *               --ttl <seconds, default 3600> --iss <issuer, default https://hub.finsera.nl>
 *
 * The key is a throwaway: it lives in `dir` (default ./.identity-test, gitignored), it is not
 * the production key, and it only means anything to an artefact that has been pointed at the
 * matching jwks.json. Never copy it into a deployment's real environment.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { SignJWT, calculateJwkThumbprint, exportJWK } from 'jose';

const [cmd, ...rest] = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[++i];
  else positional.push(rest[i]);
}
const dir = positional[0] ?? '.identity-test';
const keyFile = join(dir, 'private.pem');
const jwksFile = join(dir, 'jwks.json');

async function publicJwk(privateKey) {
  const jwk = await exportJWK(createPublicKey(privateKey));
  jwk.alg = 'EdDSA';
  jwk.use = 'sig';
  jwk.kid = await calculateJwkThumbprint(jwk);
  return jwk;
}

if (cmd === 'keygen') {
  mkdirSync(dir, { recursive: true });
  const { privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  writeFileSync(jwksFile, JSON.stringify({ keys: [await publicJwk(privateKey)] }, null, 2));
  console.log(`Wrote ${keyFile} and ${jwksFile}`);
  console.log('JWKS as one line, for HUB_JWKS_JSON on a Vercel preview:');
  console.log(JSON.stringify(JSON.parse(readFileSync(jwksFile, 'utf8'))));
} else if (cmd === 'mint') {
  if (!existsSync(keyFile)) throw new Error(`No key at ${keyFile}; run keygen first`);
  const privateKey = createPrivateKey(readFileSync(keyFile));
  const jwk = await publicJwk(privateKey);
  const email = flags.email ?? 'medewerker@dochorse.nl';
  const token = await new SignJWT({ email, name: flags.name ?? 'Test Medewerker', kind: flags.kind ?? 'client' })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT', kid: jwk.kid })
    .setIssuer(flags.iss ?? 'https://hub.finsera.nl')
    .setAudience(flags.aud ?? 'vertragingsmeldingen')
    .setSubject(flags.sub ?? '00000000-0000-7000-8000-000000000001')
    .setIssuedAt()
    .setExpirationTime(`${Number(flags.ttl ?? 3600)}s`)
    .sign(privateKey);
  console.log(token);
} else if (cmd === 'serve') {
  const port = Number(positional[1] ?? 4010);
  const body = readFileSync(jwksFile);
  createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(body);
  }).listen(port, () => console.log(`JWKS on http://localhost:${port}/jwks.json`));
} else {
  console.error('usage: identity-test-kit.mjs keygen|mint|serve [dir] [options]');
  process.exit(1);
}
