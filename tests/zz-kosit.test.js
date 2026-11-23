// Rulează ultimul: validează cu validatorul oficial KoSIT toate fișierele XRechnung generate de celelalte teste (tests/out).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const OUT = path.join(__dirname, "out");
test("XRechnung: validator oficial KoSIT", { skip: !process.env.KOSIT && "setează KOSIT=1 (necesită Java)" }, () => {
  const files = fs.readdirSync(OUT).filter(f => f.endsWith(".xml")).map(f => path.join(OUT, f));
  assert.ok(files.length >= 8, "lipsesc fișierele generate: " + files.length);
  let out = "";
  try { out = execFileSync(path.join(__dirname, "kosit.sh"), files, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = (e.stdout || "") + (e.stderr || ""); }
  const rep = path.join(__dirname, "kosit", "reports");
  for (const f of files) {
    const r = fs.readFileSync(path.join(rep, path.basename(f, ".xml") + "-report.xml"), "utf8");
    const errs = [...r.matchAll(/<svrl:failed-assert[^>]*id="([^"]+)"[^>]*flag="(fatal|error)"[\s\S]*?<svrl:text>([\s\S]*?)<\/svrl:text>/g)].map(m => m[1] + ": " + m[3].replace(/\s+/g, " ").slice(0, 250));
    assert.ok(/<rep:assessment>\s*<rep:accept/.test(r), path.basename(f) + " respins de validator:\n" + errs.join("\n") + "\n" + out.slice(-2000));
  }
});
