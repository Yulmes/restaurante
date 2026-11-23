import type { Address, DeliveryZone, addressInputSchema } from '@marea-baja/shared';
import type { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client.ts';
import { AppError } from '../../http/errors.ts';
import type { Db } from '../cart/catalog-lines.ts';
import { normalizeDistrict } from '../cart/lines.ts';

/**
 * Direcciones del cliente (R-AUTH-01, en M5 por decisión del propietario del 13/11/2026) y zonas
 * de delivery (§6, semilla de M2). La tarifa y el tiempo estimado salen siempre de la zona activa
 * que cubre el distrito: el navegador no puede elegir ni enviar una tarifa.
 */

/** Tope técnico de direcciones guardadas por cuenta (ADR 0006). */
export const MAX_ADDRESSES = 10;

type ParsedAddress = z.output<typeof addressInputSchema>;

export async function activeZones(db: Db): Promise<DeliveryZone[]> {
  const zones = await db.deliveryZone.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
    select: { id: true, name: true, districts: true, feeMinor: true, etaMinutes: true },
  });
  return zones;
}

/** Zona activa que cubre el distrito, o `null`. */
export function zoneForDistrict(zones: readonly DeliveryZone[], district: string): DeliveryZone | null {
  const wanted = normalizeDistrict(district);
  return zones.find((zone) => zone.districts.some((d) => normalizeDistrict(d) === wanted)) ?? null;
}

const addressSelect = {
  id: true,
  label: true,
  line1: true,
  line2: true,
  district: true,
  canton: true,
  province: true,
  reference: true,
  isDefault: true,
} as const;

interface AddressRow {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  district: string;
  canton: string;
  province: string;
  reference: string;
  isDefault: boolean;
}

function toAddress(row: AddressRow, zones: readonly DeliveryZone[]): Address {
  const zone = zoneForDistrict(zones, row.district);
  return {
    ...row,
    deliveryZone: zone
      ? { id: zone.id, name: zone.name, feeMinor: zone.feeMinor, etaMinutes: zone.etaMinutes }
      : null,
  };
}

export class AddressService {
  readonly #db: PrismaClient;

  constructor(db: PrismaClient) {
    this.#db = db;
  }

  async zones(): Promise<{ currency: 'CRC' | 'USD'; zones: DeliveryZone[] }> {
    const [settings, zones] = await Promise.all([
      this.#db.restaurantSettings.findUnique({ where: { id: 1 }, select: { currency: true } }),
      activeZones(this.#db),
    ]);
    return { currency: settings?.currency ?? 'CRC', zones };
  }

  async list(userId: string): Promise<Address[]> {
    const [rows, zones] = await Promise.all([
      this.#db.address.findMany({
        where: { userId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: addressSelect,
      }),
      activeZones(this.#db),
    ]);
    return rows.map((row) => toAddress(row, zones));
  }

  async create(userId: string, input: ParsedAddress): Promise<Address> {
    return this.#db.$transaction(async (tx) => {
      const zones = await activeZones(tx);
      const zone = requireCoveredDistrict(zones, input.district);
      // Serializa las altas de la misma cuenta: el tope y la dirección principal quedan consistentes.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      const count = await tx.address.count({ where: { userId } });
      if (count >= MAX_ADDRESSES) {
        throw new AppError(422, 'VALIDATION_FAILED', 'Too many addresses', { fields: { label: 'tooMany' } });
      }
      const isDefault = input.isDefault || count === 0;
      if (isDefault) await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      const row = await tx.address.create({
        data: {
          userId,
          label: input.label,
          line1: input.line1,
          line2: input.line2 ?? null,
          // Se guarda el nombre de la zona (con sus tildes), no el texto tal como llegó.
          district:
            zone.districts.find((d) => normalizeDistrict(d) === normalizeDistrict(input.district)) ??
            input.district,
          canton: input.canton,
          province: input.province,
          reference: input.reference,
          isDefault,
        },
        select: addressSelect,
      });
      return toAddress(row, zones);
    });
  }

  /** Ajena o inexistente → 404 (no confirma que exista, §8.7). */
  async remove(userId: string, id: string): Promise<void> {
    await this.#db.$transaction(async (tx) => {
      const row = await tx.address.findFirst({
        where: { id, userId },
        select: { id: true, isDefault: true },
      });
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Address not found');
      await tx.address.delete({ where: { id: row.id } });
      if (row.isDefault) {
        const next = await tx.address.findFirst({
          where: { userId },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
  }
}

export function requireCoveredDistrict(zones: readonly DeliveryZone[], district: string): DeliveryZone {
  const zone = zoneForDistrict(zones, district);
  if (!zone) {
    throw new AppError(422, 'VALIDATION_FAILED', 'District outside the delivery zones', {
      fields: { district: 'districtNotCovered' },
    });
  }
  return zone;
}
