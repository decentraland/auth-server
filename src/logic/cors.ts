/**
 * Parses the semicolon-separated `CORS_ORIGIN` config into anchored RegExps.
 *
 * Each entry is an operator-provided regular expression (e.g. `^http:\/\/localhost:[0-9]{1,10}$`).
 * We normalize every entry to be ANCHORED (`^…$`) so it matches the Origin exactly: an unanchored
 * regex such as `https://foo\.org` is a substring match, which would let `https://foo.org.evil.com`
 * pass the CORS check. A leading `^` / trailing `$` the operator already supplied is stripped first
 * so we don't double-anchor, and empty entries (e.g. a trailing `;`) are dropped instead of turning
 * into an allow-all regex.
 */
export function parseCorsOrigins(corsOrigin: string): RegExp[] {
  return corsOrigin
    .split(';')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)
    .map(entry => new RegExp(`^${entry.replace(/^\^/, '').replace(/\$$/, '')}$`))
}
