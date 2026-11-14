import type { RoleKey } from '@marea-baja/shared';
import type { Prisma } from '../../generated/prisma/client.ts';
import { maskEmail } from '../../config/logger.ts';

/**
 * AuditLog (§8.6, R-AUD-01). Reglas:
 * 1. Se escribe con el mismo cliente de transacción que el cambio (`tx`): si el cambio se
 *    revierte, la entrada también; si la entrada falla, el cambio no se confirma.
 * 2. Cada `entityType` tiene una lista blanca de campos. Lo que no está en la lista no entra:
 *    contraseñas, hashes, tokens y direcciones completas nunca se registran. Los correos se
 *    enmascaran.
 * 3. La tabla es de solo inserción (trigger y permisos de M2); este módulo solo hace INSERT.
 *
 * En M3 se audita el cambio de roles (RBAC). Las listas de productos, configuración, pedidos y
 * reembolsos se agregan con sus servicios (M7, M8).
 */
export const AUDIT_WHITELIST = {
  user: ['email', 'name', 'locale', 'roles', 'emailVerified', 'blocked'],
} as const satisfies Record<string, readonly string[]>;

export type AuditEntityType = keyof typeof AUDIT_WHITELIST;

/** Campos que se enmascaran aunque estén en la lista blanca. */
const MASKED_FIELDS = new Set(['email']);

export interface AuditActor {
  userId: string;
  role: RoleKey;
}

export interface AuditEntry {
  /** `null` cuando lo hace el sistema o un script del propietario. */
  actor: AuditActor | null;
  action: string;
  entityType: AuditEntityType;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  requestId?: string | null;
}

type JsonValue = Prisma.InputJsonValue;

function toJson(value: unknown): JsonValue | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => toJson(item));
  // Objetos anidados: no se auditan (no hay forma segura de filtrarlos campo por campo).
  return null;
}

/** Deja solo los campos permitidos del tipo de entidad y enmascara los correos. */
export function sanitizeAuditData(
  entityType: AuditEntityType,
  data: Record<string, unknown> | null | undefined,
): Record<string, JsonValue | null> | null {
  if (!data) return null;
  const allowed: readonly string[] = AUDIT_WHITELIST[entityType];
  const result: Record<string, JsonValue | null> = {};
  for (const field of allowed) {
    if (!(field in data)) continue;
    const value = data[field];
    result[field] = MASKED_FIELDS.has(field) && typeof value === 'string' ? maskEmail(value) : toJson(value);
  }
  return result;
}

export async function recordAudit(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
  if (!(entry.entityType in AUDIT_WHITELIST)) {
    throw new Error(`Tipo de entidad sin lista blanca de auditoría: ${entry.entityType}`);
  }
  const before = sanitizeAuditData(entry.entityType, entry.before);
  const after = sanitizeAuditData(entry.entityType, entry.after);
  await tx.auditLog.create({
    data: {
      actorUserId: entry.actor?.userId ?? null,
      actorRole: entry.actor?.role ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
      reason: entry.reason ?? null,
      requestId: entry.requestId ?? null,
    },
  });
}
