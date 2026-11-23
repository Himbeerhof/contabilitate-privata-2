/* Contabilitate privată – funcții suplimentare
   · E-Rechnung primite (XRechnung / ZUGFeRD: XML sau PDF)      · documente atașate (poze bonuri)
   · închiderea lunii (Festschreibung, GoBD)                     · backup automat + amintire
   · export DATEV (Buchungsstapel)                               · rezumat declarație TVA (UStVA / UVA)
   · somații (Zahlungserinnerung / Mahnung)                      · ZUGFeRD (PDF cu XML înăuntru)
   · Pauschallandwirt (§ 24 UStG) – cota e în profilul DE
   Folosește funcțiile din index.html (S, Store, sheet, toast, money, calcInv, journal ...). */
(() => {
"use strict";
const T = (ro, de) => (typeof uiLang !== "undefined" && uiLang === "de") ? de : ro;
const b64enc = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode(...u8.subarray(i, i + 32768)); return btoa(s); };
const b64dec = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const fmtSize = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(n / 1e3)) + " KB";
const monthName = ym => { const [y, m] = String(ym || "").split("-"); return m ? `${MONTHS[+m - 1]} ${y}` : ym; };
const ymOf = d => String(d || "").slice(0, 7);
const lsGet = k => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

/* ======================================================================
   Bază de date locală pentru fișiere (IndexedDB „cp-files”)
   f: fișierele {id,name,type,size,b64}   q: de urcat în cloud   h: dosarul de backup
   ====================================================================== */
