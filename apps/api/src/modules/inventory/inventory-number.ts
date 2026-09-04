import type { Prisma } from '@moysklad/db';
import { allocateDocumentNumber } from '../../prisma/document-number.js';

/** Raqam ajratish uchun yetarli bo'lgan minimal klient. */
type InventoryNumberClient = Pick<Prisma.TransactionClient, 'documentSequence' | 'inventory'>;

/**
 * Inventarizatsiya hujjatining keyingi «Номер» i — YAGONA manba.
 *
 * N-reja §5-N2: sanash sessiyasi ham AYNI ketma-ketlikdan raqam oladi, ya'ni
 * TSD ochgan sessiya web'dagi ro'yxatda tabiiy o'rinda turadi. Mantiq shu
 * sababdan `InventoryService` ning private metodidan shu yerga ko'chirildi:
 * nusxalansa ikkita hisoblagich paydo bo'lardi va ikki hujjat bir xil nom
 * bilan yaratilib `(account_id, name)` unikaliga urilardi.
 *
 * moysklad-parity: prefikssiz, 5 xonali nol bilan to'ldirilgan raqam. Seed —
 * mavjud nomlardagi eng katta OXIRGI son (eski prefiksli nomlar ham hisobga
 * olinadi) ⇒ ketma-ketlik uzilmaydi.
 */
export async function nextInventoryName(
  client: InventoryNumberClient,
  accountId: string,
): Promise<string> {
  const n = await allocateDocumentNumber(client, accountId, 'inventory', async () => {
    const rows = await client.inventory.findMany({ where: { accountId }, select: { name: true } });
    let max = 0;
    for (const r of rows) {
      const m = r.name.match(/\d+$/);
      if (m) max = Math.max(max, Number.parseInt(m[0], 10) || 0);
    }
    return max;
  });
  return String(n).padStart(5, '0');
}
