/**
 * Who counts as an operator's staff: a staff-kind login that is NOT a travel
 * agent's login and NOT a crew member's (driver / conductor) app login. Those
 * two are external or field people with their own screens and their own narrow
 * roles (agent:portal, crew:app) — they must never show up on the staff list,
 * use up the plan's staff quota, or be handed operator roles through the staff
 * endpoints.
 *
 * `u` is the alias of the users table in the query.
 */
export const IS_STAFF = (u = 'u') =>
  `${u}.kind = 'staff'
   AND NOT EXISTS (SELECT 1 FROM agents ag WHERE ag.user_id = ${u}.id)
   AND NOT EXISTS (SELECT 1 FROM crew cr WHERE cr.user_id = ${u}.id)`;