const idb = (() => {
  let p;
  const open = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open("cp-files", 1);
    r.onupgradeneeded = () => { const d = r.result; ["f", "q", "h"].forEach(n => d.objectStoreNames.contains(n) || d.createObjectStore(n)); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const run = async (st, mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(st, mode), q = fn(t.objectStore(st)); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
  return { get: (st, k) => run(st, "readonly", s => s.get(k)), put: (st, k, v) => run(st, "readwrite", s => s.put(v, k)), del: (st, k) => run(st, "readwrite", s => s.delete(k)),
    keys: st => run(st, "readonly", s => s.getAllKeys()), all: st => run(st, "readonly", s => s.getAll()) };
})();

/* ======================================================================
   Documente atașate: se păstrează pe dispozitiv și (criptate, dacă e setată parola) în cloud, ca att-<id>.json.
   În înregistrări rămân doar {id, name, type, size}. Documentele atașate nu se pot șterge (GoBD: păstrare 8–10 ani).
   ====================================================================== */
const Files = {
  async add({ name, type, bytes }) {
    const id = "f" + newId(), rec = { id, name: name || "document", type: type || "application/octet-stream", size: bytes.length, b64: b64enc(bytes), at: new Date().toISOString() };
    await idb.put("f", id, rec); await idb.put("q", id, 1); this.flushSoon();
    return { id, name: rec.name, type: rec.type, size: rec.size };
  },
  async fromFile(file) {
    let bytes = new Uint8Array(await file.arrayBuffer()), type = file.type || "", name = file.name || "document";
    if (/^image\//.test(type) && !/svg|gif/.test(type) && bytes.length > 500e3 && typeof shrinkImage === "function") {
      try { const b = await shrinkImage(file, 2000); bytes = new Uint8Array(await b.arrayBuffer()); type = "image/jpeg"; name = name.replace(/\.\w+$/, "") + ".jpg"; } catch (e) {}
    }
    return this.add({ name, type, bytes });
  },
  async get(id) {
    let r = await idb.get("f", id); if (r) return r;
    const ad = Store.engine && Store.engine.adapter; if (!ad || !navigator.onLine) return null;
    const f = (await ad.list()).find(x => x.name === `att-${id}.json`); if (!f) return null;
    r = JSON.parse(await Store.engine._read(f)); await idb.put("f", id, r); return r;
  },
  async blob(id) { const r = await this.get(id); return r ? new Blob([b64dec(r.b64)], { type: r.type }) : null; },
  async open(id) {
    const r = await this.get(id);
    if (!r) { toast(T("Documentul nu e pe acest dispozitiv și nici în cloud (poate nu s-a sincronizat încă).", "Beleg ist weder auf diesem Gerät noch in der Cloud (noch nicht synchronisiert?)."), 4500); return; }
    const blob = new Blob([b64dec(r.b64)], { type: r.type });
    if (/^image\/|\/pdf$/.test(r.type)) { const u = URL.createObjectURL(blob), w = window.open(u, "_blank"); if (!w) await saveFile(r.name, blob); setTimeout(() => URL.revokeObjectURL(u), 120000); }
    else if (/xml/.test(r.type)) { try { const d = parseEInvoice(new TextDecoder().decode(b64dec(r.b64))); const o = sheet(einvHTML(d) + `<div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" data-a="dl">${T("Descarcă XML", "XML herunterladen")}</button><button class="btn primary" data-a="x">OK</button></div>`);
        o.addEventListener("click", async ev => { const a = ev.target.dataset.a; if (ev.target === o || a === "x") o.remove(); if (a === "dl") await saveFile(r.name, blob); }); } catch (e) { await saveFile(r.name, blob); } }
    else await saveFile(r.name, blob);
  },
  flushSoon() { clearTimeout(this._t); this._t = setTimeout(() => this.flush().catch(e => console.warn("atașamente", e)), 3000); },
  async flush() {
    const ad = Store.engine && Store.engine.adapter; if (!ad || !navigator.onLine || this._busy) return; this._busy = true;
    try { for (const id of await idb.keys("q")) { const r = await idb.get("f", id); if (r) await ad.put(`att-${id}.json`, await Store.engine._write(r)); await idb.del("q", id); } }
    finally { this._busy = false; }
  },
  async queueAll() { for (const id of await idb.keys("f")) await idb.put("q", id, 1); this.flushSoon(); },
  all() { return idb.all("f"); },
  async importAll(list) { for (const r of list || []) if (r && r.id && r.b64 && !(await idb.get("f", r.id))) { await idb.put("f", r.id, r); await idb.put("q", r.id, 1); } this.flushSoon(); }
};
window.Files = Files;
setInterval(() => Files.flush().catch(() => {}), 120000);
addEventListener("online", () => Files.flushSoon());
// la conectarea unui cloud nou urcă și documentele existente
if (typeof Store !== "undefined" && Store.connect) { const oc = Store.connect.bind(Store); Store.connect = async cfg => { const r = await oc(cfg); await Files.queueAll(); return r; }; }

// în fereastra unei cheltuieli: lista documentelor + „Atașează”
window.attUI = (o, e) => {
  const box = o.querySelector("#en-att"), inp = o.querySelector("#en-attf"); if (!box) return;
  e.att = e.att || []; e._files = e._files || [];
  const draw = () => {
    box.innerHTML = [...e.att.map(a => `<button type="button" class="btn small" data-open="${esc(a.id)}">📎 ${esc(a.name)} · ${fmtSize(a.size || 0)}</button>`),
      ...e._files.map((f, i) => `<button type="button" class="btn small" data-rm="${i}" title="${T("Scoate", "Entfernen")}">📎 ${esc(f.name || "bon.jpg")} · ${T("nou", "neu")} ✕</button>`)].join(" ")
      || `<span class="hint" style="margin:0">${T("Niciun document atașat. Bonul/factura trebuie păstrate 8–10 ani.", "Kein Beleg angehängt. Belege 8–10 Jahre aufbewahren.")}</span>`;
  };
  box.addEventListener("click", ev => { const t = ev.target.closest("[data-open],[data-rm]"); if (!t) return; if (t.dataset.open) Files.open(t.dataset.open); else { e._files.splice(+t.dataset.rm, 1); draw(); } });
  inp && inp.addEventListener("change", ev => { e._files.push(...ev.target.files); ev.target.value = ""; draw(); });
  draw();
};
// la salvare: documentele noi se pun în baza de fișiere, în înregistrare rămâne doar trimiterea
window.attCommit = async e => {
  const fs = e._files || []; delete e._files; if (!fs.length) return;
  e.att = [...(e.att || [])];
  for (const f of fs) e.att.push(await Files.fromFile(f instanceof File ? f : new File([f], f.name || "bon.jpg", { type: f.type || "image/jpeg" })));
};

/* ======================================================================
   E-Rechnung primite: XRechnung / ZUGFeRD / Factur-X (CII) și UBL (Invoice, CreditNote)
   ====================================================================== */
const kid = (el, n) => el ? [...el.children].find(c => c.localName === n) || null : null;
const kidsN = (el, n) => el ? [...el.children].filter(c => c.localName === n) : [];
const pth = (el, p) => p.split("/").reduce((e, n) => kid(e, n), el);
const txt = (el, p) => { const e = p ? pth(el, p) : el; return e ? e.textContent.trim() : ""; };
const numX = v => { const n = parseFloat(String(v ?? "").trim()); return isNaN(n) ? 0 : n; };
const d8 = v => { v = String(v || "").trim(); return /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : ""; };

function parseEInvoice(xml) {
  const doc = new DOMParser().parseFromString(String(xml).replace(/^﻿/, ""), "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error(T("Fișierul XML nu poate fi citit.", "Die XML-Datei kann nicht gelesen werden."));
  const r = doc.documentElement;
  if (r.localName === "CrossIndustryInvoice") return finishEInv(parseCII(r));
  if (r.localName === "Invoice" || r.localName === "CreditNote") return finishEInv(parseUBL(r));
  throw new Error(T("Fișierul nu e o factură electronică (XRechnung / ZUGFeRD).", "Die Datei ist keine E-Rechnung (XRechnung / ZUGFeRD)."));
}
function partyOf(p, ubl) {
  if (!p) return { name: "", vatId: "", taxNo: "", address: "", email: "" };
  if (!ubl) {
    const a = kid(p, "PostalTradeAddress"), regs = kidsN(p, "SpecifiedTaxRegistration").map(x => kid(x, "ID")).filter(Boolean);
    const reg = s => ((regs.find(x => x.getAttribute("schemeID") === s) || {}).textContent || "").trim();
    return { name: txt(p, "Name"), vatId: reg("VA"), taxNo: reg("FC"), email: txt(p, "URIUniversalCommunication/URIID"),
      address: a ? [txt(a, "LineOne"), txt(a, "LineTwo"), [txt(a, "PostcodeCode"), txt(a, "CityName")].filter(Boolean).join(" "), txt(a, "CountryID")].filter(Boolean).join("\n") : "" };
  }
  const pa = kid(p, "Party"), a = kid(pa, "PostalAddress"), tax = kidsN(pa, "PartyTaxScheme"), vt = tax.find(t => txt(t, "TaxScheme/ID") === "VAT");
  return { name: txt(pa, "PartyLegalEntity/RegistrationName") || txt(pa, "PartyName/Name"), vatId: vt ? txt(vt, "CompanyID") : "",
    taxNo: tax.filter(t => t !== vt).map(t => txt(t, "CompanyID"))[0] || "", email: txt(pa, "EndpointID"),
    address: a ? [txt(a, "StreetName"), txt(a, "AdditionalStreetName"), [txt(a, "PostalZone"), txt(a, "CityName")].filter(Boolean).join(" "), txt(a, "Country/IdentificationCode")].filter(Boolean).join("\n") : "" };
}
function parseCII(r) {
  const ed = kid(r, "ExchangedDocument"), tr = kid(r, "SupplyChainTradeTransaction");
  const ag = kid(tr, "ApplicableHeaderTradeAgreement"), st = kid(tr, "ApplicableHeaderTradeSettlement");
  const cur = txt(st, "InvoiceCurrencyCode") || "EUR", type = txt(ed, "TypeCode");
  const pm = kidsN(st, "SpecifiedTradeSettlementPaymentMeans"), terms = kidsN(st, "SpecifiedTradePaymentTerms");
  const sum = kid(st, "SpecifiedTradeSettlementHeaderMonetarySummation");
  const tt = kidsN(sum, "TaxTotalAmount"), taxTot = tt.find(e => !e.getAttribute("currencyID") || e.getAttribute("currencyID") === cur) || tt[0];
  return {
    format: "CII", typeCode: type, credit: type === "381", number: txt(ed, "ID"), date: d8(txt(ed, "IssueDateTime/DateTimeString")), currency: cur,
    notes: kidsN(ed, "IncludedNote").map(n => txt(n, "Content")).filter(Boolean),
    seller: partyOf(kid(ag, "SellerTradeParty")), buyer: partyOf(kid(ag, "BuyerTradeParty")),
    iban: pm.map(p => txt(p, "PayeePartyCreditorFinancialAccount/IBANID")).find(Boolean) || "",
    bic: pm.map(p => txt(p, "PayeeSpecifiedCreditorFinancialInstitution/BICID")).find(Boolean) || "",
    payCode: pm.map(p => txt(p, "TypeCode")).find(Boolean) || "",
    dueDate: terms.map(t => d8(txt(t, "DueDateDateTime/DateTimeString"))).find(Boolean) || "",
    terms: terms.map(t => txt(t, "Description")).filter(Boolean).join(" "),
    taxes: kidsN(st, "ApplicableTradeTax").map(t => ({ rate: numX(txt(t, "RateApplicablePercent")), base: numX(txt(t, "BasisAmount")), amount: numX(txt(t, "CalculatedAmount")), cat: txt(t, "CategoryCode") })),
    net: numX(txt(sum, "TaxBasisTotalAmount")), tax: numX(taxTot && taxTot.textContent), gross: numX(txt(sum, "GrandTotalAmount")), due: numX(txt(sum, "DuePayableAmount")),
    lines: kidsN(tr, "IncludedSupplyChainTradeLineItem").map(l => { const q = pth(l, "SpecifiedLineTradeDelivery/BilledQuantity");
      return { name: txt(l, "SpecifiedTradeProduct/Name"), qty: numX(q && q.textContent), unit: q ? q.getAttribute("unitCode") || "" : "",
        price: numX(txt(l, "SpecifiedLineTradeAgreement/NetPriceProductTradePrice/ChargeAmount")),
        net: numX(txt(l, "SpecifiedLineTradeSettlement/SpecifiedTradeSettlementLineMonetarySummation/LineTotalAmount")),
        rate: numX(txt(l, "SpecifiedLineTradeSettlement/ApplicableTradeTax/RateApplicablePercent")) }; })
  };
}
function parseUBL(r) {
  const cn = r.localName === "CreditNote", cur = txt(r, "DocumentCurrencyCode") || "EUR";
  const pm = kidsN(r, "PaymentMeans"), mt = kid(r, "LegalMonetaryTotal");
  const tts = kidsN(r, "TaxTotal"), tt = tts.find(t => kidsN(t, "TaxSubtotal").length) || tts[0];
  const type = txt(r, cn ? "CreditNoteTypeCode" : "InvoiceTypeCode");
  return {
    format: "UBL", typeCode: type, credit: cn || type === "381", number: txt(r, "ID"), date: d8(txt(r, "IssueDate")), currency: cur,
    notes: kidsN(r, "Note").map(n => n.textContent.trim()).filter(Boolean),
    seller: partyOf(kid(r, "AccountingSupplierParty"), true), buyer: partyOf(kid(r, "AccountingCustomerParty"), true),
    iban: pm.map(p => txt(p, "PayeeFinancialAccount/ID")).find(Boolean) || "", bic: pm.map(p => txt(p, "PayeeFinancialAccount/FinancialInstitutionBranch/ID")).find(Boolean) || "",
    payCode: pm.map(p => txt(p, "PaymentMeansCode")).find(Boolean) || "",
    dueDate: d8(txt(r, "DueDate")) || pm.map(p => d8(txt(p, "PaymentDueDate"))).find(Boolean) || "",
    terms: kidsN(r, "PaymentTerms").map(p => txt(p, "Note")).filter(Boolean).join(" "),
    taxes: kidsN(tt, "TaxSubtotal").map(s => ({ rate: numX(txt(s, "TaxCategory/Percent")), base: numX(txt(s, "TaxableAmount")), amount: numX(txt(s, "TaxAmount")), cat: txt(s, "TaxCategory/ID") })),
    net: numX(txt(mt, "TaxExclusiveAmount")), tax: numX(txt(tt, "TaxAmount")), gross: numX(txt(mt, "TaxInclusiveAmount")), due: numX(txt(mt, "PayableAmount")),
    lines: kidsN(r, cn ? "CreditNoteLine" : "InvoiceLine").map(l => { const q = kid(l, cn ? "CreditedQuantity" : "InvoicedQuantity");
      return { name: txt(l, "Item/Name"), qty: numX(q && q.textContent), unit: q ? q.getAttribute("unitCode") || "" : "", price: numX(txt(l, "Price/PriceAmount")),
        net: numX(txt(l, "LineExtensionAmount")), rate: numX(txt(l, "Item/ClassifiedTaxCategory/Percent")) }; })
  };
}
function finishEInv(d) {
  if (!d.taxes.length && d.gross) d.taxes = [{ rate: d.net ? r2((d.gross - d.net) / d.net * 100) : 0, base: d.net, amount: r2(d.gross - d.net), cat: "" }];
  d.directDebit = d.payCode === "59";
  d.sign = d.credit ? -1 : 1;
  d.warn = [];
  const chk = r2(d.taxes.reduce((s, t) => s + t.base + t.amount, 0));
  if (d.gross && Math.abs(chk - d.gross) > 0.02) d.warn.push(T(`Suma pe cote TVA (${money(chk)}) diferă de total (${money(d.gross)}).`, `Summe nach Steuersätzen (${money(chk)}) weicht vom Gesamtbetrag (${money(d.gross)}) ab.`));
  if (!d.number) d.warn.push(T("Lipsește numărul facturii.", "Rechnungsnummer fehlt."));
  if (!d.date) d.warn.push(T("Lipsește data facturii.", "Rechnungsdatum fehlt."));
  if (d.currency !== "EUR") d.warn.push(T(`Moneda facturii e ${d.currency}, nu EUR – sumele trebuie convertite.`, `Rechnungswährung ${d.currency} statt EUR – Beträge umrechnen.`));
  return d;
}
// XML-ul din PDF (ZUGFeRD / Factur-X): caută fișierul atașat în PDF
const inflate = async u8 => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
async function xmlFromPdf(bytes) {
  const s = new TextDecoder("latin1").decode(bytes), cands = [], re = /(?<!end)stream\r?\n/g; let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length, end = s.indexOf("endstream", start); if (end < 0) break;
    const dict = s.slice(s.lastIndexOf("obj", m.index), m.index), lm = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    let stop = end; while (stop > start && (bytes[stop - 1] === 10 || bytes[stop - 1] === 13)) stop--;
    const data = lm && start + +lm[1] <= end ? bytes.subarray(start, start + +lm[1]) : bytes.subarray(start, stop);
    cands.push({ dict, data, emb: /\/EmbeddedFile/.test(dict) || /text#2Fxml|application#2Fxml/.test(dict) });
    re.lastIndex = end + 9;
  }
  const list = cands.some(c => c.emb) ? cands.filter(c => c.emb) : cands.filter(c => c.data.length < 3e6);
  for (const c of list) {
    let d = c.data;
    if (/\/FlateDecode/.test(c.dict)) { try { d = await inflate(d); } catch (e) { continue; } } else if (/\/Filter/.test(c.dict)) continue;
    const t = new TextDecoder().decode(d);
    if (/<([\w-]+:)?(CrossIndustryInvoice|Invoice|CreditNote)[\s>]/.test(t)) return t.slice(t.indexOf("<"));
  }
  return null;
}
const UNIT_RO = { KGM: "kg", H87: T("buc.", "Stk."), C62: T("buc.", "Stk."), LTR: "l", MTR: "m", HUR: "h", DAY: T("zile", "Tage"), XPP: T("buc.", "Stk."), KWH: "kWh", MTQ: "m³", TNE: "t" };
function einvHTML(d) {
  const sg = d.sign, row = (k, v) => v ? `<tr><td style="color:var(--muted)">${k}</td><td>${v}</td></tr>` : "";
  return `<h3>${d.credit ? T("Notă de credit (Gutschrift)", "Gutschrift") : T("Factură electronică primită", "Empfangene E-Rechnung")} ${esc(d.number)}</h3>
    ${d.warn.length ? `<div class="banner" style="margin-bottom:10px">${d.warn.map(esc).join("<br>")}</div>` : ""}
    <div class="grid2"><div class="card" style="background:var(--bg);margin:0"><div class="hint" style="margin:0">${T("De la", "Von")}</div><b>${esc(d.seller.name)}</b><div style="white-space:pre-line;font-size:13px">${esc(d.seller.address)}</div><div style="font-size:12px;color:var(--muted)">${esc(d.seller.vatId || d.seller.taxNo)}</div></div>
      <div class="card" style="background:var(--bg);margin:0"><div class="hint" style="margin:0">${T("Către", "An")}</div><b>${esc(d.buyer.name)}</b><div style="white-space:pre-line;font-size:13px">${esc(d.buyer.address)}</div></div></div>
    <table class="t" style="margin:10px 0">${row(T("Data", "Datum"), esc(fmtDate(d.date)))}${row(T("Scadență", "Fällig"), esc(fmtDate(d.dueDate)))}${row(T("Plată", "Zahlung"), d.directDebit ? T("Debit direct (Lastschrift)", "Lastschrift") : esc([d.iban && fmtIban(d.iban), d.bic].filter(Boolean).join(" · ")))}${row(T("Condiții", "Bedingungen"), esc(d.terms))}${row(T("Format", "Format"), d.format === "CII" ? "XRechnung / ZUGFeRD (CII)" : "XRechnung (UBL)")}</table>
    <div class="card" style="padding:6px 10px;overflow-x:auto"><table class="t"><tr><th>${T("Poziție", "Position")}</th><th>${T("Cant.", "Menge")}</th><th>${T("Preț", "Preis")}</th><th>TVA</th><th>${T("Net", "Netto")}</th></tr>
      ${d.lines.map(l => `<tr><td>${esc(l.name)}</td><td>${esc(numStr(l.qty))} ${esc(UNIT_RO[l.unit] || l.unit)}</td><td>${esc(money(l.price, d.currency))}</td><td>${esc(pct(l.rate))}</td><td>${esc(money(sg * l.net, d.currency))}</td></tr>`).join("")}
      ${d.taxes.map(t => `<tr class="sum"><td colspan="3">${T("Net", "Netto")} ${esc(pct(t.rate))}: ${esc(money(sg * t.base, d.currency))}</td><td colspan="2">TVA ${esc(money(sg * t.amount, d.currency))}</td></tr>`).join("")}
      <tr class="sum"><td colspan="4">${T("Total", "Gesamt")}</td><td>${esc(money(sg * d.gross, d.currency))}</td></tr></table></div>
    ${d.notes.length ? `<div class="hint" style="white-space:pre-line">${esc(d.notes.join("\n"))}</div>` : ""}`;
}
window.parseEInvoice = parseEInvoice; window.xmlFromPdf = xmlFromPdf;

async function readEInvoiceFile(f) {
  const bytes = new Uint8Array(await f.arrayBuffer());
  const isPdf = String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";
  const xml = isPdf ? await xmlFromPdf(bytes) : new TextDecoder().decode(bytes);
  if (!xml) throw new Error(T("PDF-ul nu conține o factură electronică (ZUGFeRD). Pentru facturi obișnuite folosește „📷 Cameră” sau „🖼 Galerie”.", "Die PDF enthält keine E-Rechnung (ZUGFeRD). Für normale Rechnungen „📷 Kamera“ oder „🖼 Galerie“ verwenden."));
  return { d: parseEInvoice(xml), bytes, isPdf };
}
window.importEInvoice = async files => {
  for (const f of files) {
    let r; try { r = await readEInvoiceFile(f); } catch (e) { toast(`${f.name}: ${e.message}`, 6000); continue; }
    await reviewEInvoice(r.d, f, r.bytes, r.isPdf);
  }
};
function guessPid(d) {
  const rates = d.taxes.map(t => t.rate);
  if (rates.some(r => [10, 13, 20].includes(r)) || /\bAT\b/.test(d.buyer.address)) return "at";
  if (rates.some(r => [7, 19].includes(r)) || /\bDE\b/.test(d.buyer.address)) return "de";
  return defPid();
}
function reviewEInvoice(d, f, bytes, isPdf) {
  return new Promise(done => {
    const me = normName(S.settings.name || ""), buyerOk = !me || normName(d.buyer.name).includes(me.split(" ")[0] || me);
    const dup = Object.values(S.entries).find(e => e.docNo && e.docNo === d.number && normName(e.party) === normName(d.seller.name));
    let pid = guessPid(d), paid = d.directDebit || !(d.due > 0) || d.credit;
    const lastCat = (Object.values(S.entries).filter(e => normName(e.party) === normName(d.seller.name)).sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0] || {}).cat || "other";
    const o = sheet(`${einvHTML(d)}
      ${dup ? `<div class="banner" style="margin:10px 0">${T(`Atenție: factura ${esc(d.number)} de la ${esc(d.seller.name)} e deja trecută (${fmtDate(dup.date)}).`, `Achtung: Rechnung ${esc(d.number)} von ${esc(d.seller.name)} ist schon erfasst (${fmtDate(dup.date)}).`)}</div>` : ""}
      ${buyerOk ? "" : `<div class="banner" style="margin:10px 0">${T("Destinatarul facturii nu pare să fie firma ta – verifică.", "Der Rechnungsempfänger scheint nicht deine Firma zu sein – bitte prüfen.")}</div>`}
      <h3 style="margin-top:14px">${T("Se trece la cheltuieli ca:", "Wird als Ausgabe erfasst:")}</h3>
      <div class="row fld"><div class="seg" id="ei-prof">${PIDS.map(p => `<button data-v="${p}">${prof(p).flag}</button>`).join("")}</div>
        <div class="seg" id="ei-st"><button data-v="paid">✓ ${T("Plătită", "Bezahlt")}</button><button data-v="open">${T("De plătit", "Offen")}</button></div></div>
      <div class="grid3"><div class="fld"><label class="f">${T("Categorie", "Kategorie")}</label><select id="ei-cat">${CAT_OUT.map(([k, ro, de]) => `<option value="${k}" ${k === lastCat ? "selected" : ""}>${esc(T(ro, de))}</option>`).join("")}</select></div>
        <div class="fld"><label class="f" id="ei-date-l"></label><input type="date" id="ei-date"></div>
        <div class="fld"><label class="f">${T("Plată", "Zahlart")}</label><select id="ei-pay">${Object.entries(PAY).map(([k, v]) => `<option value="${k}">${T(v, PAY_DE[k])}</option>`).join("")}</select></div></div>
      <div class="hint">${d.taxes.length > 1 ? T(`Factura are ${d.taxes.length} cote TVA: se fac ${d.taxes.length} înregistrări, câte una pe cotă.`, `${d.taxes.length} Steuersätze: es werden ${d.taxes.length} Buchungen angelegt.`) : ""} ${T("Fișierul original se păstrează atașat (obligatoriu pentru E-Rechnung).", "Die Originaldatei wird angehängt aufbewahrt (Pflicht bei E-Rechnungen).")}</div>
      <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" data-a="x">${T("Renunță", "Abbrechen")}</button><button class="btn primary" data-a="ok">${T("Salvează cheltuiala", "Ausgabe speichern")}</button></div>`);
    const q = s => o.querySelector(s);
    const setPid = p => { pid = p; o.querySelectorAll("#ei-prof button").forEach(b => b.classList.toggle("on", b.dataset.v === p)); };
    const setSt = v => { paid = v === "paid"; o.querySelectorAll("#ei-st button").forEach(b => b.classList.toggle("on", b.dataset.v === v));
      q("#ei-date-l").textContent = paid ? T("Data plății", "Zahlungsdatum") : T("Data facturii", "Rechnungsdatum");
      q("#ei-date").value = paid ? (d.directDebit && d.dueDate ? d.dueDate : d.date || localISO()) : d.date || localISO(); };
    setPid(pid); setSt(paid ? "paid" : "open");
    q("#ei-prof").addEventListener("click", ev => ev.target.dataset.v && setPid(ev.target.dataset.v));
    q("#ei-st").addEventListener("click", ev => ev.target.dataset.v && setSt(ev.target.dataset.v));
    if (d.directDebit) q("#ei-pay").value = "bank";
    o.addEventListener("click", async ev => {
      const a = ev.target.dataset.a; if (ev.target === o || a === "x") { o.remove(); return done(false); }
      if (a !== "ok") return;
      const date = q("#ei-date").value; if (!date) { toast(T("Alege data.", "Datum wählen.")); return; }
      const cat = q("#ei-cat").value, pay = q("#ei-pay").value, groups = d.taxes.filter(t => t.base || t.amount);
      const desc = d.lines.map(l => l.name).filter(Boolean).join(", ").slice(0, 110) || T("Factură electronică", "E-Rechnung");
      const ok = await safe(async () => {
        const att = await Files.add({ name: f.name || `${d.number}.${isPdf ? "pdf" : "xml"}`, type: isPdf ? "application/pdf" : "application/xml", bytes });
        for (const t of groups) {
          const en = { id: newId(), profileId: pid, type: "out", date, docNo: d.number, party: d.seller.name, desc: desc + (groups.length > 1 ? ` (${pct(t.rate)})` : ""), cat,
            gross: numIn(r2(d.sign * (t.base + t.amount))), vat: String(t.rate), pay, att: [att],
            note: [T("E-Rechnung", "E-Rechnung") + " " + (d.format === "CII" ? "CII" : "UBL"), d.date && !paid ? "" : T("din ", "vom ") + fmtDate(d.date), d.directDebit ? "Lastschrift" : "", d.seller.vatId].filter(Boolean).join(" · ") };
          if (!paid) Object.assign(en, { paid: false, date: d.date || date, dueDate: d.dueDate || addDays(d.date || date, 14), iban: String(d.iban || "").replace(/\s+/g, "").toUpperCase(), bic: String(d.bic || "").replace(/\s+/g, "").toUpperCase() });
          await Store.put("entries", en);
        }
      }, paid ? T("Cheltuială salvată", "Ausgabe gespeichert") : T("Salvat în „De plătit”", "Unter „Offen“ gespeichert"));
      if (ok) { o.remove(); if (S.view !== "books") show("books"); else renderBooks(); done(true); }
    });
  });
}

/* ======================================================================
   Închiderea lunii (Festschreibung): după închidere, documentele contabile din lunile închise
   nu se mai pot modifica sau șterge – doar corecta prin stornare / înregistrare nouă.
   ====================================================================== */
const lockedUntil = () => S.settings.lockedUntil || "";
const isLk = d => !!d && !!lockedUntil() && ymOf(d) <= lockedUntil();
const changedKeys = (a, b) => [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].filter(k => k !== "updatedAt" && JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k]));
function lockFail(d) {
  const e = new Error(T(`Luna ${monthName(ymOf(d))} e închisă (Festschreibung). Documentele din ea nu se mai pot schimba – fă o stornare sau o înregistrare nouă în luna curentă.`,
    `${monthName(ymOf(d))} ist festgeschrieben. Belege darin können nicht mehr geändert werden – bitte stornieren oder im laufenden Monat neu buchen.`));
  e.code = "locked"; throw e;
}
// apelată de Store.put / Store.del (next = null la ștergere)
window.lockCheck = (kind, prev, next) => {
  if (!lockedUntil() || window.__noLock) return;
  if (kind === "invoices") {
    const booked = i => isLk(i.date) || (i.status === "paid" && isLk(i.paidDate));
    if (!next) { if (prev && booked(prev)) lockFail(isLk(prev.date) ? prev.date : prev.paidDate); return; }
    if (!prev) { if (isLk(next.date)) lockFail(next.date); if (next.status === "paid" && isLk(next.paidDate)) lockFail(next.paidDate); return; }
    const ch = changedKeys(prev, next).filter(k => k !== "dunning"); if (!ch.length) return;
    if (prev.status === "paid" && isLk(prev.paidDate)) lockFail(prev.paidDate);
    if (isLk(prev.date) && ch.some(k => !["status", "paidDate"].includes(k))) lockFail(prev.date);
    if (next.date !== prev.date && isLk(next.date)) lockFail(next.date);
    if (next.status === "paid" && isLk(next.paidDate)) lockFail(next.paidDate);
    return;
  }
  if (kind === "entries") {
    const booked = e => e && e.paid !== false && isLk(e.date);
    if (!next) { if (booked(prev)) lockFail(prev.date); return; }
    if (!prev) { if (booked(next)) lockFail(next.date); return; }
    if (!changedKeys(prev, next).filter(k => k !== "att").length) return;
    if (booked(prev)) lockFail(prev.date); if (booked(next)) lockFail(next.date);
    return;
  }
  const f = { cash: "date", deposits: "date", cashmonths: "month" }[kind]; if (!f) return;
  const ch = !prev || !next || changedKeys(prev, next).length; if (!ch) return;
  if (prev && isLk(prev[f])) lockFail(prev[f]);
  if (next && isLk(next[f])) lockFail(next[f]);
};
function lockInfo() {
  const el = document.getElementById("bk-lockinfo"); if (!el) return;
  el.textContent = lockedUntil() ? T(`🔒 Închis (Festschreibung) până la ${monthName(lockedUntil())} inclusiv.`, `🔒 Festgeschrieben bis einschließlich ${monthName(lockedUntil())}.`) : "";
}
window.lockForm = () => {
  const now = localISO().slice(0, 7), cur = lockedUntil(), opts = [];
  for (let i = 1; i <= 24; i++) { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); const ym = localISO(d).slice(0, 7); if (!cur || ym > cur) opts.push(ym); }
  const o = sheet(`<h3>🔒 ${T("Închiderea lunii (Festschreibung)", "Monatsabschluss (Festschreibung)")}</h3>
    <div class="hint">${T("După închidere, facturile, cheltuielile, casa și depunerile din lunile închise nu se mai pot modifica sau șterge (cerință GoBD). Greșelile se corectează prin stornare sau printr-o înregistrare nouă în luna curentă. Facturile din lunile închise pot fi încă marcate „Plătită” cu data de azi.",
      "Nach dem Abschluss können Rechnungen, Ausgaben, Kasse und Einzahlungen der abgeschlossenen Monate nicht mehr geändert oder gelöscht werden (GoBD). Korrekturen per Storno oder neuer Buchung im laufenden Monat. Rechnungen können weiterhin mit heutigem Datum als bezahlt markiert werden.")}</div>
    <p><b>${cur ? T(`Închis acum până la: ${monthName(cur)}`, `Derzeit festgeschrieben bis: ${monthName(cur)}`) : T("Nicio lună închisă încă.", "Noch kein Monat festgeschrieben.")}</b></p>
    ${opts.length ? `<div class="fld"><label class="f">${T("Închide până la (inclusiv)", "Festschreiben bis einschließlich")}</label><select id="lk-m">${opts.map(m => `<option value="${m}">${monthName(m)}</option>`).join("")}</select></div>
    <div id="lk-warn" class="hint"></div>` : ""}
    <div class="row" style="justify-content:space-between;margin-top:10px">${cur ? `<button class="btn danger" data-a="un">${T("Redeschide", "Wieder öffnen")} ${monthName(cur)}</button>` : "<span></span>"}
      <div class="row"><button class="btn" data-a="x">${T("Renunță", "Abbrechen")}</button>${opts.length ? `<button class="btn primary" data-a="ok">${T("Închide", "Festschreiben")}</button>` : ""}</div></div>`);
  const sel = o.querySelector("#lk-m");
  const warn = () => { if (!sel) return; const to = sel.value, from = cur || "0000-00", w = [];
    const est = cashVatRows().filter(r => r.est && ymOf(r.date) > from && ymOf(r.date) <= to).map(r => ymOf(r.date));
    if (est.length) w.push(T(`Lipsește raportul lunar al casei pentru: ${[...new Set(est)].map(monthName).join(", ")}.`, `Monatsbericht der Kasse fehlt für: ${[...new Set(est)].map(monthName).join(", ")}.`));
    const unp = Object.values(S.entries).filter(e => e.paid === false && ymOf(e.date) <= to).length;
    if (unp) w.push(T(`${unp} facturi de la furnizori sunt încă „De plătit” (nu e o problemă, se trec la plată).`, `${unp} Lieferantenrechnungen noch offen (kein Problem, werden bei Zahlung gebucht).`));
    o.querySelector("#lk-warn").innerHTML = w.map(x => "⚠️ " + esc(x)).join("<br>"); };
  sel && sel.addEventListener("change", warn); warn();
  o.addEventListener("click", async ev => {
    const a = ev.target.dataset.a; if (ev.target === o || a === "x") return o.remove();
    if (a === "ok") {
      const to = sel.value; if (!(await confirmBox(T(`Închizi definitiv lunile până la ${monthName(to)} inclusiv?`, `Monate bis einschließlich ${monthName(to)} festschreiben?`), T("Închide", "Festschreiben"), false))) return;
      if (await safe(async () => { await Store.audit("settings", "lock", { id: "lockedUntil", number: to, before: cur }); await Store.put("settings", { ...S.settings, lockedUntil: to }); }, T("Luna a fost închisă.", "Festgeschrieben."))) { o.remove(); lockInfo(); }
    }
    if (a === "un") {
      if (!(await confirmBox(T(`Redeschizi ${monthName(cur)}? Redeschiderea se înregistrează în jurnalul de modificări. Fă asta doar dacă ai închis-o din greșeală și nu ai trimis încă declarația.`, `${monthName(cur)} wieder öffnen? Das wird im Änderungsprotokoll vermerkt.`), T("Redeschide", "Öffnen")))) return;
      const d = new Date(cur + "-15T12:00:00"); d.setMonth(d.getMonth() - 1); const prev = localISO(d).slice(0, 7);
      if (await safe(async () => { await Store.audit("settings", "unlock", { id: "lockedUntil", number: cur }); await Store.put("settings", { ...S.settings, lockedUntil: prev }); }, T("Redeschis.", "Wieder geöffnet."))) { o.remove(); lockInfo(); }
    }
  });
};

