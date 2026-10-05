/**
 * The one test file that differs per portal: this portal's units route and a
 * category it serves. Every other server test is the same in all portals.
 */
import { PORTAL_CATEGORIES } from '../routes/listings.js';

export { createEcoUnitsRouter as createUnitsRouter } from '../routes/ecoUnits.js';
export const UNITS_PATH = '/api/eco-units';
export const CATEGORY = [...PORTAL_CATEGORIES][0];
