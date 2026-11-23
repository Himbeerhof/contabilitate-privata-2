// Încarcă aplicația (index.html) într-un browser simulat (jsdom), ca testele să poată apela funcțiile ei.
const { JSDOM, VirtualConsole, ResourceLoader } = require("jsdom");
const path = require("path");
const fs = require("fs");
const { webcrypto } = require("crypto");

// după ce un test închide fereastra, promisiunile rămase ale aplicației nu mai contează
let closed = false;
process.on("unhandledRejection", e => { if (!closed) throw e; });
async function loadApp({ settings = {} } = {}) {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", e => errors.push(e.message));
  vc.on("error", (...a) => errors.push(a.map(String).join(" ")));
  // fișierele aplicației se servesc de pe disc, ca de pe http://app.test/
  class Local extends ResourceLoader {
    fetch(url, opts) {
      const u = new URL(url);
      if (u.host !== "app.test") return null;
      return Promise.resolve(fs.readFileSync(path.join(root, decodeURIComponent(u.pathname))));
    }
  }
  const dom = new JSDOM(html, {
    url: "http://app.test/index.html",
    runScripts: "dangerously", resources: new Local(), pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      const { IDBFactory, IDBKeyRange } = require("fake-indexeddb");
      w.indexedDB = new IDBFactory(); w.IDBKeyRange = IDBKeyRange; // bază de date nouă pentru fiecare test
      Object.defineProperty(w, "crypto", { value: webcrypto });
      w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
      w.structuredClone = structuredClone;
      w.DecompressionStream = DecompressionStream; w.CompressionStream = CompressionStream;
      w.Response = Response; w.Blob = Blob;
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
      w.scrollTo = () => {};
      // jsdom nu are File.arrayBuffer (browserele au)
      if (!w.File.prototype.arrayBuffer) w.File.prototype.arrayBuffer = function () { return new Promise(res => { const r = new w.FileReader(); r.onload = () => res(r.result); r.readAsArrayBuffer(this); }); };
      w.__saved = []; // fișierele „descărcate” de aplicație ajung aici
    }
  });
  const w = dom.window;
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("aplicația nu s-a încărcat: " + errors.join(" | "))), 20000);
    const chk = () => { try { if (w.eval("typeof Store !== 'undefined' && Store.engine") && w.document.readyState === "complete") { clearTimeout(t); return setTimeout(res, 600); } } catch (e) {} setTimeout(chk, 50); };
    w.addEventListener("load", chk); chk();
  });
  // descărcările nu merg în jsdom: le prind
  w.eval(`saveFile = async (name, data) => { window.__saved.push({ name, data }); return true; };`);
  if (Object.keys(settings).length) await w.eval(`(s => Store.put("settings", { ...S.settings, ...s }))`)(settings);
  const close = () => { closed = true; w.close(); };
  return { w, dom, errors, close, run: code => w.eval(code) };
}
module.exports = { loadApp };
