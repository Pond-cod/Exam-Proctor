/**
 * Local Development & Testing Server for Exam Proctor Studio
 * Serves static web assets and routes /api to Serverless API handler
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

// DATABASE_URL should be loaded from environment variables (.env in gitignore)
if (!process.env.DATABASE_URL) {
  try {
    const envContent = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
    const match = envContent.match(/DATABASE_URL=["']?([^"'\r\n]+)["']?/);
    if (match) process.env.DATABASE_URL = match[1];
  } catch (_) {}
}
const apiHandler = require("./api/index.js");

const PORT = process.env.PORT || 3300;
const ROOT_DIR = __dirname;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf"
};

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  // Route API requests to api/index.js
  if (pathname.startsWith("/api")) {
    // Populate req.query from searchParams
    req.query = Object.fromEntries(parsedUrl.searchParams.entries());

    // Enhance res with status and json methods for Serverless compatibility
    if (!res.status) {
      res.status = function(code) {
        this.statusCode = code;
        return this;
      };
    }
    if (!res.json) {
      res.json = function(data) {
        this.setHeader("Content-Type", "application/json; charset=utf-8");
        this.end(JSON.stringify(data));
        return this;
      };
    }

    if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
      let bodyData = "";
      req.on("data", (chunk) => {
        bodyData += chunk;
      });
      req.on("end", () => {
        try {
          req.body = bodyData ? JSON.parse(bodyData) : {};
        } catch (_) {
          req.body = bodyData;
        }
        apiHandler(req, res).catch((err) => {
          console.error("API Error in server:", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.end(JSON.stringify({ status: "error", message: err.message }));
          }
        });
      });
    } else {
      req.body = {};
      apiHandler(req, res).catch((err) => {
        console.error("API Error in server:", err);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end(JSON.stringify({ status: "error", message: err.message }));
        }
      });
    }
    return;
  }

  // Static File Serving
  let relativePath = pathname === "/" ? "/index.html" : pathname;
  // If no extension, try appending .html
  if (!path.extname(relativePath)) {
    relativePath += ".html";
  }

  // Route legacy root admin pages to admin/ folder
  if (["/login.html", "/rooms.html", "/monitor.html", "/create.html", "/users.html", "/settings.html", "/manual.html"].includes(relativePath)) {
    relativePath = "/admin" + relativePath;
  }

  const safePath = path.normalize(path.join(ROOT_DIR, relativePath));
  if (!safePath.startsWith(ROOT_DIR)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    return res.end("Forbidden");
  }

  fs.stat(safePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("File Not Found");
    }

    const ext = path.extname(safePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600"
    });

    const stream = fs.createReadStream(safePath);
    stream.pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
