import type { TranslationKey } from '@/i18n/translations';

/**
 * Why a listing cannot be bought here, in the shopper's words. Every
 * listing the server did not call buyable gets one — never a page without a
 * buy button and without a reason. Unknown reasons (and an older server that
 * sends none) get the general text.
 */
export function notBuyableKey(reason: string | null | undefined): TranslationKey {
  switch (reason) {
    case 'online_shop_off': return 'shop.onlineShopOff';
    case 'sold_out': return 'shop.soldOut';
    case 'currency_mismatch': return 'shop.currencyMismatch';
    case 'ordering_unavailable': return 'shop.orderingUnavailable';
    default: return 'shop.notBuyable';
  }
}
