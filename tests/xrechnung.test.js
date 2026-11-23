const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const { loadApp } = require("./load");
const { SETTINGS, CUSTOMER, inv } = require("./fixtures");

const OUT = path.join(__dirname, "out");
const CASES = {
  "normal-2-cote": inv(),
  "o-zi-livrare": inv({ number: "RE-2026-002", items: [{ date: "2026-07-10", desc: "Himbeeren", qty: "12,5", unit: "kg", price: "7,10", vat: "7" }] }),
  "fara-date-livrare": inv({ number: "RE-2026-003", items: [{ desc: "Erdbeeren", qty: "10", unit: "kg", price: "4,99", vat: "7" }] }),
  "kleinunternehmer": inv({ number: "RE-2026-004", kleinunternehmer: true }),
  "stornare": inv({ number: "RE-2026-005", stornoOf: "x", stornoNo: "RE-2026-001", stornoDate: "2026-07-15", dueDate: "", status: "cancelled",
    items: [{ date: "2026-07-10", desc: "Himbeeren", qty: "-100", unit: "kg", price: "6,45", vat: "7" }, { date: "2026-07-12", desc: "Holzkisten", qty: "-3", unit: "Stk.", price: "4,20", vat: "19" }] }),
  "rotunjire": inv({ number: "RE-2026-006", items: [{ desc: "Himbeeren", qty: "2,5", unit: "kg", price: "4,03", vat: "7" }, { desc: "Kisten", qty: "0,333", unit: "Stk.", price: "1,005", vat: "19" }] }),
};

test("XRechnung: fișiere generate și verificate", async t => {
  const app = await loadApp({ settings: SETTINGS }); t.after(app.close);
  await app.run(`(c => Store.put("customers", c))`)(CUSTOMER);
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, i] of Object.entries(CASES)) {
    const chk = app.run("xrCheck")(i);
    assert.strictEqual(chk.err.length, 0, name + ": " + chk.err.join("; "));
    const xml = app.run("buildXRechnung")(i);
    // totalurile din XML trebuie să fie cele din aplicație
    const t2 = app.run("calcInv")(i);
    assert.match(xml, new RegExp(`<ram:GrandTotalAmount>${t2.gross.toFixed(2)}</ram:GrandTotalAmount>`), name);
    fs.writeFileSync(path.join(OUT, name + ".xml"), xml);
  }
  // Kleinunternehmer fără număr fiscal trebuie oprit înainte de export (BR-E-02)
  await app.run(`(s => Store.put("settings", s))`)({ ...SETTINGS, profiles: { ...SETTINGS.profiles, de: { ...SETTINGS.profiles.de, taxNo: "", vatId: "" } } });
  assert.ok(app.run("xrCheck")(CASES.kleinunternehmer).err.some(e => /Steuernummer/.test(e)));
});

