import { describe, expect, it } from 'vitest';
import {
  CreateInventorySchema,
  InventoryFilterSchema,
  InventoryStateSchema,
  InventoryTransitionSchema,
  UpdateInventorySchema,
} from './inventory.schema.js';

describe('InventoryStateSchema', () => {
  it('accepts documented states', () => {
    for (const s of ['draft', 'posted', 'cancelled']) {
      expect(InventoryStateSchema.parse(s)).toBe(s);
    }
  });

  it('N-reja N2 — `counted` (yopilgan sanash sessiyasi) ham qabul qilinadi', () => {
    expect(InventoryStateSchema.parse('counted')).toBe('counted');
    // Ro'yxat filtri shu enumdan foydalanadi — usiz web `?state=counted` bilan
    // sessiyalarni ajratib ololmasdi.
    expect(InventoryFilterSchema.parse({ state: 'counted' }).state).toBe('counted');
    expect(() => InventoryStateSchema.parse('closed')).toThrow();
  });

  it('🔴 `counted` ga API orqali O`TIB bo`lmaydi — u transition EMAS', () => {
    // Holat FAQAT sessiyani yopish yo'li bilan yoziladi
    // (`count-session.service.ts`), `POST /inventories/:id/transitions/...`
    // orqali emas: post/cancel `applyDeltas` chaqiradi va sessiya hujjatida
    // bu qoldiqni ikki karra siljitardi (N-reja §2.1).
    expect(() => InventoryTransitionSchema.parse('counted')).toThrow();
    expect(() => InventoryTransitionSchema.parse('close')).toThrow();
  });
});

describe('InventoryTransitionSchema', () => {
  it('accepts ONLY post/cancel (no unpost — physical count is truth)', () => {
    expect(InventoryTransitionSchema.parse('post')).toBe('post');
    expect(InventoryTransitionSchema.parse('cancel')).toBe('cancel');
    expect(() => InventoryTransitionSchema.parse('unpost')).toThrow();
  });
});

describe('CreateInventorySchema', () => {
  const valid = {
    organizationId: '00000000-0000-0000-0000-000000000001',
    storeId: '00000000-0000-0000-0000-000000000010',
    positions: [
      {
        assortmentKind: 'product',
        assortmentId: '00000000-0000-0000-0000-000000000099',
        actualQty: '10',
      },
    ],
  };

  it('parses minimal valid input', () => {
    const p = CreateInventorySchema.parse(valid);
    expect(p.positions[0].actualQty).toBe('10');
  });

  it('accepts 0 actualQty (full shortage)', () => {
    const p = CreateInventorySchema.parse({
      ...valid,
      positions: [{ ...valid.positions[0], actualQty: '0' }],
    });
    expect(p.positions[0].actualQty).toBe('0');
  });

  it('rejects negative actualQty', () => {
    expect(() =>
      CreateInventorySchema.parse({
        ...valid,
        positions: [{ ...valid.positions[0], actualQty: '-1' }],
      }),
    ).toThrow();
  });

  it('accepts fractional actualQty (e.g., 2.5 kg)', () => {
    const p = CreateInventorySchema.parse({
      ...valid,
      positions: [{ ...valid.positions[0], actualQty: '2.5' }],
    });
    expect(p.positions[0].actualQty).toBe('2.5');
  });
});

describe('InventoryFilterSchema', () => {
  it('applies defaults', () => {
    expect(InventoryFilterSchema.parse({}).limit).toBe(50);
  });
  it('accepts projectId / groupId / ownerId filters (moysklad parity, all backed)', () => {
    const p = InventoryFilterSchema.parse({
      projectId: '00000000-0000-0000-0000-000000000050',
      groupId: '00000000-0000-0000-0000-000000000051',
      ownerId: '00000000-0000-0000-0000-000000000052',
    });
    expect(p.projectId).toBe('00000000-0000-0000-0000-000000000050');
    expect(p.groupId).toBe('00000000-0000-0000-0000-000000000051');
    expect(p.ownerId).toBe('00000000-0000-0000-0000-000000000052');
  });
  it('coerces applicable / printed / published string flags into booleans', () => {
    const p = InventoryFilterSchema.parse({
      applicable: 'true',
      printed: 'false',
      published: 'true',
    });
    expect(p.applicable).toBe(true);
    expect(p.printed).toBe(false);
    expect(p.published).toBe(true);
  });
  it('accepts updatedFrom/updatedTo («Когда изменен») strings', () => {
    const p = InventoryFilterSchema.parse({
      updatedFrom: '2026-01-01',
      updatedTo: '2026-12-31',
    });
    expect(p.updatedFrom).toBe('2026-01-01');
    expect(p.updatedTo).toBe('2026-12-31');
  });
  it('coerces sumMinor range to ints (Inventory.sumMinor IS backed)', () => {
    const p = InventoryFilterSchema.parse({ sumMinorFrom: '100', sumMinorTo: '999' });
    expect(p.sumMinorFrom).toBe(100);
    expect(p.sumMinorTo).toBe(999);
  });
  it('accepts relational sortBy values (organization, store, sumMinor)', () => {
    expect(InventoryFilterSchema.parse({ sortBy: 'organization' }).sortBy).toBe('organization');
    expect(InventoryFilterSchema.parse({ sortBy: 'store' }).sortBy).toBe('store');
    expect(InventoryFilterSchema.parse({ sortBy: 'sumMinor' }).sortBy).toBe('sumMinor');
  });
});

describe('UpdateInventorySchema optimistic-lock version token', () => {
  it('requires version on update (a save without it is rejected, not silently unguarded)', () => {
    expect(UpdateInventorySchema.safeParse({}).success).toBe(false);
    expect(UpdateInventorySchema.safeParse({ version: 1 }).success).toBe(true);
  });

  it('rejects a non-integer / negative / string version', () => {
    expect(UpdateInventorySchema.safeParse({ version: 1.5 }).success).toBe(false);
    expect(UpdateInventorySchema.safeParse({ version: -1 }).success).toBe(false);
    expect(UpdateInventorySchema.safeParse({ version: '1' }).success).toBe(false);
  });
});
