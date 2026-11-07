/**
 * Where a provider actually runs.
 *
 * "Local or cloud" is a property of the endpoint, not of the provider's name: an
 * Ollama server can be another machine on the LAN, and a gateway can be a public
 * host. The console shows this next to every answer, so it has to be decided from
 * the base URL the key was configured with, and it has to agree between `/chat`
 * and the stored history — hence one function, used once per turn.
 */

const LOCAL_SUFFIXES = [".local", ".lan", ".internal", ".home.arpa", ".localhost"];

/** Loopback, RFC 1918, CGNAT and link-local are all "this network". */
function isPrivateV4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (octets.some((n) => Number.isNaN(n) || n > 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/**
 * True when `baseUrl` points at loopback, a private address or a `.local`-style
 * name — i.e. a model served on this network rather than by a public cloud API.
 *
 * An unparseable URL is treated as cloud: guessing "local" would put a reassuring
 * label on something unknown.
 */
export function isLocalEndpoint(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host === "") return false;
  if (host === "localhost" || host === "::1" || host === "0.0.0.0") return true;
  if (LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  return isPrivateV4(host);
}
