import {
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  updateProfileRequestSchema,
  verifyEmailRequestSchema,
  type SessionResponse,
} from '@marea-baja/shared';
import { Router, type Request, type Response } from 'express';
import { cookieNames, type AppConfig } from '../../config/app-config.ts';
import { parseBody } from '../../http/errors.ts';
import { clearSessionCookie, setGuestCsrfCookie, setSessionCookie } from '../../http/session-cookie.ts';
import { randomToken } from '../../lib/crypto.ts';
import { expectedCsrfToken, guestCsrfToken } from '../../middleware/csrf.ts';
import { authOf, requireAuth } from '../../middleware/rbac.ts';
import type { AuthService, IssuedSession, RequestMeta } from './service.ts';

/**
 * Rutas de identidad. Todas las que modifican datos pasan antes por `csrfProtection` (app.ts).
 * Las respuestas no incluyen hashes ni tokens de base de datos: solo el token CSRF de la sesión.
 */
function meta(req: Request): RequestMeta {
  return { ip: req.clientIp, userAgent: req.get('user-agent'), requestId: req.requestId };
}

function sendSession(
  res: Response,
  config: AppConfig,
  status: number,
  body: Omit<SessionResponse, 'csrfToken'>,
  session: IssuedSession,
): void {
  setSessionCookie(res, config, session.token, session.expires);
  res.status(status).json({ ...body, csrfToken: session.csrfToken } satisfies SessionResponse);
}

export function authRouter(service: AuthService, config: AppConfig): Router {
  const router = Router();

  /** Token CSRF (§8.3): el de la sesión o, para invitados, uno ligado a una cookie previa. */
  router.get('/auth/csrf', (req, res) => {
    let token = expectedCsrfToken(req, config);
    if (!token) {
      const value = randomToken();
      setGuestCsrfCookie(res, config, value);
      token = guestCsrfToken(config, value);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ csrfToken: token });
  });

  router.post('/auth/register', async (req, res) => {
    await service.register(parseBody(registerRequestSchema, req.body), meta(req));
    res.status(202).json({ status: 'pending' });
  });

  router.post('/auth/login', async (req, res) => {
    const input = parseBody(loginRequestSchema, req.body);
    const { user, session } = await service.login(input, meta(req), req.auth?.sessionId);
    // La cookie de invitado ya no hace falta: desde ahora vale el token de la sesión.
    res.clearCookie(cookieNames(config).guestCsrf, { path: '/' });
    sendSession(res, config, 200, { user }, session);
  });

  router.post('/auth/logout', requireAuth, async (req, res) => {
    await service.logout(authOf(req));
    clearSessionCookie(res, config);
    res.status(204).end();
  });

  router.post('/auth/logout-all', requireAuth, async (req, res) => {
    await service.logoutAll(authOf(req));
    clearSessionCookie(res, config);
    res.status(204).end();
  });

  router.get('/auth/me', requireAuth, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ user: await service.me(authOf(req)) });
  });

  router.post('/auth/verify-email', async (req, res) => {
    const { token } = parseBody(verifyEmailRequestSchema, req.body);
    const result = await service.verifyEmail(token, req.auth);
    if (result.session) {
      sendSession(res, config, 200, { user: result.user }, result.session);
      return;
    }
    res.json({ user: result.user });
  });

  router.post('/auth/resend-verification', requireAuth, async (req, res) => {
    await service.resendVerification(authOf(req), meta(req));
    res.status(202).json({ status: 'sent' });
  });

  router.post('/auth/forgot-password', async (req, res) => {
    const { email } = parseBody(forgotPasswordRequestSchema, req.body);
    await service.forgotPassword(email, meta(req));
    res.status(202).json({ status: 'pending' });
  });

  router.post('/auth/reset-password', async (req, res) => {
    await service.resetPassword(parseBody(resetPasswordRequestSchema, req.body));
    // Todas las sesiones quedaron revocadas, también la de este navegador si había una.
    clearSessionCookie(res, config);
    res.status(204).end();
  });

  router.patch('/account/profile', requireAuth, async (req, res) => {
    const user = await service.updateProfile(authOf(req), parseBody(updateProfileRequestSchema, req.body));
    res.json({ user });
  });

  router.post('/account/password', requireAuth, async (req, res) => {
    const auth = authOf(req);
    const session = await service.changePassword(
      auth,
      parseBody(changePasswordRequestSchema, req.body),
      meta(req),
    );
    sendSession(res, config, 200, { user: await service.me(auth) }, session);
  });

  return router;
}
