import test from "node:test";
import assert from "node:assert/strict";
import {
  balances,
  evaluatePolicy,
  breakEvenFrontier,
  tradeCredit,
} from "./decision-model.mjs";
import { base, assumptions, policies } from "./decision-examples.mjs";
const near = (a, b, tolerance = 1e-7) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const evaluate = (p, a = assumptions) => evaluatePolicy(base, p, a);
test("identity policy has zero release, zero commercial cost and zero value", () => {
  const r = evaluate(policies.unchanged);
  near(r.release, 0);
  near(r.npv, 0);
  near(r.annualCommercialCost, 0);
});
test("cash release can rise while value falls below zero", () => {
  const process = evaluate(policies.collectionsProcess),
    discount = evaluate(policies.customerDiscount);
  assert.ok(discount.release > process.release);
  assert.ok(discount.npv < 0);
  assert.ok(process.npv > 0);
  assert.ok(evaluate(policies.tighterInventory).npv < 0);
  assert.ok(evaluate(policies.loseSupplierDiscount).npv < 0);
});
test("DCF equals annual-equivalent value times annuity, without double-counting interest savings", () => {
  for (const rate of [0, 1e-10, 0.01, 0.1, 0.4])
    for (const years of [1, 3, 30])
      for (const p of Object.values(policies)) {
        const r = evaluate(p, { ...assumptions, rate, years });
        near(r.npv, r.annualEquivalentValue * r.annuity, 1e-6);
        near(r.daysRelease + r.economicsRelease, r.release);
      }
});
test("zero discount rate cancels temporary cash release but preserves commercial costs", () => {
  const free = evaluate(
    { dso: 35, dio: 60, dpo: 30 },
    { ...assumptions, rate: 0 },
  );
  near(free.npv, 0);
  const costly = evaluate(policies.customerDiscount, {
    ...assumptions,
    rate: 0,
  });
  near(costly.npv, -120_000 * 3);
});
test("discount and sales-loss frontier roots reprice both margins and balances", () => {
  for (const [policy, parameter] of [
    [policies.customerDiscount, "discount"],
    [policies.tighterInventory, "salesLoss"],
    [policies.loseSupplierDiscount, "supplierPremium"],
  ]) {
    const frontier = breakEvenFrontier(base, policy, assumptions, parameter);
    assert.equal(frontier.inRange, true);
    near(evaluate({ ...policy, [parameter]: frontier.threshold }).npv, 0, 1e-6);
    assert.ok(
      evaluate({ ...policy, [parameter]: frontier.threshold * 0.9 }).npv > 0,
    );
    assert.ok(
      evaluate({ ...policy, [parameter]: frontier.threshold * 1.1 }).npv < 0,
    );
  }
});
test("pure operating-day sensitivities reconcile to dollar denominators", () => {
  const b = balances(base);
  near(
    b.nwc - balances({ ...base, dso: base.dso - 1 }).nwc,
    base.revenue / 365,
  );
  near(b.nwc - balances({ ...base, dio: base.dio - 1 }).nwc, base.cogs / 365);
  near(b.nwc - balances({ ...base, dpo: base.dpo + 1 }).nwc, base.cogs / 365);
});
test("positive DCF does not make operationally infeasible targets acceptable", () => {
  const r = evaluate(policies.impossibleCashTarget);
  assert.ok(r.npv > 0);
  assert.equal(r.feasible, false);
  assert.equal(r.violations.length, 3);
  assert.equal(r.decision, "Outside declared feasible set");
});
test("2/10 net30 trade credit costs 37.24% simple annualized and reverses at its exact EAR", () => {
  const input = {
    discount: 0.02,
    discountDay: 10,
    netDay: 30,
    fundingRate: 0.1,
  };
  const r = tradeCredit(input);
  near(r.simpleAnnualizedRate, 0.3724489795918367);
  assert.equal(r.cheaper, "take discount");
  assert.equal(
    tradeCredit({ ...input, fundingRate: r.effectiveAnnualRate }).cheaper,
    "indifferent",
  );
  assert.equal(
    tradeCredit({ ...input, fundingRate: 0.6 }).cheaper,
    "pay at net date",
  );
});
test("invalid inputs fail explicitly", () => {
  assert.throws(() => evaluate({ ...policies.unchanged, salesLoss: 1.1 }));
  assert.throws(() =>
    evaluate(policies.unchanged, { ...assumptions, limits: undefined }),
  );
  assert.throws(() =>
    tradeCredit({
      discount: 0.02,
      discountDay: 30,
      netDay: 10,
      fundingRate: 0.1,
    }),
  );
});
