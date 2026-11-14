import { hash, verify } from '@node-rs/argon2';
import { dictionary } from '@zxcvbn-ts/language-common';

/**
 * Contraseñas (§8.7): Argon2id con los parámetros mínimos de OWASP (19 MiB, 2 iteraciones,
 * paralelismo 1). Política: mínimo 12 caracteres (validado en `shared`), sin reglas de
 * composición, y rechazo de las 10.000 más comunes.
 */
export const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/**
 * Las 10.000 contraseñas más comunes, de la lista local de `@zxcvbn-ts/language-common` (MIT),
 * ordenada por frecuencia. Se compara sin distinguir mayúsculas.
 */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set(
  (dictionary['passwords-common'] as readonly string[]).slice(0, 10_000).map((p) => p.toLowerCase()),
);

export const COMMON_PASSWORD_COUNT = COMMON_PASSWORDS.size;

export function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/**
 * Hash de una contraseña que nadie conoce: con un correo inexistente igual se verifica contra
 * él, para que el tiempo de respuesta no revele si la cuenta existe (§8.1, enumeración).
 */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(`marea-baja-dummy-${String(Math.random())}`);
  return dummyHash;
}