/* ======================================================================
   Backup: amintire, backup automat într-un dosar, cerere de stocare permanentă
   ====================================================================== */
const LB_KEY = "cp_lastbackup_v1", LA_KEY = "cp_lastauto_v1";
async function backupData() {
  const data = { app: "facturare", version: 3, exportedAt: new Date().toISOString(), settings: S.settings };
  KINDS.forEach(k => data[k] = Object.values(S[k]));
  try { data.files = await Files.all(); } catch (e) { data.files = []; }
  return data;
}
window.backupData = backupData;
window.doBackup = async () => {
  await saveFile(`facturare-backup-${localISO()}.json`, JSON.stringify(await backupData()));
  lsSet(LB_KEY, new Date().toISOString()); document.getElementById("bk-remind")?.remove(); renderAuto();
};
const Auto = {
  ok: typeof window.showDirectoryPicker === "function",
  handle() { return idb.get("h", "dir").catch(() => null); },
  async choose() {
    const h = await window.showDirectoryPicker({ id: "cp-backup", mode: "readwrite" });
    await idb.put("h", "dir", h); await this.run(true); renderAuto();
  },
  async run(force) {
    const h = await this.handle(); if (!h) return "none";
    if ((await h.queryPermission({ mode: "readwrite" })) !== "granted") return "perm";
    const last = lsGet(LA_KEY); if (!force && last && Date.now() - Date.parse(last) < 20 * 3600e3) return "ok";
    const fh = await h.getFileHandle(`contabilitate-backup-${localISO()}.json`, { create: true }), w = await fh.createWritable();
    await w.write(JSON.stringify(await backupData())); await w.close();
    const old = []; for await (const [n] of h.entries()) if (/^contabilitate-backup-\d{4}-\d{2}-\d{2}\.json$/.test(n)) old.push(n);
    old.sort(); for (const n of old.slice(0, -30)) await h.removeEntry(n).catch(() => {});
    const now = new Date().toISOString(); lsSet(LA_KEY, now); lsSet(LB_KEY, now); return "ok";
  }
};
async function renderAuto() {
  const el = document.getElementById("bk-auto"); if (!el) return;
  const last = lsGet(LB_KEY), h = Auto.ok ? await Auto.handle() : null;
  el.innerHTML = `<div class="hint" style="margin:8px 0 6px">${last ? T(`Ultimul backup: ${fmtDate(last.slice(0, 10))}.`, `Letzte Sicherung: ${fmtDate(last.slice(0, 10))}.`) : T("Încă nu ai făcut niciun backup pe acest dispozitiv.", "Auf diesem Gerät wurde noch keine Sicherung erstellt.")}
    ${h ? T(` Backup automat zilnic în dosarul „${esc(h.name)}” (se păstrează ultimele 30).`, ` Tägliche automatische Sicherung im Ordner „${esc(h.name)}“ (die letzten 30 bleiben).`) : ""}</div>
    ${Auto.ok ? `<button class="btn" id="bk-auto-btn">📁 ${h ? T("Schimbă dosarul de backup automat", "Sicherungsordner ändern") : T("Backup automat într-un dosar", "Automatische Sicherung in Ordner")}</button>`
      : `<div class="hint">${T("Pe acest browser nu se poate salva automat într-un dosar (merge în Chrome/Edge pe PC). Aplicația îți amintește să faci backup, iar sincronizarea cu cloud-ul ține o copie și acolo.", "In diesem Browser ist keine automatische Ordnersicherung möglich (geht in Chrome/Edge am PC). Die App erinnert dich an Sicherungen; die Cloud-Synchronisation hält eine Kopie.")}</div>`}
    <div class="hint">${T("Backup-ul conține și documentele atașate (poze bonuri, E-Rechnung primite).", "Die Sicherung enthält auch angehängte Belege (Fotos, empfangene E-Rechnungen).")}</div>`;
  document.getElementById("bk-auto-btn")?.addEventListener("click", () => Auto.choose().catch(e => { if (e.name !== "AbortError") toast(e.message, 4000); }));
}
async function backupReminder() {
  const n = KINDS.filter(k => k !== "audit").reduce((s, k) => s + Object.keys(S[k]).length, 0); if (n < 3) return;
  let st = "none"; try { st = Auto.ok ? await Auto.run(false) : "none"; } catch (e) { console.warn("backup automat", e); }
  if (st === "ok") return;
  const last = lsGet(LB_KEY), days = last ? (Date.now() - Date.parse(last)) / 864e5 : Infinity;
  if (st !== "perm" && days < (Store.mode === "cloud" ? 30 : 7)) return;
  if (document.getElementById("bk-remind")) return;
  const b = document.createElement("div"); b.id = "bk-remind"; b.className = "banner"; b.style.margin = "0 0 10px";
  b.innerHTML = st === "perm" ? `${T("Backup-ul automat are nevoie de permisiunea ta pentru dosar.", "Die automatische Sicherung braucht deine Erlaubnis für den Ordner.")} <button class="btn small primary" data-b="perm">${T("Permite", "Erlauben")}</button>`
    : `${last ? T(`Ultimul backup e din ${fmtDate(last.slice(0, 10))}.`, `Letzte Sicherung vom ${fmtDate(last.slice(0, 10))}.`) : T("Nu ai făcut încă niciun backup.", "Noch keine Sicherung.")} ${Store.mode === "cloud" ? "" : T("Datele sunt doar pe acest dispozitiv – dacă se strică, se pierd.", "Die Daten liegen nur auf diesem Gerät.")}
      <button class="btn small primary" data-b="now">${T("Fă backup acum", "Jetzt sichern")}</button> <button class="btn small" data-b="later">${T("Mai târziu", "Später")}</button>`;
  b.addEventListener("click", async ev => {
    const a = ev.target.dataset.b; if (!a) return;
    if (a === "later") { lsSet(LB_KEY, new Date(Date.now() - (Store.mode === "cloud" ? 27 : 5) * 864e5).toISOString()); b.remove(); }
    if (a === "now") await doBackup();
    if (a === "perm") { const h = await Auto.handle(); if (h && (await h.requestPermission({ mode: "readwrite" })) === "granted") { await Auto.run(true); b.remove(); toast(T("Backup salvat în dosar.", "Sicherung gespeichert.")); renderAuto(); } }
  });
  const host = document.getElementById("banner"); host ? host.after(b) : document.body.prepend(b);
}
try { navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {}); } catch (e) {}

