import { describe, expect, it, vi } from 'vitest';
import {
  type AllowedLocation,
  pickInsideLocation,
  resolveAllowedLocations,
} from './allowed-locations.util.js';

/** Asosiy filial (Toshkent, Chilonzor atrofi) — radius 150 m. */
const MAIN: AllowedLocation = { id: 'wl-main', lat: 41.311, lng: 69.24, radiusMeters: 150 };
/** Qo'shimcha filial — ~4,3 km shimolda, ya'ni MAIN radiusidan ANCHA tashqarida. */
const BRANCH: AllowedLocation = { id: 'wl-branch', lat: 41.35, lng: 69.24, radiusMeters: 150 };

const at = (loc: AllowedLocation, accuracy = 10) => ({
  lat: loc.lat,
  lng: loc.lng,
  accuracy,
});

function makePrisma(rows: AllowedLocation[]) {
  return {
    client: { hrWorkLocation: { findMany: vi.fn().mockResolvedValue(rows) } },
  };
}

/** `findMany` ga ketgan yagona argument. */
function whereOf(prisma: ReturnType<typeof makePrisma>) {
  const arg = prisma.client.hrWorkLocation.findMany.mock.calls[0]?.[0] as {
    where: {
      accountId: string;
      archived: boolean;
      OR: { id?: string; branchEmployees?: { some: { employeeId: string; accountId: string } } }[];
    };
  };
  return arg.where;
}

describe('resolveAllowedLocations — so`rov chegaralari', () => {
  it('asosiy filial VA `HrEmployeeBranch` qatorlari — bitta so`rovda (OR)', async () => {
    const prisma = makePrisma([MAIN, BRANCH]);
    const rows = await resolveAllowedLocations(prisma as never, 'acc', 'emp', 'wl-main');

    expect(rows).toEqual([MAIN, BRANCH]);
    const where = whereOf(prisma);
    expect(where.OR).toEqual([
      { id: 'wl-main' },
      { branchEmployees: { some: { employeeId: 'emp', accountId: 'acc' } } },
    ]);
  });

  it('🔴 ARXIVLANGAN joy hisobga OLINMAYDI (`archived: false` so`rovda)', async () => {
    const prisma = makePrisma([MAIN]);
    await resolveAllowedLocations(prisma as never, 'acc', 'emp', 'wl-main');
    expect(whereOf(prisma).archived).toBe(false);
  });

  it('🔴 BOSHQA akkauntning joyi hech qachon kelmaydi (`accountId` AND shart)', async () => {
    const prisma = makePrisma([MAIN]);
    await resolveAllowedLocations(prisma as never, 'acc', 'emp', 'wl-main');
    const where = whereOf(prisma);

    // `accountId` va `archived` — OR ning ICHIDA emas, TASHQARISIDA: ya'ni
    // ikkala tarmoqqa ham (asosiy filial ham, biriktiruv ham) qo'llanadi.
    expect(where.accountId).toBe('acc');
    // Biriktiruv qatorining O'ZI ham akkaunt bilan chegaralangan (ikki qavat).
    expect(where.OR[1]?.branchEmployees?.some.accountId).toBe('acc');
    // Kalitlar qat'iy: kelajakda so'rovga yangi tarmoq qo'shilsa test yiqiladi.
    expect(Object.keys(where).sort()).toEqual(['OR', 'accountId', 'archived']);
  });

  it('🔴 «akkauntning hamma joylari» EMAS: asosiy filial yo`q bo`lsa ham OR faqat biriktiruv', async () => {
    const prisma = makePrisma([BRANCH]);
    const rows = await resolveAllowedLocations(prisma as never, 'acc', 'emp', null);

    expect(rows).toEqual([BRANCH]);
    // Asosiy filial null ⇒ `{ id: null }` kabi hamma joyni ochadigan tarmoq
    // YARATILMAYDI; biriktirilgan joylar ro'yxati qoladi.
    expect(whereOf(prisma).OR).toEqual([
      { branchEmployees: { some: { employeeId: 'emp', accountId: 'acc' } } },
    ]);
  });

  it('biriktirilgan joy umuman yo`q — bo`sh ro`yxat', async () => {
    const prisma = makePrisma([]);
    expect(await resolveAllowedLocations(prisma as never, 'acc', 'emp', null)).toEqual([]);
  });
});

describe('pickInsideLocation', () => {
  it('asosiy joyda — `inside`, mos kelgan joy asosiy filial', () => {
    expect(pickInsideLocation(at(MAIN), [MAIN, BRANCH])?.location.id).toBe('wl-main');
  });

  it('qo`shimcha filialda — `inside`, mos kelgan joy AYNAN o`sha filial', () => {
    expect(pickInsideLocation(at(BRANCH), [MAIN, BRANCH])?.location.id).toBe('wl-branch');
  });

  it('begona nuqtada — null (chaqiruvchida `outside`)', () => {
    expect(pickInsideLocation({ lat: 41.5, lng: 69.9, accuracy: 10 }, [MAIN, BRANCH])).toBeNull();
  });

  it('bo`sh ro`yxatda — null', () => {
    expect(pickInsideLocation(at(MAIN), [])).toBeNull();
  });

  it('radiuslar ustma-ust tushsa — ENG YAQINI (tasodifga qolmaydi)', () => {
    const wide: AllowedLocation = { id: 'wl-wide', lat: 41.315, lng: 69.24, radiusMeters: 2000 };
    // Nuqta ikkalasining ham ichida: MAIN 0 m, wide ~445 m ⇒ MAIN yutadi.
    const point = at(MAIN);
    expect(pickInsideLocation(point, [wide, MAIN])?.location.id).toBe('wl-main');
    // Ro'yxat tartibi natijani O'ZGARTIRMAYDI.
    expect(pickInsideLocation(point, [MAIN, wide])?.location.id).toBe('wl-main');
  });

  it('masofa qaytariladi (X9 dagi «ish joyidan uzoqlik» uchun tayyor)', () => {
    const m = pickInsideLocation(at(MAIN), [MAIN]);
    expect(m?.distanceMeters).toBeCloseTo(0, 5);
  });

  it('aniqlik chegarasi geofence util`iga qoldirilgan (radius + min(accuracy,50))', () => {
    // MAIN dan ~180 m: radius 150 ⇒ aniqlik 10 bilan TASHQARIDA, 50 bilan ICHKARIDA.
    const near = { lat: 41.3126, lng: 69.24 };
    expect(pickInsideLocation({ ...near, accuracy: 10 }, [MAIN])).toBeNull();
    expect(pickInsideLocation({ ...near, accuracy: 50 }, [MAIN])?.location.id).toBe('wl-main');
  });
});
