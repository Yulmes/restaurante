import type { Locale, PublicUser, RoleKey } from '@marea-baja/shared';
import { ROLE_KEYS } from '@marea-baja/shared';
import type { AppConfig } from '../../config/app-config.ts';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.ts';
import type { AuthContext } from '../../http/context.ts';
import { AppError, rateLimited } from '../../http/errors.ts';
import type { Clock } from '../../lib/clock.ts';
import { hmac, randomToken, sha256 } from '../../lib/crypto.ts';
import type { BotCheck } from '../bot-check/bot-check.ts';
import { enqueueEmail } from '../notifications/outbox.ts';
import type { RateLimiter } from '../rate-limit/rate-limiter.ts';
import { LoginProtection } from './login-protection.ts';
import { dummyPasswordHash, hashPassword, isCommonPassword, verifyPassword } from './passwords.ts';
import { AUTH_LIMITS, TOKEN_TTL } from './policies.ts';
import {
  createSession,
  revokeAllSessions,
  revokeSession,
  rotateSession,
  sessionCsrfToken,
} from './sessions.ts';

/**
 * Servicio de identidad (M3, §8). Abre las transacciones; los controladores solo traducen HTTP.
 * Los correos se encolan en la misma transacción que el evento (§8.5) y se envían después del
 * commit (`afterCommit`).
 */
export interface RequestMeta {
  ip: string;
  userAgent: string | undefined;
  requestId: string;
}

export interface IssuedSession {
  token: string;
  expires: Date;
  csrfToken: string;
}

export interface AuthDeps {
  db: PrismaClient;
  clock: Clock;
  config: AppConfig;
  limiter: RateLimiter;
  botCheck: BotCheck;
  /** Se llama después de cada commit que encoló correos. */
  afterCommit: () => void;
}

const userSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  locale: true,
  emailVerifiedAt: true,
  blockedAt: true,
  passwordHash: true,
  roles: { select: { role: { select: { key: true } } } },
} as const;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

const toLocale = (locale: 'es_CR' | 'en'): Locale => (locale === 'es_CR' ? 'es-CR' : 'en');
const toPrismaLocale = (locale: Locale): 'es_CR' | 'en' => (locale === 'es-CR' ? 'es_CR' : 'en');

function rolesOf(user: UserRow): RoleKey[] {
  return ROLE_KEYS.filter((role) => user.roles.some((r) => r.role.key === role));
}

export function toPublicUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    locale: toLocale(user.locale),
    emailVerified: user.emailVerifiedAt !== null,
    roles: rolesOf(user),
  };
}

function commonPasswordError(field: string): AppError {
  return new AppError(400, 'VALIDATION_FAILED', 'Password is too common', {
    fields: { [field]: 'passwordTooCommon' },
  });
}

const invalidToken = () => new AppError(400, 'INVALID_OR_EXPIRED_TOKEN', 'Invalid or expired token');

export class AuthService {
  readonly #d: AuthDeps;
  readonly #login: LoginProtection;

  constructor(deps: AuthDeps) {
    this.#d = deps;
    this.#login = new LoginProtection(deps);
  }

  ipHash(ip: string): string {
    return hmac(this.#d.config.appSecret, `ip:${ip}`);
  }

  #link(locale: Locale, page: 'verify' | 'reset', token: string): string {
    const path =
      locale === 'en'
        ? { verify: '/en/account/verify', reset: '/en/account/reset-password' }[page]
        : { verify: '/cuenta/verificar', reset: '/cuenta/restablecer' }[page];
    // El token va en el fragmento: no viaja a ningún servidor ni queda en logs o en Referer.
    return `${this.#d.config.publicWebUrl}${path}#token=${token}`;
  }

