// Local static server for public/ (upload mode). Port 8892.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
const dir = fileURLToPath(new URL("./public/", import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  try {
    const file = join(dir, p.endsWith("/") ? p + "index.html" : p);
    if (!file.startsWith(dir)) throw 0;
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
}).listen(+process.env.PORT || 8892, () => console.log("listening"));
