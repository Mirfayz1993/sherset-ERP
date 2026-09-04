import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { StoreAddressService } from './store-address.service.js';

/**
 * F3 (reja 2026-08-23) — `numberWarehouse` xulqi in-memory fake Prisma ustida:
 * dryRun hech nima yozmaydi, real yugurish yacheyka+zona yaratadi va zonaga
 * bog'laydi, ikkinchi yugurish idempotent (mavjudlar o'tkazib yuboriladi).
 * Yozish yo'li `bulkCreateCells` bilan umumiy (`createMissingCells`) — bu
 * testlar o'sha umumiy yo'l raqamlashtirish kirishida ham to'g'ri ishlashini
 * qulflaydi.
 */
function makeService() {
  let zoneSeq = 0;
  let cellSeq = 0;
  const zones = new Map<string, { id: string; name: string; storeId: string }>();
  const cells = new Map<string, { id: string; name: string; zoneId: string | null }>();

  const client = {
    store: { findFirst: vi.fn(async () => ({ id: 'store-1' })) },
    storeZone: {
      findMany: vi.fn(async ({ where }: { where: { name?: { in: string[] } } }) =>
        [...zones.values()].filter((z) => !where.name || where.name.in.includes(z.name)),
      ),
      createMany: vi.fn(async ({ data }: { data: Array<{ name: string }> }) => {
        let count = 0;
        for (const d of data) {
          if ([...zones.values()].some((z) => z.name === d.name)) continue;
          zoneSeq += 1;
          const id = `zone-${zoneSeq}`;
          zones.set(id, { id, name: d.name, storeId: 'store-1' });
          count += 1;
        }
        return { count };
      }),
    },
    storeCell: {
      findMany: vi.fn(async ({ where }: { where: { name?: { in: string[] } } }) =>
        [...cells.values()].filter((c) => !where.name || where.name.in.includes(c.name)),
      ),
      createMany: vi.fn(
        async ({ data }: { data: Array<{ name: string; zoneId: string | null }> }) => {
          let count = 0;
          for (const d of data) {
            if ([...cells.values()].some((c) => c.name === d.name)) continue;
            cellSeq += 1;
            const id = `cell-${cellSeq}`;
            cells.set(id, { id, name: d.name, zoneId: d.zoneId });
            count += 1;
          }
          return { count };
        },
      ),
    },
    $transaction: undefined as unknown as (
      fn: (t: unknown) => Promise<unknown>,
    ) => Promise<unknown>,
  };
  client.$transaction = async (fn: (t: unknown) => Promise<unknown>) => fn(client);
  const svc = new StoreAddressService(
    { client } as never,
    {} as never,
    {} as never,
    {} as never,
    // N2 — sanoq izi qatlami; bu testlar `setCellStock` ni chaqirmaydi.
    { recordCount: async () => ({ recorded: false }) } as never,
  );
  return { svc, zones, cells };
}

const RECIPE = {
  warehouseNo: '03',
  stelajlar: [
    { qavatlar: 2, orinlar: 2 },
    { qavatlar: 1, orinlar: 3 },
  ],
};

describe('StoreAddressService.numberWarehouse', () => {
  it('dryRun: to‘liq hisob qaytadi, hech narsa yozilmaydi', async () => {
    const { svc, zones, cells } = makeService();
    const r = await svc.numberWarehouse('acc-1', 'store-1', { ...RECIPE, dryRun: true });
    expect(r).toMatchObject({ total: 7, toCreate: 7, existing: 0, created: 0, zonesCreated: 0 });
    expect(r.zonesToCreate).toEqual(['03-01', '03-02']);
    expect(r.sample[0]).toBe('03-01-01-01');
    expect(zones.size).toBe(0);
    expect(cells.size).toBe(0);
  });

  it('real yugurish: yacheykalar zonasi bilan yaratiladi, sonlar haqiqiy', async () => {
    const { svc, zones, cells } = makeService();
    const r = await svc.numberWarehouse('acc-1', 'store-1', RECIPE);
    expect(r).toMatchObject({ total: 7, toCreate: 7, created: 7, zonesCreated: 2 });

    const zoneByName = new Map([...zones.values()].map((z) => [z.name, z.id]));
    expect([...zoneByName.keys()].sort()).toEqual(['03-01', '03-02']);
    // Har yacheyka O'Z stelaj-zonasiga ulangan (2-segment bo'yicha).
    for (const c of cells.values()) {
      const stelajZone = c.name.slice(0, 5); // NN-SS
      expect(c.zoneId).toBe(zoneByName.get(stelajZone));
    }
    expect(cells.size).toBe(7);
  });

  it('ikkinchi yugurish idempotent: mavjudlar o‘tkazib yuboriladi', async () => {
    const { svc, cells } = makeService();
    await svc.numberWarehouse('acc-1', 'store-1', RECIPE);
    const r2 = await svc.numberWarehouse('acc-1', 'store-1', RECIPE);
    expect(r2).toMatchObject({ total: 7, toCreate: 0, existing: 7, created: 0, zonesCreated: 0 });
    expect(cells.size).toBe(7);
  });

  it('ombor kengayishi: yangi stelaj qo‘shilsa faqat yetishmagani yaratiladi', async () => {
    const { svc, cells, zones } = makeService();
    await svc.numberWarehouse('acc-1', 'store-1', RECIPE);
    const r = await svc.numberWarehouse('acc-1', 'store-1', {
      ...RECIPE,
      stelajlar: [...RECIPE.stelajlar, { qavatlar: 1, orinlar: 2 }],
    });
    expect(r).toMatchObject({ total: 9, toCreate: 2, existing: 7, created: 2, zonesCreated: 1 });
    expect(cells.size).toBe(9);
    expect([...zones.values()].map((z) => z.name).sort()).toEqual(['03-01', '03-02', '03-03']);
  });

  it('semantik xato (qavatlar=0) 400 ga aylanadi', async () => {
    const { svc } = makeService();
    await expect(
      svc.numberWarehouse('acc-1', 'store-1', {
        warehouseNo: '03',
        stelajlar: [{ qavatlar: 0, orinlar: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