  async #limit(key: string, rule: { max: number; windowMs: number }): Promise<void> {
    const state = await this.#d.limiter.hit(key, rule.windowMs);
    if (state.count > rule.max) throw rateLimited(state.resetInMs / 1000);
  }

  async #userById(id: string): Promise<UserRow> {
    const user = await this.#d.db.user.findUnique({ where: { id }, select: userSelect });
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
    return user;
  }

  async #issueVerification(
    tx: Prisma.TransactionClient,
    user: { id: string; email: string; name: string; locale: Locale },
    now: Date,
  ): Promise<void> {
    // Emitir un enlace nuevo invalida los anteriores (§8.7).
    await tx.emailVerificationToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: now },
    });
    const token = randomToken();
    await tx.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(now.getTime() + TOKEN_TTL.emailVerificationMs),
        createdAt: now,
      },
    });
    await enqueueEmail(
      tx,
      {
        userId: user.id,
        to: user.email,
        locale: user.locale,
        template: 'email-verification',
        data: { name: user.name, actionUrl: this.#link(user.locale, 'verify', token) },
      },
      now,
    );
  }

  /**
   * Registro. La respuesta es la misma exista o no el correo (§8.4: los mensajes nunca revelan
   * si la cuenta existe). Si ya existe, no se crea nada ni se envía correo.
   */
  async register(
    input: { name: string; email: string; password: string; locale: Locale },
    meta: RequestMeta,
  ): Promise<void> {
    await this.#limit(`register:ip:${this.ipHash(meta.ip)}`, AUTH_LIMITS.register.perIp);
    if (isCommonPassword(input.password)) throw commonPasswordError('password');
    const passwordHash = await hashPassword(input.password);
    const now = this.#d.clock.now();
    try {
      const created = await this.#d.db.$transaction(async (tx) => {
        const existing = await tx.user.findFirst({ where: { email: input.email }, select: { id: true } });
        if (existing) return false;
        const customer = await tx.role.findUniqueOrThrow({
          where: { key: 'CUSTOMER' },
          select: { id: true },
        });
        const user = await tx.user.create({
          data: {
            email: input.email,
            name: input.name,
            passwordHash,
            locale: toPrismaLocale(input.locale),
            createdAt: now,
            roles: { create: { roleId: customer.id } },
          },
          select: { id: true },
        });
        await this.#issueVerification(
          tx,
          { id: user.id, email: input.email, name: input.name, locale: input.locale },
          now,
        );
        return true;
      });
      if (created) this.#d.afterCommit();
    } catch (error) {
      // Dos registros simultáneos con el mismo correo: el índice único decide, sin revelar nada.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
      throw error;
    }
  }

  async login(
    input: { email: string; password: string; turnstileToken?: string | undefined },
    meta: RequestMeta,
    previousSessionId: string | undefined,
  ): Promise<{ user: PublicUser; session: IssuedSession }> {
    const ipHash = this.ipHash(meta.ip);
    const subject = this.#login.subject(input.email, ipHash);
    const { challengeRequired } = await this.#login.before(subject);

    if (challengeRequired) {
      // D8: sin token válido → 403 sin evaluar la contraseña.
      if (!input.turnstileToken) {
        throw new AppError(403, 'CHALLENGE_REQUIRED', 'Challenge required', { challengeRequired: true });
      }
      if (!(await this.#d.botCheck.verify(input.turnstileToken, meta.ip))) {
        throw new AppError(403, 'CHALLENGE_FAILED', 'Challenge failed', { challengeRequired: true });
      }
    }

    const user = await this.#d.db.user.findFirst({ where: { email: input.email }, select: userSelect });
    const passwordOk = await verifyPassword(
      user?.passwordHash ?? (await dummyPasswordHash()),
      input.password,
    );
    if (!user || !passwordOk) return this.#login.failure(subject);
    if (user.blockedAt) throw new AppError(403, 'ACCOUNT_BLOCKED', 'Account blocked');

    await this.#login.success(subject);
    const now = this.#d.clock.now();
    const roles = rolesOf(user);
    const session = await this.#d.db.$transaction(async (tx) => {
      if (previousSessionId) await revokeSession(tx, previousSessionId, now);
      return createSession(tx, { userId: user.id, roles, ipHash, userAgent: meta.userAgent, now });
    });
    return {
      user: toPublicUser(user),
      session: {
        token: session.token,
        expires: session.absoluteExpiresAt,
        csrfToken: sessionCsrfToken(session.csrfSecret, session.sessionId),
      },
    };
  }

  async logout(auth: AuthContext): Promise<void> {
    await revokeSession(this.#d.db, auth.sessionId, this.#d.clock.now());
  }

  /** "Cerrar todas las sesiones" desde el perfil (§8.2), incluida la actual. */
  async logoutAll(auth: AuthContext): Promise<void> {
    await revokeAllSessions(this.#d.db, auth.userId, this.#d.clock.now());
  }

  async me(auth: AuthContext): Promise<PublicUser> {
    return toPublicUser(await this.#userById(auth.userId));
  }

  /** Verificación del correo. Si la sesión actual es del mismo usuario, rota su token (§8.2). */
  async verifyEmail(
    token: string,
    auth: AuthContext | undefined,
  ): Promise<{ user: PublicUser; session?: IssuedSession }> {
    const now = this.#d.clock.now();
    const result = await this.#d.db.$transaction(async (tx) => {
      const row = await tx.emailVerificationToken.findUnique({ where: { tokenHash: sha256(token) } });
      if (!row || row.usedAt || row.expiresAt <= now) throw invalidToken();
      await tx.emailVerificationToken.updateMany({
        where: { userId: row.userId, usedAt: null },
        data: { usedAt: now },
      });
      const user = await tx.user.update({
        where: { id: row.userId },
        data: { emailVerifiedAt: now },
        select: userSelect,
      });
      if (auth?.userId !== row.userId) return { user, session: undefined };
      const current = await tx.session.findUniqueOrThrow({ where: { id: auth.sessionId } });
      const rotated = await rotateSession(tx, {
        sessionId: current.id,
        createdAt: current.createdAt,
        absoluteExpiresAt: current.absoluteExpiresAt,
        roles: rolesOf(user),
        now,
      });
      return {
        user,
        session: {
          token: rotated.token,
          expires: rotated.absoluteExpiresAt,
          csrfToken: sessionCsrfToken(current.csrfSecret, current.id),
        },
      };
    });
    return { user: toPublicUser(result.user), ...(result.session ? { session: result.session } : {}) };
  }

  async resendVerification(auth: AuthContext, meta: RequestMeta): Promise<void> {
    const limits = AUTH_LIMITS.resendVerification;
    await this.#limit(`resend:ip:${this.ipHash(meta.ip)}`, limits.perIp);
    const user = await this.#userById(auth.userId);
    if (user.emailVerifiedAt) throw new AppError(409, 'EMAIL_ALREADY_VERIFIED', 'Email already verified');
    await this.#limit(`resend:acct-short:${user.id}`, limits.perAccountShort);
    await this.#limit(`resend:acct-day:${user.id}`, limits.perAccountDaily);
    const now = this.#d.clock.now();
    await this.#d.db.$transaction((tx) =>
      this.#issueVerification(
        tx,
        { id: user.id, email: user.email, name: user.name, locale: toLocale(user.locale) },
        now,
      ),
    );
    this.#d.afterCommit();
  }

  /** Recuperación (§8.4): respuesta idéntica siempre; el límite por correo es silencioso. */
  async forgotPassword(email: string, meta: RequestMeta): Promise<void> {
    const limits = AUTH_LIMITS.forgotPassword;
    await this.#limit(`forgot:ip:${this.ipHash(meta.ip)}`, limits.perIp);
    const perEmail = await this.#d.limiter.hit(
      `forgot:email:${hmac(this.#d.config.appSecret, `email:${email}`)}`,
      limits.perEmail.windowMs,
    );
    if (perEmail.count > limits.perEmail.max) return;
    const user = await this.#d.db.user.findFirst({ where: { email }, select: userSelect });
    if (!user || user.blockedAt) return;
    const now = this.#d.clock.now();
    await this.#d.db.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now },
      });
      const token = randomToken();
      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: sha256(token),
          expiresAt: new Date(now.getTime() + TOKEN_TTL.passwordResetMs),
          createdAt: now,
        },
      });
      const locale = toLocale(user.locale);
      await enqueueEmail(
        tx,
        {
          userId: user.id,
          to: user.email,
          locale,
          template: 'password-reset',
          data: { name: user.name, actionUrl: this.#link(locale, 'reset', token) },
        },
        now,
      );
    });
    this.#d.afterCommit();
  }

  /** Restablecer: cambia la contraseña y revoca todas las sesiones (§8.2). */
  async resetPassword(input: { token: string; password: string }): Promise<void> {
    if (isCommonPassword(input.password)) throw commonPasswordError('password');
    const passwordHash = await hashPassword(input.password);
    const now = this.#d.clock.now();
    await this.#d.db.$transaction(async (tx) => {
      const row = await tx.passwordResetToken.findUnique({ where: { tokenHash: sha256(input.token) } });
      if (!row || row.usedAt || row.expiresAt <= now) throw invalidToken();
      await tx.passwordResetToken.updateMany({
        where: { userId: row.userId, usedAt: null },
        data: { usedAt: now },
      });
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
      await revokeAllSessions(tx, row.userId, now);
    });
  }

  async updateProfile(
    auth: AuthContext,
    input: { name: string; phone?: string | null | undefined; locale: Locale },
  ): Promise<PublicUser> {
    const user = await this.#d.db.user.update({
      where: { id: auth.userId },
      data: { name: input.name, phone: input.phone ?? null, locale: toPrismaLocale(input.locale) },
      select: userSelect,
    });
    return toPublicUser(user);
  }

  /** Cambio de contraseña: revoca las demás sesiones y rota la actual (§8.2). */
  async changePassword(
    auth: AuthContext,
    input: { currentPassword: string; newPassword: string },
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    await this.#limit(`password:ip:${this.ipHash(meta.ip)}`, AUTH_LIMITS.profile.changePasswordPerIp);
    const user = await this.#userById(auth.userId);
    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw new AppError(400, 'VALIDATION_FAILED', 'Current password is incorrect', {
        fields: { currentPassword: 'currentPasswordIncorrect' },
      });
    }
    if (isCommonPassword(input.newPassword)) throw commonPasswordError('newPassword');
    const passwordHash = await hashPassword(input.newPassword);
    const now = this.#d.clock.now();
    return this.#d.db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await revokeAllSessions(tx, user.id, now, auth.sessionId);
      const current = await tx.session.findUniqueOrThrow({ where: { id: auth.sessionId } });
      const rotated = await rotateSession(tx, {
        sessionId: current.id,
        createdAt: current.createdAt,
        absoluteExpiresAt: current.absoluteExpiresAt,
        roles: rolesOf(user),
        now,
      });
      return {
        token: rotated.token,
        expires: rotated.absoluteExpiresAt,
        csrfToken: sessionCsrfToken(current.csrfSecret, current.id),
      };
    });
  }
}
