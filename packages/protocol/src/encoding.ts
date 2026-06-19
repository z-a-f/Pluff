const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function utf8ToBytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

export function bytesToUtf8(value: Uint8Array): string {
  return textDecoder.decode(value);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let output = "";
  let index = 0;

  for (; index + 2 < bytes.length; index += 3) {
    const value = (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2];
    output += BASE64URL_ALPHABET[(value >> 18) & 63];
    output += BASE64URL_ALPHABET[(value >> 12) & 63];
    output += BASE64URL_ALPHABET[(value >> 6) & 63];
    output += BASE64URL_ALPHABET[value & 63];
  }

  const remaining = bytes.length - index;
  if (remaining === 1) {
    const value = bytes[index] << 16;
    output += BASE64URL_ALPHABET[(value >> 18) & 63];
    output += BASE64URL_ALPHABET[(value >> 12) & 63];
  } else if (remaining === 2) {
    const value = (bytes[index] << 16) | (bytes[index + 1] << 8);
    output += BASE64URL_ALPHABET[(value >> 18) & 63];
    output += BASE64URL_ALPHABET[(value >> 12) & 63];
    output += BASE64URL_ALPHABET[(value >> 6) & 63];
  }

  return output;
}

export function base64UrlToBytes(value: string): Uint8Array {
  const clean = value.replace(/=/g, "");
  if (clean.length % 4 === 1) {
    throw new Error("Invalid base64url length");
  }

  const bytes: number[] = [];
  for (let index = 0; index < clean.length; index += 4) {
    const chunk = clean.slice(index, index + 4);
    let bits = 0;
    let validChars = 0;

    for (const char of chunk) {
      const valueIndex = BASE64URL_ALPHABET.indexOf(char);
      if (valueIndex === -1) {
        throw new Error("Invalid base64url character");
      }
      bits = (bits << 6) | valueIndex;
      validChars += 1;
    }

    bits <<= (4 - validChars) * 6;
    if (validChars >= 2) {
      bytes.push((bits >> 16) & 255);
    }
    if (validChars >= 3) {
      bytes.push((bits >> 8) & 255);
    }
    if (validChars >= 4) {
      bytes.push(bits & 255);
    }
  }

  const result = new Uint8Array(bytes);
  // Reject non-canonical encodings (e.g. non-zero trailing bits) so a value has
  // exactly one valid string form. This removes a malleability surface.
  if (bytesToBase64Url(result) !== clean) {
    throw new Error("Non-canonical base64url encoding");
  }
  return result;
}

export function bytesToBase58Btc(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return "";
  }

  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let digitIndex = 0; digitIndex < digits.length; digitIndex += 1) {
      carry += digits[digitIndex] << 8;
      digits[digitIndex] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let output = "";
  for (const byte of bytes) {
    if (byte !== 0) {
      break;
    }
    output += BASE58_ALPHABET[0];
  }

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    output += BASE58_ALPHABET[digits[index]];
  }
  return output;
}

export function base58BtcToBytes(value: string): Uint8Array {
  if (value.length === 0) {
    return new Uint8Array();
  }

  const bytes = [0];
  for (const char of value) {
    const alphabetIndex = BASE58_ALPHABET.indexOf(char);
    if (alphabetIndex === -1) {
      throw new Error("Invalid base58btc character");
    }

    let carry = alphabetIndex;
    for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) {
      carry += bytes[byteIndex] * 58;
      bytes[byteIndex] = carry & 255;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 255);
      carry >>= 8;
    }
  }

  for (const char of value) {
    if (char !== BASE58_ALPHABET[0]) {
      break;
    }
    bytes.push(0);
  }

  return new Uint8Array(bytes.reverse());
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`)
    .join(",")}}`;
}

export function randomBytes(length: number): Uint8Array {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error("Secure random source is unavailable");
  }
  const output = new Uint8Array(length);
  cryptoApi.getRandomValues(output);
  return output;
}

export function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

export function idWithPrefix(prefix: string): string {
  return `${prefix}_${bytesToBase64Url(randomBytes(16))}`;
}
