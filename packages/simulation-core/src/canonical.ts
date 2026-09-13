/**
 * Canonical JSON: deterministic serialization with recursively sorted object
 * keys. Used to compute SHA-256 input/result hashes that are stable across
 * runtimes and worker completion orders. Presentation-only fields (display
 * names, creation timestamps) must be excluded by callers before hashing.
 */

import { sha256Hex } from "./sha256";

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "number": {
      if (!Number.isFinite(value)) {
        throw new Error(
          `Non-finite number cannot be canonically serialized: ${value}`,
        );
      }
      // Normalize -0 and force the shortest round-trip representation.
      return JSON.stringify(value === 0 ? 0 : value);
    }
    case "boolean":
    case "string":
      return JSON.stringify(value);
    case "undefined":
      throw new Error("undefined is not representable in canonical JSON");
    default:
      break;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      throw new Error("Only plain JSON objects are supported");
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const entries = keys.map((key) => {
      const v = obj[key];
      if (v === undefined)
        throw new Error(`undefined value at key ${JSON.stringify(key)}`);
      return `${JSON.stringify(key)}:${canonicalJson(v)}`;
    });
    return `{${entries.join(",")}}`;
  }
  throw new Error(`Unsupported value type in canonical JSON: ${typeof value}`);
}

export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
