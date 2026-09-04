import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CountSessionService } from './count-session.service.js';

/**
 * Sanash sessiyasi servisi (N-reja §5-N2) — soxta Prisma klienti ustida.
 *
 * Fake HAR qoldiq yozuvini ham ro'yxatga oladi (`stockTouches`): N-reja §3
 * qoida 3 («ikki karra qo'llash — qizil chiziq») ga DALIL shu — iz qatlami
 * `stock` / `stock_by_cell` ga BIRORTA bayt yozmaydi.
 */

const ACC = 'acc-1';
const USER = 'user-1';
// 🔴 Haqiqiy UUID: `OpenCountSessionSchema` `storeId` ni `uuid()` bilan
// tekshiradi — soxta `'store-1'` bilan har test 400 da to'xtardi.
const STORE = '11111111-1111-4111-8111-111111111111';
const STORE_2 = '22222222-2222-4222-8222-222222222222';

interface SessionRow {
  id: string;
  name: string;
  storeId: string;
  state: string;
  countSession: boolean;
  countedBy: string | null;
  closedAt: Date | null;
  confirmedBy: string | null;
  confirmedAt: Date | null;
  moment: Date;
  createdAt: Date;
  deletedAt: Date | null;
}

function session(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: 'inv-1',
    name: '00042',
    storeId: STORE,
    state: 'draft',
    countSession: true,
    countedBy: USER,
    closedAt: null,
    confirmedBy: null,
    confirmedAt: null,
    moment: new Date('2026-09-05T06:00:00Z'),
    createdAt: new Date('2026-09-05T06:00:00Z'),
    deletedAt: null,
    ...over,
  };
}

function makeService(opts?: {
  existing?: SessionRow | null;
  lines?: Array<{ cellId: string | null; varianceQty: string }>;
  noStore?: boolean;
  noOrg?: boolean;
  /** `inventoryPosition.create` shu xato bilan yiqiladi. */
  createLineThrows?: Error;
  maxPosition?: number | null;
}) {
  const created: Array<Record<string, unknown>> = [];
  const positions: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  /** 🔴 Qoldiqqa har qanday tegish — bu ro'yxatga tushadi. Bo'sh qolishi SHART. */
  const stockTouches: string[] = [];
  const stockSpy = (label: string) =>
    vi.fn(async () => {
      stockTouches.push(label);
      return {};
    });

  let existing = opts?.existing === undefined ? null : opts.existing;

  /**
   * 🔴 Fake `select` ni HURMAT QILADI — haqiqiy Prisma kabi qatorni oq
   * ro'yxatga PROYEKSIYA qiladi (`sumMinor` kabi so'ralmagan ustun javobga
   * TUSHMAYDI). Busiz «javobda narx yo'q» da'vosi soxta bo'lardi: fake to'liq
   * qatorni qaytarardi va test hech narsani isbotlamasdi.
   *
   * Baza qatori ATAYLAB `select` da yo'q maydonlarni ham saqlaydi
   * (`deletedAt`, va bu yerda soxta `sumMinor`) — proyeksiya haqiqatda
   * kesayotganini ko'rish uchun.
   */
  const project = <T extends Record<string, unknown>>(
    row: T | null,
    select?: Record<string, boolean>,
  ) => {
    if (!row) return null;
    const full = { ...row, sumMinor: 123456n } as Record<string, unknown>;
    if (!select) return full;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(select)) out[key] = full[key];
    return out;
  };

  const client = {
    store: {
      findFirst: vi.fn(async () => (opts?.noStore ? null : { id: STORE })),
    },
    organization: {
      findFirst: vi.fn(async () => (opts?.noOrg ? null : { id: 'org-1' })),
    },
    employee: {
      findUnique: vi.fn(async () => ({ groupId: 'grp-1', accountId: ACC })),
    },
    documentSequence: {
      findUnique: vi.fn(async () => ({ value: 41 })),
      createMany: vi.fn(async () => ({ count: 0 })),
      update: vi.fn(async () => ({ value: 42 })),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    inventory: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async (args?: { select?: Record<string, boolean> }) =>
        project(existing, args?.select),
      ),
      create: vi.fn(
        async (args: { data: Record<string, unknown>; select?: Record<string, boolean> }) => {
          created.push(args.data);
          existing = session({
            id: 'inv-new',
            name: String(args.data.name),
            storeId: String(args.data.storeId),
            countedBy: String(args.data.countedBy),
          });
          return project(existing, args.select);
        },
      ),
      update: vi.fn(
        async (args: { data: Record<string, unknown>; select?: Record<string, boolean> }) => {
          updates.push(args.data);
          return project(
            session({ ...(existing ?? session()), ...(args.data as Partial<SessionRow>) }),
            args.select,
          );
        },
      ),
    },
    inventoryPosition: {
      findMany: vi.fn(async () => opts?.lines ?? []),
      aggregate: vi.fn(async () => ({ _max: { position: opts?.maxPosition ?? null } })),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        if (opts?.createLineThrows) throw opts.createLineThrows;
        positions.push(args.data);
        return args.data;
      }),
      // 🔴 Ilgak APPEND qiladi: bularning birortasi ham chaqirilmasligi kerak.
      deleteMany: vi.fn(async () => {
        stockTouches.push('inventoryPosition.deleteMany');
        return { count: 0 };
      }),
      updateMany: vi.fn(async () => {
        stockTouches.push('inventoryPosition.updateMany');
        return { count: 0 };
      }),
    },
    stock: { upsert: stockSpy('stock.upsert'), update: stockSpy('stock.update') },
    stockByCell: {
      upsert: stockSpy('stockByCell.upsert'),
      update: stockSpy('stockByCell.update'),
      deleteMany: stockSpy('stockByCell.deleteMany'),
    },
    stockOperation: { createMany: stockSpy('stockOperation.createMany') },
  };
  const svc = new CountSessionService({ client } as never);
  return { svc, client, created, positions, updates, stockTouches };
}

