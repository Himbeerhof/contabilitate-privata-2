const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const { loadApp } = require("./load");
const { SETTINGS, CUSTOMER, inv, UBL } = require("./fixtures");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });

async function app() { const a = await loadApp({ settings: SETTINGS }); await a.run(`(c => Store.put("customers", c))`)(CUSTOMER); return a; }
const put = (a, k, o) => a.run(`((k, o) => Store.put(k, o))`)(k, o);



test("E-Rechnung primită: UBL și CII se citesc corect", async t => {
  const a = await app(); t.after(a.close);
  const d = a.run("parseEInvoice")(UBL);
  assert.strictEqual(d.number, "SW-4711"); assert.strictEqual(d.seller.name, "Stadtwerke Test GmbH"); assert.strictEqual(d.seller.vatId, "DE111222333");
  assert.strictEqual(d.dueDate, "2026-08-17"); assert.strictEqual(d.gross, 177.09); assert.strictEqual(d.taxes.length, 2); assert.strictEqual(d.iban, "DE89370400440532013000");
  assert.strictEqual(d.lines.length, 2); assert.strictEqual(d.warn.length, 0);
  // o factură generată de noi, citită înapoi
  const c = a.run("parseEInvoice")(a.run("buildXRechnung")(inv()));
  assert.strictEqual(c.format, "CII"); assert.strictEqual(c.number, "RE-2026-001"); assert.strictEqual(c.seller.name, "Himbeerhof Test");
  assert.strictEqual(c.gross, a.run("calcInv")(inv()).gross); assert.strictEqual(c.taxes.length, 2); assert.strictEqual(c.warn.length, 0);
  const cn = a.run("parseEInvoice")(UBL.replace(/<Invoice /, "<CreditNote ").replace("</Invoice>", "</CreditNote>").replace(/InvoiceTypeCode/g, "CreditNoteTypeCode").replace(">380<", ">381<").replace(/InvoiceLine/g, "CreditNoteLine").replace(/InvoicedQuantity/g, "CreditedQuantity"));
  assert.strictEqual(cn.credit, true); assert.strictEqual(cn.sign, -1);
  assert.throws(() => a.run("parseEInvoice")("<html></html>"));
});

test("E-Rechnung primită: import complet → cheltuieli + fișier atașat", async t => {
  const a = await app(); t.after(a.close);
  const f = new a.w.File([UBL], "SW-4711.xml", { type: "application/xml" });
  const p = a.run("importEInvoice")([f]);
  for (let i = 0; i < 50 && !a.w.document.querySelector("#ei-cat"); i++) await new Promise(r => setTimeout(r, 50));
  a.w.document.querySelector("#ei-cat").value = "energy";
  a.w.document.querySelector('[data-a="ok"]').click();
  await p;
  const en = a.run("Object.values(S.entries)");
  assert.strictEqual(en.length, 2);
  const g = en.map(e => a.run("parseNum")(e.gross)).sort((x, y) => x - y);
  assert.deepStrictEqual([...g], [58.09, 119]);
  assert.ok(en.every(e => e.paid === false && e.dueDate === "2026-08-17" && e.cat === "energy" && e.att.length === 1));
  const file = await a.run("(id => Files.get(id))")(en[0].att[0].id);
  assert.strictEqual(Buffer.from(file.b64, "base64").toString(), UBL);
});

test("ZUGFeRD: PDF cu XML înăuntru, citit înapoi de aplicație și de pypdf", async t => {
  const a = await app(); t.after(a.close);
  const i = inv({ number: "RE-2026-010" });
  const pdf = a.run("zugferdPDF")(i), xml = a.run("buildXRechnung")(i);
  fs.writeFileSync(path.join(OUT, "zugferd.pdf"), Buffer.from(pdf));
  fs.writeFileSync(path.join(OUT, "zugferd-extras.xml"), xml);
  assert.strictEqual(await a.run("xmlFromPdf")(pdf), xml);
  const py = execFileSync("python3", ["-I", "-c", `import sys, pypdf
r = pypdf.PdfReader(sys.argv[1], strict=True)
att = r.attachments
print(len(r.pages), list(att.keys()), len(att["xrechnung.xml"][0]), "fx:ConformanceLevel" in r.xmp_metadata.rdf_root.toxml() if r.xmp_metadata else False)`, path.join(OUT, "zugferd.pdf")], { encoding: "utf8" }).trim();
  assert.strictEqual(py, `1 ['xrechnung.xml'] ${Buffer.byteLength(xml)} True`);
});

test("închiderea lunii blochează modificările din lunile închise", async t => {
  const a = await app(); t.after(a.close);
  const e = { id: "e1", profileId: "de", type: "out", date: "2026-03-10", party: "Baumarkt", desc: "Schrauben", cat: "other", gross: "11,90", vat: "19", pay: "bank" };
  await put(a, "entries", e);
  const i = inv({ id: "i1", date: "2026-03-05" }); await put(a, "invoices", i);
  await put(a, "settings", { ...SETTINGS, lockedUntil: "2026-03" });
  const err = async p => { try { await p; return null; } catch (x) { return x.code; } };
  assert.strictEqual(await err(put(a, "entries", { ...e, gross: "12,90" })), "locked");
  assert.strictEqual(await err(a.run(`Store.del("entries", "e1")`)), "locked");
  assert.strictEqual(await err(put(a, "entries", { ...e, id: "e2", date: "2026-02-01" })), "locked");
  assert.strictEqual(await err(put(a, "entries", { ...e, att: [{ id: "x", name: "bon.jpg" }] })), null, "un bon se poate atașa și după închidere");
  assert.strictEqual(await err(put(a, "entries", { ...e, id: "e3", date: "2026-04-01" })), null);
  assert.strictEqual(await err(put(a, "invoices", { ...i, notes: "altceva" })), "locked");
  assert.strictEqual(await err(put(a, "invoices", { ...i, status: "paid", paidDate: "2026-04-02" })), null, "factura se poate marca plătită în luna deschisă");
  assert.strictEqual(await err(put(a, "invoices", { ...i, status: "paid", paidDate: "2026-03-30" })), "locked");
  assert.strictEqual(await err(put(a, "cash", { id: "k1", date: "2026-03-02", cash: "10" })), "locked");
});

