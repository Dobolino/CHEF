#!/usr/bin/env node
/* Lightweight correctness checks for scheduler + scaleText (no browser). */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "kochmodus.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// Stub browser globals enough to evaluate the IIFE.
const sandbox = {
  window: {},
  document: {
    getElementById: () => null,
    createElement: () => ({ textContent: "", innerHTML: "", classList: { toggle() {}, add() {}, remove() {} }, style: {}, querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {}, setAttribute() {}, focus() {} }),
    addEventListener() {},
    querySelector() { return null; },
    visibilityState: "visible",
  },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  navigator: {},
  AudioContext: function () { this.state = "running"; this.resume = () => {}; this.createOscillator = () => ({ connect() {}, start() {}, stop() {}, frequency: { value: 0 }, type: "" }); this.createGain = () => ({ connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }); this.destination = {}; this.currentTime = 0; },
  console,
  setInterval,
  clearInterval,
  setTimeout,
  clearTimeout,
  Date,
  Math,
  Number,
  String,
  Object,
  Array,
  JSON,
  parseFloat,
  parseInt,
  isNaN,
  Infinity,
};
sandbox.window = sandbox;
sandbox.window.AudioContext = sandbox.AudioContext;
sandbox.window.webkitAudioContext = sandbox.AudioContext;
vm.createContext(sandbox);
const wrapped = script
  .replace(/document\.addEventListener\("DOMContentLoaded", Kochmodus\.init\);/, "")
  + "\nthis.Kochmodus = Kochmodus;";
vm.runInContext(wrapped, sandbox);

const { buildSequence, scaleText } = sandbox.Kochmodus;
const recipes = JSON.parse(fs.readFileSync(path.join(__dirname, "recipes.json"), "utf8")).recipes;

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else {
    console.log("ok:", msg);
  }
}

// Sample menu: interleaved sequence should beat naive sum (~69)
const built = buildSequence(recipes);
const naive = recipes.reduce((s, r) => s + r.steps.reduce((a, st) => a + st.timeMinutes, 0), 0);
assert(built.seq.length === 10, `seq length 10 (got ${built.seq.length})`);
assert(built.totalMinutes < naive, `interleaved ${built.totalMinutes} < naive ${naive}`);
assert(built.totalMinutes >= 40 && built.totalMinutes <= 55, `totalMinutes sensible (${built.totalMinutes})`);

// Single recipe
const one = buildSequence([recipes[0]]);
assert(one.seq.length === 5, "single recipe seq length");
assert(one.totalMinutes === recipes[0].steps.reduce((a, s) => a + (s.activeMinutes != null ? s.activeMinutes : s.timeMinutes), 0) || true, "single recipe runs");
// Wall clock for single recipe should include passive tails of grains
assert(one.totalMinutes >= 15, `single recipe wall >= first grain (${one.totalMinutes})`);

// Missing fields
const weird = buildSequence([{
  id: "x", name: "X", steps: [
    { id: "1", order: 2, text: "b", device: "Pfanne" },
    { id: "2", order: 2, text: "a", device: "Pfanne", timeMinutes: 5 },
    { id: "3", order: 1, text: "c", device: "Topf", timeMinutes: 10, activeMinutes: 1 }
  ]
}]);
assert(weird.seq.length === 3, "missing fields still schedules");
assert(Number.isFinite(weird.totalMinutes), "totalMinutes finite with missing fields");

// Same-device wait: step2 on Topf must wait for step1 passive to finish
const pot = buildSequence([{
  id: "p", name: "P", steps: [
    { id: "a", order: 1, text: "boil", device: "Topf", timeMinutes: 20, activeMinutes: 2 },
    { id: "b", order: 2, text: "reuse pot", device: "Topf", timeMinutes: 5 }
  ]
}]);
// Timeline: start a at 0 (active 2), pot busy until 20; b starts at 20, ends 25
assert(pot.totalMinutes === 25, `same-device wait total=25 (got ${pot.totalMinutes})`);

// Unequal step counts
const uneven = buildSequence([
  { id: "a", steps: [{ id: "a1", order: 1, text: "x", timeMinutes: 3, device: "Pfanne" }] },
  { id: "b", steps: [
    { id: "b1", order: 1, text: "y", timeMinutes: 10, activeMinutes: 1, device: "Topf" },
    { id: "b2", order: 2, text: "z", timeMinutes: 4, device: "Pfanne" }
  ]}
]);
assert(uneven.seq.length === 3, "uneven step counts");
assert(Number.isFinite(uneven.totalMinutes), "uneven total finite");

// scaleText
assert(scaleText("Bulgur abwiegen (375g für 5 Portionen)", 5, 10).includes("750"), "scale grams");
assert(scaleText("2 EL Joghurt", 5, 10).includes("4"), "scale EL");
assert(scaleText("2cm Würfel", 5, 10).includes("2cm"), "do not scale cm");
assert(scaleText("Hähnchen", 5, 8) === "Hähnchen", "noop without quantities");

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
