import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 bytes aleatorios en base64url (43 caracteres): sesiones y enlaces de correo (§8.2, §8.7). */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** En la base solo se guarda el hash del token (§8.2). */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmac(key: string, value: string): string {
  return createHmac('sha256', key).update(value).digest('base64url');
}

/** Comparación en tiempo constante; distinta longitud → false sin filtrar el contenido. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
