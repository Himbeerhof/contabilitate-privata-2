// Deschide ferestrele noi ca un utilizator și verifică să nu apară erori
const test = require("node:test");
const assert = require("node:assert");
const { loadApp } = require("./load");
const { SETTINGS, CUSTOMER, inv } = require("./fixtures");
const wait = ms => new Promise(r => setTimeout(r, ms));

test("ferestrele noi se deschid fără erori", async t => {
  const a = await loadApp({ settings: SETTINGS }); t.after(a.close);
  const { document: d } = a.w, errs = [];
  a.w.addEventListener("error", e => errs.push(e.message)); a.w.addEventListener("unhandledrejection", e => errs.push(String(e.reason && e.reason.stack || e.reason)));
  const click = sel => { const el = d.querySelector(sel); assert.ok(el, "lipsește " + sel); el.click(); };
  const closeSheets = () => d.querySelectorAll(".overlay").forEach(o => o.remove());
  await a.run(`(c => Store.put("customers", c))`)(CUSTOMER);
  await a.run(`(i => Store.put("invoices", i))`)(inv({ id: "o1", number: "RE-2025-001", date: "2025-01-10", dueDate: "2025-01-24" }));
  a.run(`show("books")`);
  for (const id of ["#bk-vat", "#bk-datev", "#bk-lock"]) { click(id); await wait(50); assert.ok(d.querySelector(".overlay"), id); closeSheets(); }
  // cheltuială nouă cu document atașat
  click("#bk-add-out"); await wait(30);
  assert.ok(d.querySelector("#en-att")); d.querySelector("#en-gross").value = "23,80"; d.querySelector("#en-party").value = "Baumarkt";
  const inp = d.querySelector("#en-attf"), f = new a.w.File(["%PDF-1.4 test"], "rechnung.pdf", { type: "application/pdf" });
  Object.defineProperty(inp, "files", { value: [f], configurable: true }); inp.dispatchEvent(new a.w.Event("change", { bubbles: true }));
  assert.match(d.querySelector("#en-att").textContent, /rechnung\.pdf/);
  d.querySelector('.overlay [data-a="ok"]').click(); await wait(300);
  const e = a.run("Object.values(S.entries)[0]");
  assert.ok(e && e.att && e.att.length === 1 && !e._files, JSON.stringify(e));
  // factură restantă: butonul de somație apare și creează PDF
  a.run(`openInvoice(S.invoices.o1)`);
  assert.ok(!d.querySelector("#ed-dun").classList.contains("hidden"), "butonul Somație");
  click("#ed-dun"); await wait(50); d.querySelector('.overlay [data-a="ok"]').click(); await wait(300);
  assert.strictEqual(a.run("S.invoices.o1.dunning.length"), 1);
  // profil DE: Pauschallandwirt se salvează
  a.run(`show("settings")`); await wait(30);
  d.querySelector("#p-de-pauschal").checked = true; click("#s-save"); await wait(200);
  assert.strictEqual(a.run("prof('de').pauschal"), true);
  assert.ok(d.querySelector("#bk-auto").textContent.length > 10);
  assert.deepStrictEqual(errs, []);
});
