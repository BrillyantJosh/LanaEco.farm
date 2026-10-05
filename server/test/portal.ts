/**
 * The one test file that differs per portal: this portal's units route, a
 * category it serves and the listing kind it mirrors. Every other server test
 * is the same in all portals.
 */
import { PORTAL_CATEGORIES } from '../routes/listings.js';

export { createEcoUnitsRouter as createUnitsRouter } from '../routes/ecoUnits.js';
export const UNITS_PATH = '/api/eco-units';
export const CATEGORY = [...PORTAL_CATEGORIES][0];
/** The listing kind this portal subscribes to (server/index.ts listingKinds): Producer / Eco Farm. */
export const LISTING_KIND = 36500;
/** This portal's public host (the 36520 `client` its checkout writes, without www.). */
export const PORTAL_HOST = 'lanaeco.farm';
