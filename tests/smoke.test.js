const test = require("node:test");
const assert = require("node:assert");
const { loadApp } = require("./load");
test("aplicația pornește fără erori", async t => {
  const { close, run, errors } = await loadApp(); t.after(close);
  assert.strictEqual(typeof run("calcInv"), "function");
  assert.deepStrictEqual(errors.filter(e => !/Not implemented/i.test(e)), []);
});
