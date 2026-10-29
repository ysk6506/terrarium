/**
 * Compress the web app's text files on the way out (REQ-041: the first screen has a size budget).
 * No dependency: node:zlib, and the compressed form is kept so a file is compressed once.
 */

import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

const TEXT = /^(text\/(html|css|plain)|application\/(javascript|json)|image\/svg\+xml)/;
const MIN_BYTES = 1024;
const KEEP = 256;

export async function bytesOf(payload: unknown): Promise<Buffer | undefined> {
  if (typeof payload === "string") return Buffer.from(payload);
  if (Buffer.isBuffer(payload)) return payload;
  if (payload && typeof (payload as AsyncIterable<Buffer>)[Symbol.asyncIterator] === "function") {
    const chunks: Buffer[] = [];
    for await (const chunk of payload as AsyncIterable<Buffer | string>)
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    return Buffer.concat(chunks);
  }
  return undefined;
}

type Encoding = "br" | "gzip";

/** The encoding to use for this exchange, or undefined when the response should go out as it is. */
function encodingFor(req: FastifyRequest, reply: FastifyReply): Encoding | undefined {
  const wants = String(req.headers["accept-encoding"] ?? "");
  const encoding = /\bbr\b/.test(wants) ? "br" : /\bgzip\b/.test(wants) ? "gzip" : undefined;
  const machine = ["/api/", "/mcp/", "/cluster/"].some((p) => req.url.startsWith(p));
  const compressible =
    req.method === "GET" &&
    reply.statusCode === 200 &&
    !reply.getHeader("content-encoding") &&
    TEXT.test(String(reply.getHeader("content-type") ?? ""));
  return compressible && !machine ? encoding : undefined;
}

const pack = (raw: Buffer, encoding: Encoding): Promise<Buffer> =>
  encoding === "br"
    ? brotli(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })
    : gz(raw, { level: 6 });

/** Files under `/assets/` carry a content hash in their name, so a compressed copy never goes stale. */
export function compressWeb(app: FastifyInstance): void {
  const kept = new Map<string, Buffer>();
  app.addHook("onSend", async (req, reply, payload) => {
    const encoding = encodingFor(req, reply);
    if (!encoding) return payload;
    const raw = await bytesOf(payload);
    if (!raw || raw.length < MIN_BYTES) return raw ?? payload;
    const key = `${encoding}:${req.url.split("?")[0]}:${raw.length}`;
    let packed = kept.get(key);
    if (!packed) {
      packed = await pack(raw, encoding);
      if (kept.size >= KEEP) kept.clear();
      kept.set(key, packed);
    }
    reply.header("content-encoding", encoding).header("vary", "Accept-Encoding");
    reply.removeHeader("content-length");
    return packed;
  });
}