/* ======================================================================
   Export DATEV (Buchungsstapel, format EXTF 700) – doar profilul Germania.
   Conturile sunt propuneri SKR03 / SKR04 și se pot schimba; verifică-le cu Steuerberater-ul.
   ====================================================================== */
const DATEV_DEF = {
  "03": { bank: "1200", cash: "1000", card: "1360", rev: "8200", revKU: "8195", subs: "2700", otherin: "2700",
    plants: "3200", fert: "3200", pack: "4710", wages: "4100", fuel: "4530", mach: "4805", rent: "4220", energy: "4240", ins: "4360", office: "4920", advice: "4950", other: "4900" },
  "04": { bank: "1800", cash: "1600", card: "1460", rev: "4200", revKU: "4185", subs: "4830", otherin: "4830",
    plants: "5200", fert: "5200", pack: "6710", wages: "6010", fuel: "6530", mach: "6460", rent: "6315", energy: "6325", ins: "6400", office: "6805", advice: "6825", other: "6300" } };
const DATEV_LBL = { bank: ["Bancă", "Bank"], cash: ["Casă (numerar)", "Kasse"], card: ["Card (Geldtransit)", "Geldtransit (Karte)"], rev: ["Venituri (vânzări)", "Erlöse"], revKU: ["Venituri Kleinunternehmer", "Erlöse § 19 UStG"],
  subs: ["Subvenții", "Zuschüsse"], otherin: ["Alte venituri", "Sonstige Erträge"] };
