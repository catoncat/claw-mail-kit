import type { AccessIdentity } from './app-types';
import { base64UrlBytes, decodeBase64UrlJson } from './crypto';
import { HttpError } from './http';

type Jwk = JsonWebKey & { kid?: string; alg?: string };
type JwtHeader = { alg?: string; kid?: string };
type AccessJwtPayload = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  email?: string;
  name?: string;
  sub?: string;
};

type JwksResponse = { keys?: Jwk[] };

function cookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) return rest.join('=');
  }
  return null;
}

function accessTokenFromRequest(request: Request): string | null {
  return request.headers.get('cf-access-jwt-assertion') || cookieValue(request.headers.get('cookie'), 'CF_Authorization');
}

function normalizeTeamDomain(value: string): string {
  return value.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function audienceMatches(payloadAud: string | string[] | undefined, expected: string): boolean {
  if (!payloadAud) return false;
  const values = Array.isArray(payloadAud) ? payloadAud : [payloadAud];
  return values.includes(expected);
}

async function verifyAccessJwt(token: string, env: Env): Promise<AccessIdentity> {
  const teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN || '');
  const expectedAud = env.ACCESS_AUD || '';
  if (!teamDomain || !expectedAud) throw new HttpError(500, 'Cloudflare Access verification is not configured');

  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) throw new HttpError(401, 'invalid Access JWT');
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
  const header = decodeBase64UrlJson<JwtHeader>(encodedHeader);
  const payload = decodeBase64UrlJson<AccessJwtPayload>(encodedPayload);
  if (header.alg !== 'RS256' || !header.kid) throw new HttpError(401, 'unsupported Access JWT');

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now) throw new HttpError(401, 'Access JWT expired');
  if (payload.nbf && payload.nbf > now + 60) throw new HttpError(401, 'Access JWT not yet valid');
  if (!audienceMatches(payload.aud, expectedAud)) throw new HttpError(403, 'Access JWT audience mismatch');
  const issuer = `https://${teamDomain}`;
  if (payload.iss && payload.iss.replace(/\/+$/, '') !== issuer) throw new HttpError(403, 'Access JWT issuer mismatch');

  const certsUrl = `https://${teamDomain}/cdn-cgi/access/certs`;
  const certsResponse = await fetch(certsUrl, { headers: { accept: 'application/json' } });
  if (!certsResponse.ok) throw new HttpError(502, 'failed to fetch Access certs');
  const jwks = (await certsResponse.json()) as JwksResponse;
  const jwk = jwks.keys?.find((key) => key.kid === header.kid);
  if (!jwk) throw new HttpError(401, 'Access JWT key not found');
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signature = base64UrlBytes(encodedSignature);
  const data = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const signatureBuffer = signature.buffer.slice(signature.byteOffset, signature.byteOffset + signature.byteLength) as ArrayBuffer;
  const dataBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signatureBuffer, dataBuffer);
  if (!ok) throw new HttpError(401, 'Access JWT signature mismatch');

  const email = payload.email || payload.sub;
  if (!email) throw new HttpError(401, 'Access JWT missing identity');
  return { email, name: payload.name, sub: payload.sub, aud: payload.aud };
}

export async function authenticate(request: Request, env: Env): Promise<AccessIdentity> {
  if (env.DEV_BYPASS_AUTH === 'true') {
    const devUser = request.headers.get('x-claw-dev-user') || 'dev@local';
    return { email: devUser, name: 'Local dev' };
  }
  const token = accessTokenFromRequest(request);
  if (!token) throw new HttpError(401, 'Cloudflare Access JWT required');
  return verifyAccessJwt(token, env);
}
