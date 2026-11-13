import type { RoleKey } from '@marea-baja/shared';
import type { Logger } from 'pino';

/** Sesión válida de la petición (§8.2), cargada por el middleware de sesión. */
export interface AuthContext {
  sessionId: string;
  userId: string;
  csrfSecret: string;
  roles: readonly RoleKey[];
  emailVerified: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
    log: Logger;
    /** IP del cliente tal como la ve la API. Detrás del Worker se ajusta en M10 (R5, R-SEC-09). */
    clientIp: string;
    auth?: AuthContext;
    /** Cookies propias ya leídas (`req.cookies` de Express queda sin usar). */
    cookieJar: Record<string, string>;
  }
}