const datevCfg = () => { const c = S.settings.datev || {}; const skr = c.skr === "04" ? "04" : "03"; return { berater: c.berater || "", mandant: c.mandant || "", skr, acc: { ...DATEV_DEF[skr], ...((c.acc || {})[skr] || {}) } }; };
const cp1252 = s => { const map = { "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "–": 0x96, "—": 0x97 };
  const out = []; for (const ch of String(s)) { const c = ch.codePointAt(0); if (c < 0x80 || (c >= 0xA0 && c <= 0xFF)) out.push(c); else if (map[ch]) out.push(map[ch]);
    else { const b = ch.normalize("NFD")[0]; const bc = b.codePointAt(0); out.push(bc < 0x80 ? bc : 0x3F); } } return new Uint8Array(out); };
function datevRows(from, to) {
  const c = datevCfg(), A = c.acc, P = prof("de"), warn = [];
  const rows = journal().filter(r => r.pid === "de" && r.date >= from && r.date <= to).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const out = rows.map(r => {
    const money_ = { bank: A.bank, cash: A.cash, card: A.card }[r.pay] || A.bank;
    let acc = r.type === "in" ? (["invoice", "direct"].includes(r.cat) ? (P.kleinunternehmer ? A.revKU : A.rev) : A[r.cat] || A.otherin) : (A[r.cat] || A.other);
    let bu = "";
    if (r.vat && !P.kleinunternehmer) { bu = r.type === "in" ? ({ 19: "3", 7: "2" })[r.rate] : ({ 19: "9", 7: "8" })[r.rate]; if (!bu) { bu = ""; warn.push(T(`${fmtDate(r.date)} ${r.doc || r.party}: cota ${pct(r.rate)} nu are cheie DATEV standard – completează la contabil.`, `${fmtDate(r.date)} ${r.doc || r.party}: Steuersatz ${pct(r.rate)} ohne Standard-BU-Schlüssel.`)); } }
    const amt = r2(r.gross), neg = amt < 0, sh = (r.type === "in") !== neg ? "S" : "H";
    return { amt: Math.abs(amt), sh, konto: money_, gegen: acc, bu, date: r.date, doc: r.doc, text: [r.party, r.desc].filter(Boolean).join(" ") };
  });
  return { rows: out, warn, cfg: c };
}
function datevCSV(from, to) {
  const { rows, warn, cfg } = datevRows(from, to);
  const q = v => `"${String(v ?? "").replace(/"/g, "'")}"`, d = n => n.toFixed(2).replace(".", ","), now = new Date();
  const ts = now.getFullYear() + [now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()].map(x => String(x).padStart(2, "0")).join("") + String(now.getMilliseconds()).padStart(3, "0");
  const ymd = s => s.replace(/-/g, "");
  const head = ["\"EXTF\"", 700, 21, q("Buchungsstapel"), 13, ts, "", q("RE"), q(""), q(""), cfg.berater || 1001, cfg.mandant || 1, from.slice(0, 4) + "0101", 4, ymd(from), ymd(to),
    q(("Contabilitate " + from.slice(0, 7)).slice(0, 30)), q(""), 1, 0, 0, q("EUR"), "", q(""), "", "", q(cfg.skr), "", "", q(""), q("")].join(";");
  const cols = ["Umsatz (ohne Soll/Haben-Kz)", "Soll/Haben-Kennzeichen", "WKZ Umsatz", "Kurs", "Basis-Umsatz", "WKZ Basis-Umsatz", "Konto", "Gegenkonto (ohne BU-Schlüssel)", "BU-Schlüssel", "Belegdatum", "Belegfeld 1", "Belegfeld 2", "Skonto", "Buchungstext"].join(";");
  const lines = rows.map(r => [d(r.amt), q(r.sh), q("EUR"), "", "", q(""), r.konto, r.gegen, q(r.bu), r.date.slice(8, 10) + r.date.slice(5, 7),
    q(String(r.doc || "").replace(/[^A-Za-z0-9$&%*+\-/]/g, "").slice(0, 36)), q(""), "", q(r.text.slice(0, 60))].join(";"));
  return { bytes: cp1252([head, cols, ...lines].join("\r\n") + "\r\n"), n: rows.length, warn, cfg };
}
window.datevCSV = datevCSV;
window.datevForm = () => {
  const c = datevCfg(), year = $("#bk-year").value !== "all" && $("#bk-year").value ? $("#bk-year").value : localISO().slice(0, 4), month = $("#bk-month").value;
  const opts = [["", T("Tot anul", "Ganzes Jahr")], ...MONTHS.map((m, i) => [String(i + 1).padStart(2, "0"), m]), ...[1, 2, 3, 4].map(k => ["Q" + k, T(`Trimestrul ${k}`, `${k}. Quartal`)])];
  const keys = ["bank", "cash", "card", "rev", "revKU", "subs", "otherin", ...CAT_OUT.map(x => x[0])];
  const lbl = k => DATEV_LBL[k] ? T(...DATEV_LBL[k]) : T(CATS[k].ro, CATS[k].de);
  const o = sheet(`<h3>${T("Export DATEV pentru Steuerberater", "DATEV-Export für den Steuerberater")}</h3>
    <div class="hint">${T("Fișier „Buchungsstapel” (DATEV-Format) cu încasările și plățile din Germania. Conturile de mai jos sunt propuneri – întreabă-ți contabilul ce cadru de conturi folosește (la ferme adesea SKR14) și ajustează-le o singură dată.", "Datei „Buchungsstapel“ (DATEV-Format) mit den Einnahmen/Ausgaben in Deutschland. Die Konten sind Vorschläge – frag deinen Steuerberater nach dem Kontenrahmen und passe sie einmal an.")}</div>
    <div class="grid3"><div class="fld"><label class="f">${T("Anul", "Jahr")}</label><input type="number" id="dv-y" value="${esc(year)}"></div>
      <div class="fld"><label class="f">${T("Perioada", "Zeitraum")}</label><select id="dv-p">${opts.map(([v, l]) => `<option value="${v}" ${v === month ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
      <div class="fld"><label class="f">${T("Cadru de conturi", "Kontenrahmen")}</label><select id="dv-skr"><option value="03">SKR03</option><option value="04" ${c.skr === "04" ? "selected" : ""}>SKR04</option></select></div></div>
    <div class="grid2"><div class="fld"><label class="f">Beraternummer</label><input type="text" inputmode="numeric" id="dv-b" value="${esc(c.berater)}"></div>
      <div class="fld"><label class="f">Mandantennummer</label><input type="text" inputmode="numeric" id="dv-m" value="${esc(c.mandant)}"></div></div>
    <details><summary style="cursor:pointer;font-weight:700;margin:6px 0">${T("Conturi", "Konten")}</summary><div class="grid2" id="dv-acc">${keys.map(k => `<div class="fld"><label class="f">${esc(lbl(k))}</label><input type="text" inputmode="numeric" data-acc="${k}" value="${esc(c.acc[k])}"></div>`).join("")}</div></details>
    <div id="dv-info" class="hint"></div>
    <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" data-a="x">${T("Renunță", "Abbrechen")}</button><button class="btn primary" data-a="ok">${T("Descarcă fișierul DATEV", "DATEV-Datei herunterladen")}</button></div>`);
  const q = s => o.querySelector(s);
  q("#dv-skr").addEventListener("change", ev => { const d = { ...DATEV_DEF[ev.target.value], ...(((S.settings.datev || {}).acc || {})[ev.target.value] || {}) }; o.querySelectorAll("[data-acc]").forEach(i => i.value = d[i.dataset.acc]); });
  o.addEventListener("click", async ev => {
    const a = ev.target.dataset.a; if (ev.target === o || a === "x") return o.remove(); if (a !== "ok") return;
    const skr = q("#dv-skr").value, acc = {}; o.querySelectorAll("[data-acc]").forEach(i => { if (i.value.trim() && i.value.trim() !== DATEV_DEF[skr][i.dataset.acc]) acc[i.dataset.acc] = i.value.trim(); });
    const old = S.settings.datev || {}, datev = { berater: q("#dv-b").value.trim(), mandant: q("#dv-m").value.trim(), skr, acc: { ...(old.acc || {}), [skr]: acc } };
    await safe(() => Store.put("settings", { ...S.settings, datev }));
    const y = q("#dv-y").value, p = q("#dv-p").value, [from, to] = periodRange(y, p);
    const r = datevCSV(from, to);
    if (!r.n) { toast(T("Nicio înregistrare în Germania în perioada aleasă.", "Keine Buchungen (DE) im Zeitraum.")); return; }
    await saveFile(`EXTF_Buchungsstapel_${from.replace(/-/g, "")}_${to.replace(/-/g, "")}.csv`, new Blob([r.bytes], { type: "text/csv" }));
    q("#dv-info").innerHTML = esc(T(`${r.n} înregistrări exportate.`, `${r.n} Buchungen exportiert.`)) + (datev.berater && datev.mandant ? "" : "<br>⚠️ " + esc(T("Lipsește Berater- / Mandantennummer – le afli de la contabil.", "Berater- / Mandantennummer fehlt – beim Steuerberater erfragen."))) + r.warn.slice(0, 5).map(w => "<br>⚠️ " + esc(w)).join("");
  });
};
function periodRange(y, p) {
  if (!p) return [`${y}-01-01`, `${y}-12-31`];
  const last = m => String(new Date(+y, m, 0).getDate()).padStart(2, "0");
  if (/^Q\d$/.test(p)) { const k = +p[1], m1 = (k - 1) * 3 + 1, m3 = k * 3; return [`${y}-${String(m1).padStart(2, "0")}-01`, `${y}-${String(m3).padStart(2, "0")}-${last(m3)}`]; }
  return [`${y}-${p}-01`, `${y}-${p}-${last(+p)}`];
}

/* ======================================================================
   Declarația TVA: Umsatzsteuer-Voranmeldung (DE) / Umsatzsteuervoranmeldung UVA (AT)
   ====================================================================== */
function vatReport(pid, from, to, mode) {
  const inP = d => d && d >= from && d <= to, rows = [];
  if (mode === "soll") {
    Object.values(S.invoices).forEach(inv => { if (inv.status === "cancelled" || pidOf(inv) !== pid || !inP(inv.date)) return; calcInv(inv).vats.forEach(v => rows.push({ type: "in", net: v.base, vat: v.amount, rate: v.rate })); });
    journal().filter(r => r.pid === pid && r.src !== "inv" && inP(r.date)).forEach(r => rows.push(r));
    Object.values(S.entries).filter(e => e.paid === false && e.type === "out" && pidOf(e) === pid && inP(e.date)).forEach(e => { const c = entryCalc(e); rows.push({ type: "out", net: c.net, vat: c.vat, rate: c.rate }); });
  } else journal().filter(r => r.pid === pid && inP(r.date)).forEach(r => rows.push(r));
  const byRate = {}; let vst = 0, netIn = 0;
  rows.forEach(r => { if (r.type === "in") { const b = byRate[r.rate] || (byRate[r.rate] = { net: 0, vat: 0 }); b.net += r.net; b.vat += r.vat; netIn += r.net; } else vst += r.vat; });
  Object.values(byRate).forEach(b => { b.net = r2(b.net); b.vat = r2(b.vat); });
  return { byRate, vst: r2(vst), netIn: r2(netIn), n: rows.length };
}
function vatLines(pid, rep) {
  const L = [], br = rep.byRate, rates = Object.keys(br).map(Number).sort((a, b) => b - a), eur = n => Math.trunc(n);
  let tax = 0;
  if (pid === "de") {
    const P = prof("de"), r24 = P.pauschal ? parseNum(P.rate24 || "7,8") : null;
    rates.forEach(r => { const b = br[r];
      if (r === 19) { const t = r2(eur(b.net) * 0.19); tax += t; L.push(["81", T("Livrări taxabile 19 %", "Steuerpflichtige Umsätze 19 %"), eur(b.net) + ",00 €", money(t)]); }
      else if (r === 7) { const t = r2(eur(b.net) * 0.07); tax += t; L.push(["86", T("Livrări taxabile 7 %", "Steuerpflichtige Umsätze 7 %"), eur(b.net) + ",00 €", money(t)]); }
      else if (r === 0) L.push(["41 / 43 / 48", T("Livrări fără TVA (0 % / scutite – rândul depinde de motiv, întreabă contabilul)", "Umsätze ohne USt (Kennzahl je nach Grund)"), money(b.net), ""]);
      else if (r === r24) L.push(["—", T(`Livrări § 24 UStG (${pct(r)}) – la Pauschallandwirte TVA-ul nu se declară lunar`, `Umsätze nach § 24 UStG (${pct(r)}) – nicht in der Voranmeldung`), money(b.net), money(b.vat)]);
      else { tax += b.vat; L.push(["35 / 36", T(`Livrări la altă cotă (${pct(r)})`, `Umsätze zu anderen Steuersätzen (${pct(r)})`), money(b.net), money(b.vat)]); } });
    L.push(["66", T("TVA deductibilă (Vorsteuer)", "Abziehbare Vorsteuerbeträge"), "", money(rep.vst)]);
    const res = r2(tax - (P.pauschal ? 0 : rep.vst));
    L.push(["83", T("De plătit (minus = de primit înapoi)", "Verbleibende Vorauszahlung (minus = Erstattung)"), "", money(res)]);
  } else {
    L.push(["000", T("Total livrări (bază)", "Gesamtbetrag der Bemessungsgrundlagen"), money(rep.netIn), ""]);
    const kz = { 20: "022", 10: "029", 13: "006" };
    rates.forEach(r => { const b = br[r]; if (r) tax += b.vat;
      L.push([kz[r] || (r ? "—" : "—"), r ? T(`Cotă ${pct(r)}`, `Steuersatz ${pct(r)}`) : T("Fără TVA / scutite (0 %)", "Steuerfrei / 0 %"), money(b.net), r ? money(b.vat) : ""]); });
    L.push(["060", T("TVA deductibilă (Vorsteuer)", "Vorsteuern"), "", money(rep.vst)]);
    L.push(["095", T("De plătit (minus = credit)", "Zahllast (minus = Gutschrift)"), "", money(r2(tax - rep.vst))]);
  }
  return L;
}
window.vatReport = vatReport; window.vatLines = vatLines;
window.vatForm = () => {
  let pid = $("#bk-prof").value || defPid();
  const y0 = $("#bk-year").value !== "all" && $("#bk-year").value ? $("#bk-year").value : localISO().slice(0, 4);
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); const pm = String(d.getMonth() + 1).padStart(2, "0");
  const opts = [...MONTHS.map((m, i) => [String(i + 1).padStart(2, "0"), m]), ...[1, 2, 3, 4].map(k => ["Q" + k, T(`Trimestrul ${k}`, `${k}. Quartal`)]), ["", T("Tot anul", "Ganzes Jahr")]];
  const o = sheet(`<h3>🧾 ${T("Declarația de TVA", "Umsatzsteuer-Voranmeldung")}</h3>
    <div class="row fld"><div class="seg" id="vt-prof">${PIDS.map(p => `<button data-v="${p}">${prof(p).flag}</button>`).join("")}</div></div>
    <div class="grid3"><div class="fld"><label class="f">${T("Anul", "Jahr")}</label><input type="number" id="vt-y" value="${esc(y0)}"></div>
      <div class="fld"><label class="f">${T("Perioada", "Zeitraum")}</label><select id="vt-p">${opts.map(([v, l]) => `<option value="${v}" ${v === pm ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
      <div class="fld"><label class="f">${T("Impozitare", "Versteuerung")}</label><select id="vt-mode"><option value="ist">${T("după încasare (Ist)", "nach vereinnahmten Entgelten (Ist)")}</option><option value="soll">${T("după data facturii (Soll)", "nach vereinbarten Entgelten (Soll)")}</option></select></div></div>
    <div id="vt-out"></div>
    <div class="hint">${T("Sumele sunt calculate din registrul aplicației. Verifică-le (sau dă-le contabilului) înainte să le treci în ELSTER / FinanzOnline.", "Berechnet aus dem Buchungsjournal der App. Vor der Übertragung in ELSTER / FinanzOnline prüfen.")}</div>
    <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" data-a="csv">CSV</button><button class="btn primary" data-a="x">OK</button></div>`);
  const q = s => o.querySelector(s);
  q("#vt-mode").value = ((S.settings.vatMode || {})[pid]) || "ist";
  let lines = [];
  const draw = () => {
    o.querySelectorAll("#vt-prof button").forEach(b => b.classList.toggle("on", b.dataset.v === pid));
    const [from, to] = periodRange(q("#vt-y").value, q("#vt-p").value), mode = q("#vt-mode").value, P = prof(pid), rep = vatReport(pid, from, to, mode);
    lines = vatLines(pid, rep);
    const note = P.kleinunternehmer ? T("Profil Kleinunternehmer: de regulă nu depui declarații lunare de TVA (doar declarația anuală).", "Kleinunternehmer: in der Regel keine Voranmeldungen.")
      : P.pauschal ? T("Pauschallandwirt: TVA-ul din vânzările § 24 e compensat cu TVA-ul pe cheltuieli – de regulă nu depui declarații lunare pentru ele.", "Pauschallandwirt: Umsätze nach § 24 sind in der Regel nicht voranmeldungspflichtig.") : "";
    q("#vt-out").innerHTML = `${note ? `<div class="banner" style="margin-bottom:8px">${esc(note)}</div>` : ""}<div class="card" style="padding:6px 10px;overflow-x:auto"><table class="t">
      <tr><th>${pid === "de" ? "Kz." : "KZ"}</th><th></th><th>${T("Bază", "Bemessungsgrundlage")}</th><th>${T("TVA", "Steuer")}</th></tr>
      ${lines.map(l => `<tr${["83", "095"].includes(l[0]) ? ' class="sum"' : ""}><td><b>${esc(l[0])}</b></td><td>${esc(l[1])}</td><td style="white-space:nowrap">${esc(l[2])}</td><td style="white-space:nowrap">${esc(l[3])}</td></tr>`).join("")}</table></div>
      <div class="hint">${esc(fmtDate(from))} – ${esc(fmtDate(to))} · ${rep.n} ${T("înregistrări", "Buchungen")}${pid === "de" ? " · " + T("Kz. 81/86: euro întregi, cum cere ELSTER.", "Kz. 81/86 in vollen Euro.") : ""}</div>`;
  };
  q("#vt-prof").addEventListener("click", ev => { if (ev.target.dataset.v) { pid = ev.target.dataset.v; q("#vt-mode").value = ((S.settings.vatMode || {})[pid]) || "ist"; draw(); } });
  ["#vt-y", "#vt-p"].forEach(s => q(s).addEventListener("input", draw));
  q("#vt-mode").addEventListener("change", async () => { await safe(() => Store.put("settings", { ...S.settings, vatMode: { ...(S.settings.vatMode || {}), [pid]: q("#vt-mode").value } })); draw(); });
  draw();
  o.addEventListener("click", async ev => {
    const a = ev.target.dataset.a; if (ev.target === o || a === "x") return o.remove();
    if (a === "csv") { const qq = v => `"${String(v ?? "").replace(/"/g, '""')}"`; const [from, to] = periodRange(q("#vt-y").value, q("#vt-p").value);
      await saveFile(`USt_${prof(pid).flag}_${from}_${to}.csv`, "﻿" + [["Kz", "Bezeichnung", "Bemessungsgrundlage", "Steuer"], ...lines].map(l => l.map(qq).join(";")).join("\r\n")); }
  });
};

/* ======================================================================
   Somații: Zahlungserinnerung / 1. Mahnung / Letzte Mahnung (PDF), cu istoric pe factură
   ====================================================================== */
const DUN = {
  de: { t: ["Zahlungserinnerung", "Mahnung", "Letzte Mahnung"], hi: "Sehr geehrte Damen und Herren,",
    body: [(n, d, a, due) => `sicherlich ist es Ihrer Aufmerksamkeit entgangen, dass unsere Rechnung Nr. ${n} vom ${d} über ${a} noch offen ist. Wir bitten Sie, den Betrag bis zum ${due} zu überweisen.`,
      (n, d, a, due) => `leider konnten wir zu unserer Rechnung Nr. ${n} vom ${d} über ${a} bis heute keinen Zahlungseingang feststellen. Bitte überweisen Sie den unten genannten Gesamtbetrag bis spätestens ${due}.`,
      (n, d, a, due) => `trotz unserer bisherigen Erinnerungen ist die Rechnung Nr. ${n} vom ${d} über ${a} weiterhin unbezahlt. Bitte überweisen Sie den Gesamtbetrag bis spätestens ${due}. Andernfalls sehen wir uns gezwungen, ohne weitere Ankündigung rechtliche Schritte einzuleiten.`],
    bye: "Sollten Sie die Zahlung bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.\n\nMit freundlichen Grüßen", inv: (n, d) => `Rechnung Nr. ${n} vom ${d}`, fee: "Mahngebühr", sum: "Zu zahlen", date: "Datum", ref: "Verwendungszweck" },
  ro: { t: ["Amintire de plată", "Somație", "Ultima somație"], hi: "Stimate client,",
    body: [(n, d, a, due) => `vă reamintim că factura nr. ${n} din ${d}, în valoare de ${a}, nu a fost încă achitată. Vă rugăm să plătiți suma până la ${due}.`,
      (n, d, a, due) => `până astăzi nu am primit plata pentru factura nr. ${n} din ${d}, în valoare de ${a}. Vă rugăm să achitați suma totală de mai jos până cel târziu la ${due}.`,
      (n, d, a, due) => `în ciuda amintirilor anterioare, factura nr. ${n} din ${d}, în valoare de ${a}, este în continuare neplătită. Vă rugăm să achitați suma totală până cel târziu la ${due}; în caz contrar vom fi nevoiți să facem demersuri legale.`],
    bye: "Dacă ați efectuat deja plata, vă rugăm să ignorați această scrisoare.\n\nCu stimă", inv: (n, d) => `Factura nr. ${n} din ${d}`, fee: "Taxă de somație", sum: "De plată", date: "Data", ref: "Referință plată" } };
function buildDunningPDF(inv, rec) {
  const { jsPDF } = window.jspdf, doc = new jsPDF({ unit: "mm", format: "a4" }), lang = inv.lang === "ro" ? "ro" : "de", L = LBL[lang], D = DUN[lang], { M, R } = PG, c = inv.customer || {};
  const { ry, rEnd } = pdfHeader(doc, L, [c.name, ...String(c.address || "").split("\n")].map(x => (x || "").trim()).filter(Boolean), pidOf(inv));
  let iy = ry; doc.setFontSize(9);
  [[D.date, fmtDate(rec.date)], [L.no, inv.number], ...(c.number ? [[L.custNo, c.number]] : [])].forEach(([k, v]) => { doc.setTextColor(110); doc.text(P(k), 118, iy); doc.setTextColor(25); doc.text(P(v || ""), R, iy, { align: "right" }); iy += 5; });
  let y = Math.max(100, iy + 12, rEnd + 14);
  const title = rec.level === 2 ? `1. ${D.t[1]}` : D.t[Math.min(2, rec.level - 1)];
  doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.text(P(title), M, y); y += 10; doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  const g = calcInv(inv).gross, fee = parseNum(rec.fee);
  y = paragraph(doc, D.hi, y);
  y = paragraph(doc, D.body[Math.min(2, rec.level - 1)](inv.number, fmtDate(inv.date), money(g, inv.currency), fmtDate(rec.due)), y);
  y = totalsBox(doc, [[D.inv(inv.number, fmtDate(inv.date)), money(g, inv.currency)], ...(fee ? [[D.fee, money(fee, inv.currency)]] : [])], [D.sum, money(r2(g + fee), inv.currency)], y);
  const s = S.settings;
  if (s.iban) y = paragraph(doc, `${L.iban} ${s.iban}${s.bic ? "  ·  " + L.bic + " " + s.bic : ""}${s.holder ? "  ·  " + s.holder : ""}\n${D.ref}: ${inv.number}`, y);
  y = paragraph(doc, D.bye, y + 2);
  y = paragraph(doc, s.owner || s.name || "", y);
  pdfFooter(doc, L, pidOf(inv)); return doc;
}
window.buildDunningPDF = buildDunningPDF;
window.dunningForm = async () => {
  if (dirty || ed._isNew) { if (!(await saveInvoice(true))) return; }
  const inv = S.invoices[ed.id]; if (!inv) return;
  const prev = inv.dunning || [], lvl = Math.min(3, prev.length + 1);
  const o = sheet(`<h3>${T("Somație pentru factura", "Mahnung zur Rechnung")} ${esc(inv.number)}</h3>
    <div class="hint">${T(`Scadentă din ${fmtDate(inv.dueDate)} · ${money(calcInv(inv).gross)}`, `Fällig seit ${fmtDate(inv.dueDate)} · ${money(calcInv(inv).gross)}`)}${prev.length ? "<br>" + prev.map(p => `${esc(DUN.de.t[Math.min(2, p.level - 1)])} ${esc(fmtDate(p.date))}`).join(" · ") : ""}</div>
    <div class="grid3"><div class="fld"><label class="f">${T("Treapta", "Stufe")}</label><select id="dn-l">${[1, 2, 3].map(l => `<option value="${l}" ${l === lvl ? "selected" : ""}>${[T("Amintire", "Zahlungserinnerung"), T("Somație", "1. Mahnung"), T("Ultima somație", "Letzte Mahnung")][l - 1]}</option>`).join("")}</select></div>
      <div class="fld"><label class="f">${T("Taxă de somație €", "Mahngebühr €")}</label><input type="text" inputmode="decimal" id="dn-fee" value="${["0", "5,00", "10,00"][lvl - 1]}"></div>
      <div class="fld"><label class="f">${T("Plătibil până la", "Zahlbar bis")}</label><input type="date" id="dn-due" value="${addDays(localISO(), lvl === 3 ? 7 : 10)}"></div></div>
    <div class="hint">${T("Taxa de somație trebuie să fie rezonabilă (de regulă 2–10 €). Prima amintire se trimite de obicei fără taxă.", "Die Mahngebühr sollte angemessen sein (meist 2–10 €). Die erste Erinnerung meist ohne Gebühr.")}</div>
    <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" data-a="x">${T("Renunță", "Abbrechen")}</button><button class="btn primary" data-a="ok">${T("Creează PDF", "PDF erstellen")}</button></div>`);
  o.querySelector("#dn-l").addEventListener("change", ev => { o.querySelector("#dn-fee").value = ["0", "5,00", "10,00"][ev.target.value - 1]; });
  o.addEventListener("click", async ev => {
    const a = ev.target.dataset.a; if (ev.target === o || a === "x") return o.remove(); if (a !== "ok") return;
    const rec = { level: +o.querySelector("#dn-l").value, date: localISO(), fee: o.querySelector("#dn-fee").value.trim(), due: o.querySelector("#dn-due").value };
    if (!rec.due) { toast(T("Alege termenul.", "Frist wählen.")); return; }
    const inv2 = { ...inv, dunning: [...prev, rec] };
    if (!(await safe(() => Store.put("invoices", inv2)))) return;
    ed.dunning = inv2.dunning; o.remove();
    downloadPDF(() => buildDunningPDF(inv2, rec), `${rec.level === 1 ? "Zahlungserinnerung" : "Mahnung"}_${inv.number}.pdf`);
  });
};

/* ======================================================================
   ZUGFeRD / Factur-X: PDF-ul facturii cu XML-ul XRechnung atașat înăuntru (profil XRECHNUNG).
   Se adaugă la PDF printr-o actualizare incrementală (fișier atașat + metadate XMP).
   ====================================================================== */
function pdfAttachXml(pdf, xml, { fname = "xrechnung.xml", level = "XRECHNUNG", title = "" } = {}) {
  const enc = new TextEncoder(), s = new TextDecoder("latin1").decode(pdf);
  const sx = s.lastIndexOf("startxref"), prevXref = parseInt(/startxref\s+(\d+)/.exec(s.slice(sx))[1], 10);
  const trailer = s.slice(s.lastIndexOf("trailer", sx), sx);
  const size = +/\/Size\s+(\d+)/.exec(trailer)[1], rootNum = +/\/Root\s+(\d+)\s+0\s+R/.exec(trailer)[1];
  const info = /\/Info\s+(\d+\s+\d+\s+R)/.exec(trailer), id = /\/ID\s*(\[[^\]]*\])/.exec(trailer);
  const cm = new RegExp(`(?:^|\\s)${rootNum}\\s+0\\s+obj\\s*<<([\\s\\S]*?)>>\\s*endobj`).exec(s);
  if (!cm || /\/(Names|AF)\b/.test(cm[1])) throw new Error("PDF neașteptat – nu pot atașa XML-ul.");
  const cat = cm[1].replace(/\/Metadata\s+\d+\s+\d+\s+R/, "");
  const now = new Date(), pad = n => String(n).padStart(2, "0");
  const pdfDate = `D:${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const xb = enc.encode(xml), E = size, F = size + 1, N = size + 2, X = size + 3;
  const esc_ = t => String(t).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const xmp = enc.encode(`<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>3</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description>
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc_(title)}</rdf:li></rdf:Alt></dc:title></rdf:Description>
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:CreatorTool>Contabilitate privata</xmp:CreatorTool><xmp:CreateDate>${now.toISOString().slice(0, 19)}Z</xmp:CreateDate></rdf:Description>
<rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"><fx:DocumentType>INVOICE</fx:DocumentType><fx:DocumentFileName>${fname}</fx:DocumentFileName><fx:Version>1.0</fx:Version><fx:ConformanceLevel>${level}</fx:ConformanceLevel></rdf:Description>
<rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
<pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource"><pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema><pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI><pdfaSchema:prefix>fx</pdfaSchema:prefix>
<pdfaSchema:property><rdf:Seq>${[["DocumentFileName", "name of the embedded XML invoice file"], ["DocumentType", "INVOICE"], ["Version", "The actual version of the standard applying to the embedded XML document"], ["ConformanceLevel", "The conformance level of the embedded XML document"]]
    .map(([n, d]) => `<rdf:li rdf:parseType="Resource"><pdfaProperty:name>${n}</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>${d}</pdfaProperty:description></rdf:li>`).join("")}</rdf:Seq></pdfaSchema:property></rdf:li></rdf:Bag></pdfaExtension:schemas></rdf:Description>
</rdf:RDF></x:xmpmeta>
<?xpacket end="w"?>`);
  const parts = [], offs = {}; let len = pdf.length;
  const add = b => { parts.push(b); len += b.length; }, addS = t => add(enc.encode(t));
  if (pdf[pdf.length - 1] !== 10) addS("\n");
  offs[E] = len; addS(`${E} 0 obj\n<< /Type /EmbeddedFile /Subtype /text#2Fxml /Params << /ModDate (${pdfDate}) /Size ${xb.length} >> /Length ${xb.length} >>\nstream\n`); add(xb); addS("\nendstream\nendobj\n");
  offs[F] = len; addS(`${F} 0 obj\n<< /Type /Filespec /F (${fname}) /UF (${fname}) /AFRelationship /Alternative /Desc (Factur-X / ZUGFeRD ${level}) /EF << /F ${E} 0 R /UF ${E} 0 R >> >>\nendobj\n`);
  offs[N] = len; addS(`${N} 0 obj\n<< /Names [(${fname}) ${F} 0 R] >>\nendobj\n`);
  offs[X] = len; addS(`${X} 0 obj\n<< /Type /Metadata /Subtype /XML /Length ${xmp.length} >>\nstream\n`); add(xmp); addS("\nendstream\nendobj\n");
  offs[rootNum] = len; addS(`${rootNum} 0 obj\n<<${cat} /Names << /EmbeddedFiles ${N} 0 R >> /AF [${F} 0 R] /Metadata ${X} 0 R /PageMode /UseAttachments >>\nendobj\n`);
  const xref = len, ent = o => String(o).padStart(10, "0") + " 00000 n \n";
  addS(`xref\n0 1\n0000000000 65535 f \n${rootNum} 1\n${ent(offs[rootNum])}${E} 4\n${[E, F, N, X].map(k => ent(offs[k])).join("")}trailer\n<< /Size ${size + 4} /Root ${rootNum} 0 R${info ? " /Info " + info[1] : ""}${id ? " /ID " + id[1] : ""} /Prev ${prevXref} >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(len); out.set(pdf, 0); let p = pdf.length; parts.forEach(b => { out.set(b, p); p += b.length; });
  return out;
}
window.pdfAttachXml = pdfAttachXml;
window.zugferdPDF = inv => {
  const pdf = new Uint8Array(buildInvoicePDF(inv).output("arraybuffer"));
  return pdfAttachXml(pdf, buildXRechnung(inv), { title: `Rechnung ${inv.number}` });
};
window.exportZugferd = async inv => {
  const { err, warn } = xrCheck(inv);
  if (err.length) { exportXRechnung(inv); return; } // arată lista cu ce lipsește
  const base = String(inv.number || "Rechnung").replace(/[^\w.-]+/g, "_");
  try { await saveFile(`${base}_ZUGFeRD.pdf`, new Blob([zugferdPDF(inv)], { type: "application/pdf" })); }
  catch (e) { console.error(e); toast(T("Nu s-a putut crea PDF-ul ZUGFeRD.", "ZUGFeRD-PDF konnte nicht erstellt werden."), 4000); return; }
  toast(warn[0] || T("PDF cu E-Rechnung înăuntru (ZUGFeRD). Clientul îl poate citi ca PDF sau importa automat.", "PDF mit eingebetteter E-Rechnung (ZUGFeRD)."), 5000);
};

/* ======================================================================
   Butoane și pornire
   ====================================================================== */
const on = (id, fn) => { const el = document.getElementById(id); el && el.addEventListener("click", fn); };
on("bk-vat", () => vatForm()); on("bk-datev", () => datevForm()); on("bk-lock", () => lockForm());
on("ed-dun", () => dunningForm());
on("ed-zf", async () => { if (dirty || ed._isNew) { if (!(await saveInvoice(true))) return; } exportZugferd(S.invoices[ed.id] || ed); });
document.addEventListener("change", e => { const t = e.target; if (!t.matches || !t.matches("input[type=file][data-einv]")) return; const f = [...t.files]; t.value = ""; importEInvoice(f); });
if (typeof I18N_EXACT !== "undefined") [["📄 E-Rechnung primită", "📄 E-Rechnung empfangen"], ["🧾 Declarație TVA", "🧾 USt-Voranmeldung"], ["🔒 Închide luna", "🔒 Monatsabschluss"],
  ["Somație", "Mahnung"], ["Documente atașate (bon, factură)", "Belege (Foto, Rechnung)"], ["📎 Atașează", "📎 Anhängen"], ["Pauschallandwirt (§ 24 UStG)", "Pauschallandwirt (§ 24 UStG)"],
  ["Cotă § 24 (%)", "Durchschnittssatz § 24 (%)"]].forEach(([a, b]) => I18N_EXACT.set(a, b));
window.lockInfo = lockInfo; window.renderAuto = renderAuto;
const whenReady = () => { if (!Store.engine || !document.getElementById("loading")?.classList.contains("hidden")) return setTimeout(whenReady, 300); lockInfo(); renderAuto(); setTimeout(backupReminder, 2500); };
whenReady();
})();