describe('open — «Sanashni boshlash»', () => {
  it('sessiya yo`q bo`lsa YANGI hujjat ochadi: bayroq, omborchi, ketma-ketlik raqami', async () => {
    const { svc, created } = makeService();
    const res = await svc.open(ACC, USER, { storeId: STORE });

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      accountId: ACC,
      storeId: STORE,
      state: 'draft',
      // 🔴 HAQIQIY ustunlar (§2.2) — `attributes` ga hech narsa yozilmaydi.
      countSession: true,
      countedBy: USER,
      organizationId: 'org-1',
    });
    expect('attributes' in created[0]).toBe(false);
    // Mavjud `Inventory` ketma-ketligi: 41 → 42, 5 xonali.
    expect(created[0].name).toBe('00042');
    expect(res.counters).toEqual({
      cellCount: 0,
      lineCount: 0,
      surplusLines: 0,
      shortageLines: 0,
    });
  });

  it('🔴 IDEMPOTENT — shu omborda ochiq sessiya bo`lsa YANGI hujjat ochilmaydi', async () => {
    const { svc, created, client } = makeService({
      existing: session({ id: 'inv-open' }),
      lines: [{ cellId: 'cell-1', varianceQty: '5' }],
    });
    const res = await svc.open(ACC, USER, { storeId: STORE });

    expect(client.inventory.create).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
    expect(res.id).toBe('inv-open');
    expect(res.counters.lineCount).toBe(1);
  });

  it('boshqa omborda ochiq sessiya bo`lsa 400 — jimgina almashtirilmaydi', async () => {
    const { svc, client } = makeService({
      existing: session({ id: 'inv-open', storeId: STORE_2, name: '00007' }),
    });
    await expect(svc.open(ACC, USER, { storeId: STORE })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(svc.open(ACC, USER, { storeId: STORE })).rejects.toThrow('00007');
    expect(client.inventory.create).not.toHaveBeenCalled();
  });

  it('begona/mavjud bo`lmagan ombor — 404', async () => {
    const { svc } = makeService({ noStore: true });
    await expect(svc.open(ACC, USER, { storeId: STORE })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('noto`g`ri tana — 400', async () => {
    const { svc } = makeService();
    await expect(svc.open(ACC, USER, { storeId: 'not-a-uuid' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(svc.open(ACC, USER, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('🔴 qoldiqqa BIRORTA bayt yozilmaydi', async () => {
    const { svc, stockTouches } = makeService();
    await svc.open(ACC, USER, { storeId: STORE });
    expect(stockTouches).toEqual([]);
  });
});

describe('active — ochiq sessiya va hisoblagichlar', () => {
  it('sessiya bo`lmasa `{ session: null }`', async () => {
    const { svc } = makeService();
    expect(await svc.active(ACC, USER)).toEqual({ session: null });
  });

  it('hisoblagichlar qatorlardan yig`iladi (narx yo`q)', async () => {
    const { svc } = makeService({
      existing: session(),
      lines: [
        { cellId: 'cell-1', varianceQty: '5' },
        { cellId: 'cell-1', varianceQty: '0' },
        { cellId: 'cell-2', varianceQty: '-3' },
      ],
    });
    const { session: s } = await svc.active(ACC, USER);
    expect(s?.counters).toEqual({
      cellCount: 2,
      lineCount: 3,
      surplusLines: 1,
      shortageLines: 1,
    });
    // Javobda pul maydoni yo'q (oq ro'yxat `count-session.test.ts` da qulflangan).
    expect(Object.keys(s ?? {})).not.toContain('sumMinor');
  });
});

describe('🔴 javob shakli — narx yo`qligining YOZMA isboti', () => {
  it('`open` javobining kalitlari AYNAN shu ro`yxat (pul maydoni yo`q)', async () => {
    const { svc } = makeService();
    const res = await svc.open(ACC, USER, { storeId: STORE });
    expect(Object.keys(res).sort()).toEqual(
      [
        'id',
        'name',
        'storeId',
        'state',
        'countSession',
        'countedBy',
        'closedAt',
        'confirmedBy',
        'confirmedAt',
        'moment',
        'createdAt',
        'counters',
      ].sort(),
    );
    expect(Object.keys(res.counters).sort()).toEqual(
      ['cellCount', 'lineCount', 'shortageLines', 'surplusLines'].sort(),
    );
    // «Ekranda ko'rsatmayapmiz» ISBOT EMAS: maydonning O'ZI yo'qligini
    // tekshiramiz — Prisma `select` oq ro'yxati buni ta'minlaydi.
    // Fake baza qatorida `sumMinor` BOR (yuqoridagi `project` uni qo'shadi),
    // lekin `select` uni so'ramaydi ⇒ javobga tushmaydi.
    for (const banned of ['sumMinor', 'costMinor', 'buyPrice', 'salePrices', 'attributes']) {
      expect(banned in res).toBe(false);
    }
  });

  it('`active` va `close` javoblari AYNI shakl beradi', async () => {
    const { svc } = makeService({ existing: session() });
    const activeRes = await svc.active(ACC, USER);
    const closeRes = await svc.close(ACC, USER, 'inv-1');
    expect(Object.keys(activeRes.session ?? {}).sort()).toEqual(Object.keys(closeRes).sort());
    expect('sumMinor' in closeRes).toBe(false);
  });
});

describe('close — «Yopish»', () => {
  it('🔴 `closedAt` + `state = counted` yoziladi, `posted` EMAS', async () => {
    const { svc, updates } = makeService({ existing: session() });
    await svc.close(ACC, USER, 'inv-1');
    expect(updates).toHaveLength(1);
    expect(updates[0].state).toBe('counted');
    expect(updates[0].closedAt).toBeInstanceOf(Date);
  });

  it('🔴 yopish QOLDIQQA tegmaydi', async () => {
    const { svc, stockTouches } = makeService({
      existing: session(),
      lines: [{ cellId: 'cell-1', varianceQty: '-7' }],
    });
    await svc.close(ACC, USER, 'inv-1');
    expect(stockTouches).toEqual([]);
  });

  it('allaqachon yopilgan sessiya — o`zgartirilmasdan qaytadi (takroriy so`rov)', async () => {
    const closedAt = new Date('2026-09-05T07:00:00Z');
    const { svc, client, updates } = makeService({
      existing: session({ state: 'counted', closedAt }),
    });
    const res = await svc.close(ACC, USER, 'inv-1');
    expect(client.inventory.update).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
    expect(res.closedAt).toBe(closedAt);
  });

  it('boshqa omborchining sessiyasi — 403', async () => {
    const { svc, client } = makeService({ existing: session({ countedBy: 'user-2' }) });
    await expect(svc.close(ACC, USER, 'inv-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(client.inventory.update).not.toHaveBeenCalled();
  });

  it('topilmasa — 404', async () => {
    const { svc } = makeService({ existing: null });
    await expect(svc.close(ACC, USER, 'yo-q')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('recordCount — `setCellStock` ilgagi', () => {
  const call = {
    accountId: ACC,
    userId: USER,
    storeId: STORE,
    cellId: 'cell-1',
    cellName: '02-01-01-04',
    assortmentId: 'prod-1',
  };

  it('🔴 APPEND: `create` chaqiriladi, `deleteMany`/`updateMany` HECH QACHON', async () => {
    const { svc, client, positions } = makeService({ existing: session() });
    const res = await svc.recordCount({
      ...call,
      expectedQty: '26',
      actualQty: '126',
      varianceQty: '100',
      autoDoc: { type: 'enter', id: 'ent-1', name: '00042' },
    });
    expect(res).toEqual({ recorded: true });
    expect(positions).toHaveLength(1);
    expect(client.inventoryPosition.deleteMany).not.toHaveBeenCalled();
    expect(client.inventoryPosition.updateMany).not.toHaveBeenCalled();
    expect(client.inventory.update).not.toHaveBeenCalled();
  });

  it('qator mazmuni: mutlaq sonlar, ishorali farq, avto-hujjat izi, narx YO`Q', async () => {
    const { svc, positions } = makeService({ existing: session(), maxPosition: 4 });
    await svc.recordCount({
      ...call,
      expectedQty: '26',
      actualQty: '126',
      varianceQty: '100',
      autoDoc: { type: 'enter', id: 'ent-1', name: '00042' },
    });
    expect(positions[0]).toMatchObject({
      inventoryId: 'inv-1',
      position: 5,
      cellId: 'cell-1',
      cell: '02-01-01-04',
      assortmentId: 'prod-1',
      expectedQty: '26',
      actualQty: '126',
      varianceQty: '100',
      autoDocType: 'enter',
      autoDocId: 'ent-1',
      autoDocName: '00042',
    });
    expect('costMinor' in positions[0]).toBe(false);
  });

  it('birinchi qator — tartib 1 dan boshlanadi', async () => {
    const { svc, positions } = makeService({ existing: session(), maxPosition: null });
    await svc.recordCount({
      ...call,
      expectedQty: '0',
      actualQty: '3',
      varianceQty: '3',
      autoDoc: null,
    });
    expect(positions[0].position).toBe(1);
  });

  it('K5 — `pieceEntry` berilsa qatorga ko`chiriladi', async () => {
    const { svc, positions } = makeService({ existing: session() });
    await svc.recordCount({
      ...call,
      expectedQty: '0',
      actualQty: '3',
      varianceQty: '3',
      pieceEntry: '250x3',
      autoDoc: null,
    });
    expect(positions[0].pieceEntry).toBe('250x3');
  });

  it('🔴 ochiq sessiya YO`Q — hech narsa yozilmaydi va xato ham yo`q (orqaga moslik)', async () => {
    const { svc, client, positions } = makeService({ existing: null });
    const res = await svc.recordCount({
      ...call,
      expectedQty: '26',
      actualQty: '126',
      varianceQty: '100',
      autoDoc: null,
    });
    expect(res).toEqual({ recorded: false });
    expect(positions).toHaveLength(0);
    expect(client.inventoryPosition.create).not.toHaveBeenCalled();
  });

  it('🔴 yozuv XATO bersa ham metod XATO CHIQARMAYDI (sanoq bloklanmasin)', async () => {
    const { svc } = makeService({
      existing: session(),
      createLineThrows: new Error('baza yiqildi'),
    });
    await expect(
      svc.recordCount({
        ...call,
        expectedQty: '26',
        actualQty: '126',
        varianceQty: '100',
        autoDoc: null,
      }),
    ).resolves.toEqual({ recorded: false });
  });

  it('🔴 iz yozish QOLDIQQA tegmaydi', async () => {
    const { svc, stockTouches } = makeService({ existing: session() });
    await svc.recordCount({
      ...call,
      expectedQty: '40',
      actualQty: '25',
      varianceQty: '-15',
      autoDoc: { type: 'loss', id: 'los-1', name: '00099' },
    });
    expect(stockTouches).toEqual([]);
  });

  it('sessiya qidiruvi omborchi + OMBOR + ochiqlik bo`yicha filtrlanadi', async () => {
    const { svc, client } = makeService({ existing: session() });
    await svc.recordCount({
      ...call,
      expectedQty: '1',
      actualQty: '1',
      varianceQty: '0',
      autoDoc: null,
    });
    const where = (client.inventory.findFirst.mock.calls[0]?.[0] as { where: unknown }).where;
    expect(where).toMatchObject({
      accountId: ACC,
      countSession: true,
      countedBy: USER,
      storeId: STORE,
      closedAt: null,
      deletedAt: null,
    });
  });
});

describe('🔴 manba intizomi — iz qatlami qoldiq so`zlarini BILMAYDI', () => {
  it('`count-session.service.ts` da `applyDeltas` / `stockByCell` umuman yo`q', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('./count-session.service.ts', import.meta.url), 'utf8');
    // K-reja naqshi: manba matnini o'qib tekshirish. Kod qoldiqqa
    // tegmasligi kerak — bu «hozircha tegmayapti» dan kuchliroq shartnoma.
    for (const forbidden of ['applyDeltas', 'stockByCell', 'stockOperation', '$executeRaw']) {
      expect(src).not.toContain(forbidden);
    }
  });
});
