'use client';

/**
 * «TOVAR CHEKI» — tor (termal) savdo cheki shabloni (2026-07-17 talab).
 *
 * Foydalanuvchi ko'rsatgan namuna («Elektro sentr» cheki) tuzilishi:
 *   ┌──────── markazda ────────┐
 *   │  Tashkilot nomi (qalin)  │
 *   │  telefonlar qatori       │
 *   │  Tovar cheki № NNNNN     │
 *   │  от DD.MM.YYYY           │
 *   └──────────────────────────┘
 *   Sotuvchi: ...   Xaridor: ...   Telefon: ...   Izoh: ...
 *   № | Nomi | O'lch. | Soni | Narx | Summa   (to'liq chiziqli jadval)
 *   JAMI: ...
 *
 * Buyurtma (customer-order), jo'natma (demand) va xaridordan qaytarish
 * (sales-return) print sahifalari SHU bitta komponentni ishlatadi — eski A4
 * `PrintDoc` bu hujjatlar uchun almashtirildi (imzo-bloklari, TASHKILOT/
 * KONTRAGENT kartalari «tartibsiz» deb topildi). ThermalShell ichida
 * ishlatiladi: 80mm default, `?w=58` bilan 58mm.
 */

import type { ReceiptPaymentEntry } from '@/lib/pos/receipt-model';
// Formatlash SHU YERDA takrorlanmaydi — kassa cheki (ESC/POS · Electron HTML)
// bilan AYNI funksiyalar. Ilgari bu fayl o'z nusxasini saqlardi va ikkitasi
// jimgina ajralib ketishi mumkin edi (xotira: `ombor-chek-uch-renderer`).
import { fmtQty, fmtReceiptDate, fmtSom } from '@/lib/pos/receipt-model';
import { amountInWords } from '@moysklad/money';
import { useLocale, useTranslations } from 'next-intl';
import React from 'react';

export interface ChekPosition {
  position: number;
  name: string;
  code: string | null;
  uom: string | null;
  quantity: string;
  priceMinor: string;
  /** Qator jami (chegirma hisobga olingan). */
  sumMinor: string;
}

export interface TovarChekProps {
  /** «Tovar cheki» / «Qaytarish cheki» — i18n bilan chaqiruvchi beradi. */
  title: string;
  docNumber: string;
  /** ISO sana — chekda DD.MM.YYYY ko'rinishida chiqadi. */
  docDate: string;
  orgName: string;
  /** Tashkilot telefon(lar)i — vergul bilan bir qatorda chiqadi. */
  orgPhone?: string | null;
  /** Sotuvchi (hujjat egasi/mas'ul xodim). */
  sellerName?: string | null;
  buyerName: string;
  buyerPhone?: string | null;
  comment?: string | null;
  /** Asos hujjat (masalan qaytarish uchun jo'natma raqami) — ixtiyoriy qator. */
  reference?: string | null;
  positions: ChekPosition[];
  totalMinor: string;
  /** Chegirmasiz oraliq jami — farq bo'lsa «Chegirma» qatori chiqadi. */
  subtotalMinor?: string | null;
  /**
   * To'lov qatorlari (naqd · karta · terminal · qarz · qaytim · valyuta).
   *
   * 🔴 Egasining namunasida (chek.png) bu blok YO'Q — u faqat KASSA chekida
   * chiqadi va ataylab: qaytim va qarz qog'ozda ko'rinmasa, nizoni hal
   * qiladigan dalil qolmaydi. Buyurtma/jo'natma cheklari uni bermaydi
   * (`undefined`) ⇒ ular namunaga 1:1 mos qoladi.
   */
  payments?: ReceiptPaymentEntry[];
  /**
   * P05 (2026-08-13, egasi): kontragentli KASSA chekida chekdan keyingi qarz
   * qoldig'i («Sizning qarzingiz»). Faqat `> 0n` bo'lsa chiziladi; `null` =
   * o'lchanmagan (so'rov yiqilgan) — qator yo'q, chek baribir chiqadi.
   * Buyurtma/jo'natma cheklari bermaydi ⇒ namunaga 1:1 mos qoladi.
   */
  debtAfterMinor?: bigint | null;
  /**
   * Qarz to'lovi chekida (2026-08-16) TRUE: «Sizning qarzingiz» 0 bo'lsa HAM
   * chiziladi — «qarz tugadi» nizoni yopadigan dalil. Savdo/buyurtma
   * cheklarida berilmaydi ⇒ eski xulq (0 → qator yo'q) o'zgarmaydi.
   */
  showZeroDebt?: boolean;
  /** Qog'oz eni (mm) — shrift shunga qarab moslashadi. */
  widthMm: number;
}

