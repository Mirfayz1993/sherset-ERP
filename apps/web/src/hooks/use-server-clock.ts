'use client';

/**
 * Serverga tekislangan «tirik» soat (S-reja S1).
 *
 * `null` dan boshlanadi va faqat mount'dan KEYIN to'ladi — server-render
 * paytida chizilgan soat brauzerdagisiga mos kelmasligi mumkin va React
 * gidratatsiya nomuvofiqligi haqida ogohlantirardi. Mijoz-ekrani shu
 * qarorni allaqachon qo'lda qilgan edi (`customer-display/page.tsx`);
 * endi u hamma joyda bitta joyda turadi.
 *
 * Qadam minut boshiga TEKISLANMAYDI — 30 s qadamda eng ko'p yarim minut
 * kechikadi, kod esa sodda qoladi (`pos-header` dagi eski qaror saqlanadi).
 */

import { serverNow } from '@/lib/clock';
import { useEffect, useState } from 'react';

export function useServerClock(stepMs = 30_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(serverNow());
    const id = setInterval(() => setNow(serverNow()), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);

  return now;
}
