const test = require("node:test");
const assert = require("node:assert");
const { loadApp } = require("./load");
const { SETTINGS, inv } = require("./fixtures");

test("calcule de bază", async t => {
  const app = await loadApp({ settings: SETTINGS }); t.after(app.close);
  const r2 = app.run("r2"), parseNum = app.run("parseNum"), calcInv = app.run("calcInv");
  assert.strictEqual(r2(10.075), 10.08); assert.strictEqual(r2(1.005), 1.01); assert.strictEqual(r2(-1.005), -1.01); assert.strictEqual(Object.is(r2(-0.001), -0), false);
  for (const [s, n] of [["1.234,56", 1234.56], ["1.200", 1200], ["1,5", 1.5], ["1.5", 1.5], ["-3,2", -3.2], ["", 0], ["19%", 19]]) assert.strictEqual(parseNum(s), n, s);
  // 40 lăzi × 30 kg = 1200 kg: trebuie să rămână 1200, nu 1,2
  assert.strictEqual(parseNum(app.run("numIn")(1200)), 1200);
  const c = calcInv(inv());
  assert.strictEqual(c.net, 657.6); assert.strictEqual(c.vatTotal, r2(645 * 0.07 + 12.6 * 0.19)); assert.strictEqual(c.gross, r2(c.net + c.vatTotal));
  assert.strictEqual(calcInv(inv({ kleinunternehmer: true })).vatTotal, 0);
});

test("numerotare facturi", async t => {
  const app = await loadApp({ settings: SETTINGS }); t.after(app.close);
  const next = app.run("nextInvNumber");
  const y = new Date().getFullYear();
  assert.strictEqual(next(`${y}-03-01`, "de"), `RE-${y}-001`);
  await app.run(`(i => Store.put("invoices", i))`)(inv({ number: `RE-${y}-007`, date: `${y}-02-01` }));
  assert.strictEqual(next(`${y}-03-01`, "de"), `RE-${y}-008`);
  assert.strictEqual(next(`${y}-03-01`, "at"), `RE-AT-${y}-001`);
});

test("jurnal de modificări", async t => {
  const app = await loadApp({ settings: SETTINGS }); t.after(app.close);
  const i = inv({ id: "jj1" });
  await app.run(`(i => Store.put("invoices", i))`)(i);
  assert.strictEqual(app.run("Object.keys(S.audit).length"), 0);
  await app.run(`(i => Store.put("invoices", i))`)({ ...i, updatedAt: 5 }); // doar updatedAt: nu se înregistrează
  assert.strictEqual(app.run("Object.keys(S.audit).length"), 0);
  await app.run(`(i => Store.put("invoices", i))`)({ ...i, notes: "schimbat" });
  await app.run(`Store.del("invoices", "jj1")`);
  const a = app.run("Object.values(S.audit).map(x => x.action).sort().join()");
  assert.strictEqual(a, "delete,edit");
  await assert.rejects(app.run(`Store.del("audit", Object.keys(S.audit)[0])`));
});
