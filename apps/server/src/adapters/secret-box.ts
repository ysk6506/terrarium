/**
 * Seals tokens and passwords that people type on the screen (REQ-051, ADR-0042). AES-256-GCM: what is
 * sealed cannot be read or changed without the key. The key is `TERRARIUM_SECRET_KEY` when the server has
 * one (any text; it is stretched), else a random key kept in a file next to the database, readable by the
 * server's user only. A copy of the database alone therefore does not give the secrets away; a copy of the
 * database together with the key does, as it would with any secret the server can use.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const VERSION = "v1";
const SALT = "terrarium-secret-box";
const KEY_FILE = "secret.key";

export class SecretBox {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("비밀 값 열쇠는 32바이트여야 해요");
  }

  /** A box with a key that exists only as long as this process does, for tests and for running without a disk. */
  static ephemeral(): SecretBox {
    return new SecretBox(randomBytes(32));
  }

  /** The server's own key: from the environment, else the key file in `dataDir` (made on first use). */
  static forServer(env: NodeJS.ProcessEnv, dataDir: string): SecretBox {
    const given = env.TERRARIUM_SECRET_KEY;
    if (given) return new SecretBox(scryptSync(given, SALT, 32));
    const file = path.join(dataDir, KEY_FILE);
    if (existsSync(file))
      return new SecretBox(Buffer.from(readFileSync(file, "utf8").trim(), "base64"));
    mkdirSync(dataDir, { recursive: true });
    const key = randomBytes(32);
    writeFileSync(file, `${key.toString("base64")}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
    return new SecretBox(key);
  }

  /** A token that is always the same for the same label and this key, and cannot be guessed without the key. */
  derive(label: string): string {
    return createHmac("sha256", this.key).update(`terrarium:${label}`).digest("hex").slice(0, 32);
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
  }

  /** The text that was sealed; throws when the key is another one or the sealed text was changed. */
  open(sealed: string): string {
    const [version, data] = sealed.split(":", 2);
    if (version !== VERSION || !data) throw new Error("알 수 없는 형식으로 봉인된 값이에요");
    const raw = Buffer.from(data, "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  }
}
