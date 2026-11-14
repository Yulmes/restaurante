import { z } from 'zod';
import { DEFAULT_LOCALE, localeSchema } from '../i18n/locales.ts';

/**
 * Contratos de identidad (M3, §8). Los usan la API para validar y la web para los formularios
 * (React Hook Form + Zod, §4.4). Los mensajes de error son códigos: cada app los traduce (§4.5).
 */

/** §8.7: mínimo 12 caracteres, sin reglas de composición. El tope evita abusar de Argon2. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const ROLE_KEYS = ['CUSTOMER', 'STAFF', 'ADMIN'] as const;
export const roleKeySchema = z.enum(ROLE_KEYS);
export type RoleKey = z.infer<typeof roleKeySchema>;

/** Correo normalizado: sin espacios alrededor y en minúsculas (único con `lower(email)`, M2). */
export const emailSchema = z
  .string({ error: 'required' })
  .trim()
  .min(1, { error: 'required' })
  .max(254, { error: 'tooLong' })
  .pipe(z.email({ error: 'invalidEmail' }))
  .transform((value) => value.toLowerCase());

export const newPasswordSchema = z
  .string({ error: 'required' })
  .min(1, { error: 'required' })
  .min(PASSWORD_MIN_LENGTH, { error: 'passwordTooShort' })
  .max(PASSWORD_MAX_LENGTH, { error: 'passwordTooLong' });

/** Para iniciar sesión no se valida la política: solo que haya algo que comparar. */
const currentPasswordSchema = z
  .string({ error: 'required' })
  .min(1, { error: 'required' })
  .max(PASSWORD_MAX_LENGTH, { error: 'passwordTooLong' });

export const nameSchema = z
  .string({ error: 'required' })
  .trim()
  .min(1, { error: 'required' })
  .max(80, { error: 'tooLong' });

/** Teléfono opcional: dígitos, espacios, guiones y un "+" inicial. Vacío → null. */
export const phoneSchema = z
  .string()
  .trim()
  .max(20, { error: 'tooLong' })
  .regex(/^(\+?[0-9][0-9 -]{6,18})?$/, { error: 'invalidPhone' })
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional();

/** Tokens de un solo uso de los enlaces de correo: 32 bytes en base64url (43 caracteres). */
export const emailTokenSchema = z
  .string({ error: 'required' })
  .regex(/^[A-Za-z0-9_-]{43}$/, { error: 'invalidToken' });

export const registerRequestSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: newPasswordSchema,
  locale: localeSchema,
});
export type RegisterRequest = z.input<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: currentPasswordSchema,
  /** Solo cuando la API pidió el desafío (`challengeRequired`, D8). */
  turnstileToken: z.string().min(1).max(2048).optional(),
});
export type LoginRequest = z.input<typeof loginRequestSchema>;

export const verifyEmailRequestSchema = z.object({ token: emailTokenSchema });

/** El correo de recuperación sale en `User.locale`; si la cuenta no existe, no sale nada. */
export const forgotPasswordRequestSchema = z.object({ email: emailSchema });
export type ForgotPasswordRequest = z.input<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  token: emailTokenSchema,
  password: newPasswordSchema,
});
export type ResetPasswordRequest = z.input<typeof resetPasswordRequestSchema>;

export const updateProfileRequestSchema = z.object({
  name: nameSchema,
  phone: phoneSchema,
  locale: localeSchema,
});
export type UpdateProfileRequest = z.input<typeof updateProfileRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: currentPasswordSchema,
  newPassword: newPasswordSchema,
});
export type ChangePasswordRequest = z.input<typeof changePasswordRequestSchema>;

/** Usuario tal como lo ve su dueño. Nunca incluye hashes ni tokens. */
export const publicUserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  /** Preferencia guardada (D2). Un valor que no sea es-CR ni en se lee como es-CR. */
  locale: localeSchema.catch(DEFAULT_LOCALE),
  emailVerified: z.boolean(),
  roles: z.array(roleKeySchema),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export const sessionResponseSchema = z.object({
  user: publicUserSchema,
  /** Token CSRF de la sesión nueva (§8.3): la web lo usa en `X-CSRF-Token`. */
  csrfToken: z.string(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const meResponseSchema = z.object({ user: publicUserSchema });
export const csrfResponseSchema = z.object({ csrfToken: z.string() });
