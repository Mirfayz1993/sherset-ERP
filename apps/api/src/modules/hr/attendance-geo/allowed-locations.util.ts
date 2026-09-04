import type { PrismaService } from '../../../prisma/prisma.service.js';
import { type GeoLocation, type GeoPing, isInsideGeofence } from './geofence.util.js';
import { haversineMeters } from './haversine.util.js';

/**
 * X8 — geofence xodimga BIRIKTIRILGAN hamma ish joyiga solishtiriladi.
 *
 * Ilgari ikkala check-in yo'li (`ingest()` va `manualCheckIn()`) faqat
 * `Employee.workLocationId` — bitta asosiy filialga qarardi. Kompaniyada 7+
 * ombor bor: boshqa omborga ish bilan borgan xodim «Keldim» bosganda
 * `outside` olardi va o'sha kun oylik tarixda «kelmadi» bo'lib qolardi.
 *
 * 🔴 XAVFSIZLIK CHEGARASI — muhokama qilinmaydi: ruxsat etilgan joylar
 * xodimga BIRIKTIRILGAN bo'lishi shart (asosiy `workLocationId` +
 * `HrEmployeeBranch` qatorlari). «Akkauntning hamma ish joylari» yechimi
 * TAQIQLANGAN: uyi biror ombor radiusiga tushadigan xodim uydan «keldim»
 * bosib qo'yardi, ya'ni geofence ma'nosini yo'qotardi.
 */
export interface AllowedLocation extends GeoLocation {
  id: string;
}

/** Geofence'ga tushgan joy + undan masofa (eng yaqini tanlanadi). */
export interface LocationMatch {
  location: AllowedLocation;
  distanceMeters: number;
}

const LOCATION_SELECT = { id: true, lat: true, lng: true, radiusMeters: true } as const;

/**
 * Xodimga biriktirilgan, ARXIVLANMAGAN ish joylari — asosiy filial
 * (`Employee.workLocationId`) + `HrEmployeeBranch` dagi qo'shimcha filiallar.
 *
 * Bitta so'rov: `accountId` va `archived: false` — HAR IKKALA tarmoq uchun
 * umumiy AND shart, ya'ni boshqa akkauntning joyi (yoki begona akkauntdagi
 * biriktiruv qatori) natijaga HECH QACHON tusha olmaydi.
 *
 * `primaryWorkLocationId` chaqiruvchidan olinadi — u xodim qatorini
 * allaqachon o'qigan (`CHECKIN_EMPLOYEE_SELECT`), shu sababli bu yerda
 * ikkinchi `employee` so'rovi qilinmaydi.
 */
export async function resolveAllowedLocations(
  prisma: PrismaService,
  accountId: string,
  employeeId: string,
  primaryWorkLocationId: string | null,
): Promise<AllowedLocation[]> {
  const assigned: {
    id?: string;
    branchEmployees?: { some: { employeeId: string; accountId: string } };
  }[] = [{ branchEmployees: { some: { employeeId, accountId } } }];
  if (primaryWorkLocationId) assigned.unshift({ id: primaryWorkLocationId });

  return prisma.client.hrWorkLocation.findMany({
    where: { accountId, archived: false, OR: assigned },
    select: LOCATION_SELECT,
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Ruxsat etilgan joylardan geofence'ga TUSHGANLARIDAN eng yaqini.
 * Hech biriga tushmasa — `null` (chaqiruvchida `outside`, xulq o'zgarmaydi).
 *
 * Eng yaqinini tanlash sababi: ikki filialning radiusi ustma-ust tushsa
 * yozuvga qaysi biri yozilishi TASODIFGA qolmasin — aks holda menejer
 * paneli xodimni goh u, goh bu filialda ko'rsatardi.
 */
export function pickInsideLocation(
  ping: GeoPing,
  locations: readonly AllowedLocation[],
): LocationMatch | null {
  let best: LocationMatch | null = null;
  for (const location of locations) {
    if (!isInsideGeofence(ping, location)) continue;
    const distanceMeters = haversineMeters(ping, location);
    if (!best || distanceMeters < best.distanceMeters) best = { location, distanceMeters };
  }
  return best;
}