export function TovarChek({
  title,
  docNumber,
  docDate,
  orgName,
  orgPhone,
  sellerName,
  buyerName,
  buyerPhone,
  comment,
  reference,
  positions,
  totalMinor,
  subtotalMinor,
  payments,
  debtAfterMinor,
  showZeroDebt,
  widthMm,
}: TovarChekProps) {
  const t = useTranslations('pages.print');
  const wordsLocale = useLocale() === 'uz' ? 'uz' : 'ru';
  // 58mm tor lentada shrift bir pog'ona kichikroq (retail-sale cheki bilan bir intizom).
  const fs = widthMm === 58 ? 9 : 11;

  // Chegirma: oraliq jami bilan yakuniy summa farqi (musbat bo'lsagina ko'rsatiladi).
  const discountMinor =
    subtotalMinor != null ? (BigInt(subtotalMinor) - BigInt(totalMinor)).toString() : null;

  const cell: React.CSSProperties = {
    border: '1px solid #000',
    padding: '2px 3px',
    verticalAlign: 'top',
  };
  const num: React.CSSProperties = { ...cell, textAlign: 'right', whiteSpace: 'nowrap' };
  // Namunada USTUN SARLAVHALARI hammasi markazda — qiymatlar esa turlicha
  // (nom/birlik/soni markaz, narx/summa o'ngda). Shuning uchun sarlavha uchun
  // alohida uslub: markaz + nowrap (pul ustuni sarlavhasi ikkiga bo'linmasin).
  const numHead: React.CSSProperties = { ...cell, textAlign: 'center', whiteSpace: 'nowrap' };
  // Nom ustuni o'ralganda (80mm da 3-4 qator bo'ladi) qisqa ustunlar tepada
  // osilib qolmasin — namunada bunday qator yo'q, lekin «tepada» ko'rinishi buzuq.
  const midCell: React.CSSProperties = { ...cell, textAlign: 'center', verticalAlign: 'middle' };
  // № va «Soni» — RAQAM kataklari: hech qachon ikkiga bo'linmaydi. Electron-HTML
  // renderer'ida aynan shu ustunlar 200 ni «20»+«0» qilib sindirgan edi
  // (egasining fotosi, 2026-09-02); shablon bitta bo'lishi uchun bu yerda ham
  // AYNI qoida. `fmtQty` ru-RU guruh ajratgichi bilan chiqadi («2 000») —
  // nowrap'siz u probel joyidan ham sinardi.
  const numCell: React.CSSProperties = { ...midCell, whiteSpace: 'nowrap' };

  return (
    <div
      style={{
        padding: '3mm 2.5mm',
        fontSize: fs,
        lineHeight: 1.3,
        color: '#000',
        // Namuna chek serif (Times) bilan — Courier (ThermalShell default) emas.
        fontFamily: '"Times New Roman", Times, serif',
      }}
      data-test-id="tovar-chek"
    >
      {/* ── Sarlavha: tashkilot + telefonlar + chek raqami + sana (markazda) ── */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: fs + 5 }}>{orgName}</div>
        {orgPhone && <div style={{ fontSize: fs }}>{orgPhone}</div>}
        <div style={{ fontWeight: 700, fontSize: fs + 4, marginTop: 2 }}>
          {title} № {docNumber}
        </div>
        {/* Namunada FAQAT «Sana:» qalin, sananing o'zi oddiy — shuning uchun
            xabar ichida <b> teg turadi va rich-render bilan chiqadi. */}
        <div>
          {t.rich('chek_dated', {
            date: fmtReceiptDate(docDate),
            b: (chunks) => <b>{chunks}</b>,
          })}
        </div>
      </div>

      {/* ── Rekvizit qatorlari — namunada ODDIY qalinlikda (qalin EMAS) ── */}
      <div style={{ marginTop: 4 }}>
        {sellerName && (
          <div>
            {t('chek_seller')}: {sellerName}
          </div>
        )}
        <div>
          {t('chek_buyer')}: {buyerName}
        </div>
        {buyerPhone && (
          <div>
            {t('chek_phone')}: {buyerPhone}
          </div>
        )}
        {/* Izoh bo'sh bo'lsa qator UMUMAN chizilmaydi (2026-08-19): ilgari
            har chekda bo'sh «Izoh:» turardi. */}
        {comment?.trim() && (
          <div>
            {t('chek_comment')}: {comment}
          </div>
        )}
        {reference && (
          <div style={{ fontWeight: 400 }}>
            {t('chek_reference')}: {reference}
          </div>
        )}
      </div>

      {/* ── Pozitsiyalar jadvali — to'liq chiziqli, namunadagi 6 ustun ── */}
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          marginTop: 4,
          fontSize: fs,
        }}
      >
        <thead>
          <tr style={{ fontWeight: 700 }}>
            <td style={{ ...numCell, width: 22 }}>№</td>
            <td style={{ ...cell, textAlign: 'center' }}>{t('chek_col_name')}</td>
            <td style={{ ...cell, width: 24, textAlign: 'center' }}>{t('chek_col_uom')}</td>
            <td style={{ ...numCell, width: 34 }}>{t('chek_col_qty')}</td>
            <td style={{ ...numHead, width: 52 }}>{t('chek_col_price')}</td>
            <td style={{ ...numHead, width: 58 }}>{t('chek_col_sum')}</td>
          </tr>
        </thead>
        <tbody>
          {positions.map((p, i) => (
            <tr key={p.position}>
              <td style={numCell}>{i + 1}</td>
              <td style={{ ...cell, textAlign: 'center', verticalAlign: 'middle' }}>{p.name}</td>
              <td style={midCell}>{p.uom ?? '—'}</td>
              <td style={numCell}>{fmtQty(p.quantity)}</td>
              <td style={{ ...num, verticalAlign: 'middle' }}>{fmtSom(p.priceMinor)}</td>
              <td style={{ ...num, verticalAlign: 'middle' }}>{fmtSom(p.sumMinor)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {/* Egasining namunasi (chek.png, 2026-08-01) UCHALA qatorni ham DOIM
              ko'rsatadi — chegirma 0 bo'lsa ham «Chegirma: 0» chiqadi. Ilgari
              chegirmasiz chekda faqat JAMI qatori chizilardi. */}
          <tr>
            <td colSpan={5} style={{ ...cell, textAlign: 'center', overflowWrap: 'anywhere' }}>
              {t('chek_subtotal')}:
            </td>
            <td style={num}>{fmtSom(subtotalMinor ?? totalMinor)}</td>
          </tr>
          <tr>
            <td colSpan={5} style={{ ...cell, textAlign: 'center', overflowWrap: 'anywhere' }}>
              {t('chek_discount')}:
            </td>
            <td style={num} data-test-id="chek-discount">
              {discountMinor ? fmtSom(discountMinor) : '0'}
            </td>
          </tr>
          <tr style={{ fontWeight: 700, fontSize: fs + 2 }}>
            <td
              colSpan={5}
              style={{ ...cell, textAlign: 'center', fontWeight: 700, overflowWrap: 'anywhere' }}
            >
              {t('chek_total')}:
            </td>
            <td style={num}>{fmtSom(totalMinor)}</td>
          </tr>
          {/* 🔴 KASSA cheki uchun qo'shimcha: to'lov turlari. Namunada yo'q —
              lekin qaytim va qarz qog'ozda ko'rinmasa, mijoz bilan nizoni hal
              qiladigan dalil qolmaydi (izohi `receipt-model.ts` da). Buyurtma/
              jo'natma cheklari `payments` bermaydi ⇒ ular namunaga 1:1 mos. */}
          {(payments ?? []).map((p) => (
            <React.Fragment key={`${p.label}-${p.value}`}>
              <tr data-test-id="chek-payment">
                <td colSpan={5} style={{ ...cell, textAlign: 'center' }}>
                  {p.label}:
                </td>
                <td style={num}>{p.value}</td>
              </tr>
              {p.note && (
                <tr style={{ fontSize: fs - 1 }}>
                  <td colSpan={5} style={{ ...cell, textAlign: 'center' }}>
                    {p.note.left}
                  </td>
                  <td style={num}>{p.note.right}</td>
                </tr>
              )}
            </React.Fragment>
          ))}
          {/* P05 — mijozning qolgan qarzi: to'lov qatorlaridan keyin, xuddi
              shu uslubda. Shart renderer'lar bilan BIR XIL: != null && > 0n;
              qarz to'lovi chekida (showZeroDebt) 0 ham chiziladi. */}
          {debtAfterMinor != null && (debtAfterMinor > 0n || showZeroDebt) && (
            <tr data-test-id="chek-debt-after">
              <td colSpan={5} style={{ ...cell, textAlign: 'center' }}>
                {t('chek_debt_after')}:
              </td>
              <td style={num}>{fmtSom(debtAfterMinor)}</td>
            </tr>
          )}
        </tfoot>
      </table>

      {/* ── Jadval ostidagi ikki qator (namunada bor edi, bizda YO'Q edi) ── */}
      {/* 80mm lenta ~302px — «Raqam bilan» satri uzun bo'lgani uchun o'ralishi
          SHART, aks holda termal printer o'ng chetini qirqib tashlaydi. */}
      <div style={{ marginTop: 8, overflowWrap: 'anywhere' }}>
        <div>
          {t('chek_items_count')}:{' '}
          <b>
            {positions.length} {t('chek_items_unit')}
          </b>
        </div>
        {/* «Raqam bilan» — summa so'z bilan. Chek qog'ozda raqam
            o'zgartirilmasligi uchun yonida so'z bilan ham yoziladi. */}
        <div style={{ marginTop: 2 }}>
          {t('chek_in_words')}: <b>{amountInWords(totalMinor, 'UZS', wordsLocale)}</b>
        </div>
      </div>

      {/* ── Ajratgich + minnatdorchilik (namunadagidek markazda) ── */}
      <div style={{ borderTop: '1px solid #000', margin: '14px 0 8px' }} />
      <div style={{ textAlign: 'center', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
        <div>{t('chek_footer_legal')}</div>
        <div>{t('chek_footer_thanks')}</div>
      </div>
    </div>
  );
}