test("DATEV: Buchungsstapel cu conturi și chei TVA", async t => {
  const a = await app(); t.after(a.close);
  await put(a, "invoices", inv({ id: "i1", status: "paid", paidDate: "2026-07-20" }));
  await put(a, "entries", { id: "e1", profileId: "de", type: "out", date: "2026-07-05", party: "Tankstelle", desc: "Diesel", cat: "fuel", gross: "119,00", vat: "19", pay: "cash", docNo: "B-77" });
  await put(a, "entries", { id: "e2", profileId: "de", type: "out", date: "2026-08-05", party: "Später", desc: "x", cat: "other", gross: "10", vat: "19", pay: "bank" });
  const r = a.run("datevCSV")("2026-07-01", "2026-07-31");
  const lines = Buffer.from(r.bytes).toString("latin1").split("\r\n").filter(Boolean);
  assert.match(lines[0], /^"EXTF";700;21;"Buchungsstapel";13;/);
  assert.match(lines[1], /^Umsatz \(ohne Soll\/Haben-Kz\);Soll\/Haben-Kennzeichen;/);
  assert.strictEqual(lines.length, 2 + 3); // 2 cote pe factură + motorina
  assert.ok(lines.includes(`690,15;"S";"EUR";;;"";1200;8200;"2";2007;"RE-2026-001";"";;"Obst Großhandel GmbH Factura RE-2026-001 (7 %)"`), lines.join("\n"));
  assert.ok(lines.some(l => l.startsWith(`119,00;"H";"EUR";;;"";1000;4530;"9";0507;"B-77"`)), lines.join("\n"));
});

test("Declarația TVA (DE, Ist și Soll)", async t => {
  const a = await app(); t.after(a.close);
  await put(a, "invoices", inv({ id: "i1", status: "paid", paidDate: "2026-08-03" }));            // facturată în iulie, plătită în august
  await put(a, "entries", { id: "e1", profileId: "de", type: "out", date: "2026-08-05", party: "Tankstelle", cat: "fuel", gross: "119,00", vat: "19", pay: "cash" });
  const lines = (from, to, m) => a.run("((f, t, m) => vatLines('de', vatReport('de', f, t, m)))")(from, to, m).map(l => [...l].map(x => String(x).replace(/\u00a0/g, " ")));
  const aug = lines("2026-08-01", "2026-08-31", "ist");
  assert.deepStrictEqual(aug.find(l => l[0] === "86"), ["86", "Livrări taxabile 7 %", "645,00 €", "45,15 €"]);
  assert.deepStrictEqual(aug.find(l => l[0] === "81"), ["81", "Livrări taxabile 19 %", "12,00 €", "2,28 €"]);
  assert.deepStrictEqual(aug.find(l => l[0] === "66"), ["66", "TVA deductibilă (Vorsteuer)", "", "19,00 €"]);
  assert.deepStrictEqual(aug.find(l => l[0] === "83"), ["83", "De plătit (minus = de primit înapoi)", "", "28,43 €"]);
  const julSoll = lines("2026-07-01", "2026-07-31", "soll");
  assert.strictEqual(julSoll.find(l => l[0] === "86")[2], "645,00 €");
  assert.strictEqual(lines("2026-07-01", "2026-07-31", "ist").find(l => l[0] === "86"), undefined);
});

test("somație PDF, documente atașate, backup, § 24", async t => {
  const a = await app(); t.after(a.close);
  const doc = a.run("buildDunningPDF")(inv(), { level: 2, date: "2026-09-01", fee: "5,00", due: "2026-09-11" });
  assert.ok(doc.output("arraybuffer").byteLength > 2000);
  const m = await a.run("(o => Files.add(o))")({ name: "bon.jpg", type: "image/jpeg", bytes: new Uint8Array([1, 2, 3]) });
  assert.deepStrictEqual([...Buffer.from((await a.run("(id => Files.get(id))")(m.id)).b64, "base64")], [1, 2, 3]);
  const b = await a.run("backupData")();
  assert.strictEqual(b.files.length, 1); assert.strictEqual(b.app, "facturare");
  // Pauschallandwirt: cota § 24 apare în listă și pe factură
  await put(a, "settings", { ...SETTINGS, profiles: { ...SETTINGS.profiles, de: { ...SETTINGS.profiles.de, pauschal: true, rate24: "7,8" } } });
  assert.ok([...a.run("vatRates")("de")].includes(7.8));
  const i24 = inv({ number: "RE-2026-024", items: [{ desc: "Himbeeren", qty: "10", unit: "kg", price: "6", vat: "7,8" }] });
  assert.match(a.run("p24Note")(i24, "de"), /§ 24 UStG \(7,8 %\)/);
  const xml = a.run("buildXRechnung")(i24);
  assert.match(xml, /Durchschnittssatz gemäß § 24 UStG/); assert.match(xml, /<ram:RateApplicablePercent>7.8<\/ram:RateApplicablePercent>/);
  fs.writeFileSync(path.join(OUT, "pauschal-24.xml"), xml);
});
