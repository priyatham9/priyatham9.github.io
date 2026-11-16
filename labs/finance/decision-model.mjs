// Deterministic, pre-tax, constant-real-flow policy model. No estimated elasticities.
const finite = (x, label, min = 0, max = Infinity) => {
  if (!Number.isFinite(x) || x < min || x > max)
    throw new RangeError(`Invalid ${label}`);
  return x;
};
export function balances({ revenue, cogs, dso, dio, dpo }) {
  [revenue, cogs, dso, dio, dpo].forEach((x) => finite(x, "balance input"));
  const ar = (revenue * dso) / 365,
    inventory = (cogs * dio) / 365,
    ap = (cogs * dpo) / 365;
  return { ar, inventory, ap, nwc: ar + inventory - ap, ccc: dso + dio - dpo };
}
export function annuityFactor(rate, years) {
  finite(rate, "discount rate", 0, 1);
  finite(years, "years", 1, 100);
  if (!Number.isInteger(years))
    throw new RangeError("Horizon must use whole years");
  return rate === 0 ? years : -Math.expm1(-years * Math.log1p(rate)) / rate;
}
export function evaluatePolicy(base, policy, assumptions) {
  const baseline = balances(base);
  if (base.cogs > base.revenue)
    throw new RangeError(
      "This prototype requires nonnegative baseline contribution",
    );
  const {
    dso,
    dio,
    dpo,
    salesLoss = 0,
    discount = 0,
    discountShare = 0,
    supplierPremium = 0,
    supplierShare = 0,
    annualOperatingCost = 0,
    setupCost = 0,
  } = policy;
  for (const [key, val] of Object.entries({
    salesLoss,
    discount,
    discountShare,
    supplierPremium,
    supplierShare,
  }))
    finite(val, key, 0, 1);
  finite(annualOperatingCost, "annual operating cost");
  finite(setupCost, "setup cost");
  const { rate, years, limits } = assumptions;
  const annuity = annuityFactor(rate, years),
    terminalFactor = (1 + rate) ** -years;
  if (!limits) throw new RangeError("Declare feasible operating-day ranges");
  const violations = [];
  for (const [key, val] of Object.entries({ dso, dio, dpo })) {
    finite(val, key);
    const bound = limits[key];
    if (
      !Array.isArray(bound) ||
      bound.length !== 2 ||
      bound.some((v) => !Number.isFinite(v) || v < 0) ||
      bound[0] > bound[1]
    )
      throw new RangeError(`Invalid constraint ${key}`);
    if (val < bound[0] || val > bound[1])
      violations.push(
        `${key} must be between ${bound[0]} and ${bound[1]} days`,
      );
  }
  const grossRevenue = base.revenue * (1 - salesLoss);
  const baseVariableCost = base.cogs * (1 - salesLoss);
  const annualDiscountCost = grossRevenue * discount * discountShare;
  const annualSupplierCost = baseVariableCost * supplierPremium * supplierShare;
  const revenue = grossRevenue - annualDiscountCost,
    cogs = baseVariableCost + annualSupplierCost;
  const scenario = balances({ revenue, cogs, dso, dio, dpo });
  const daysOnly = balances({ ...base, dso, dio, dpo });
  const release = baseline.nwc - scenario.nwc;
  const annualLostContribution = (base.revenue - base.cogs) * salesLoss;
  const annualCommercialCost =
    annualLostContribution +
    annualDiscountCost +
    annualSupplierCost +
    annualOperatingCost;
  const npv =
    release -
    setupCost -
    annualCommercialCost * annuity -
    release * terminalFactor;
  return {
    baseline,
    scenario,
    feasible: !violations.length,
    violations,
    release,
    daysRelease: baseline.nwc - daysOnly.nwc,
    economicsRelease: daysOnly.nwc - scenario.nwc,
    annualLostContribution,
    annualDiscountCost,
    annualSupplierCost,
    annualCommercialCost,
    annualEquivalentValue:
      release * rate - annualCommercialCost - setupCost / annuity,
    breakEvenAnnualCostAtCurrentBalances: release * rate - setupCost / annuity,
    annuity,
    terminalFactor,
    terminalReinvestment: release,
    npv,
    decision: violations.length
      ? "Outside declared feasible set"
      : npv > 1e-8
        ? "Positive modeled value"
        : npv < -1e-8
          ? "Negative modeled value"
          : "Break-even",
  };
}
// All these parameters enter linearly when the others are held fixed. Evaluating
// endpoints accounts for their effects on both annual profit and working capital.
export function breakEvenFrontier(
  base,
  policy,
  assumptions,
  parameter,
  range = [0, 1],
) {
  if (
    ![
      "salesLoss",
      "discount",
      "supplierPremium",
      "annualOperatingCost",
      "setupCost",
    ].includes(parameter)
  )
    throw new RangeError("Unsupported frontier parameter");
  const [lo, hi] = range;
  finite(lo, "frontier lower bound");
  finite(hi, "frontier upper bound");
  if (!(hi > lo)) throw new RangeError("Frontier must have positive width");
  const low = evaluatePolicy(base, { ...policy, [parameter]: lo }, assumptions);
  const high = evaluatePolicy(
    base,
    { ...policy, [parameter]: hi },
    assumptions,
  );
  const slope = (high.npv - low.npv) / (hi - lo);
  if (Math.abs(slope) < 1e-10)
    return {
      parameter,
      threshold: null,
      inRange: false,
      slope,
      reason: "Value does not vary with this parameter",
      feasible: low.feasible && high.feasible,
    };
  const threshold = lo - low.npv / slope;
  return {
    parameter,
    threshold,
    inRange: threshold >= lo && threshold <= hi,
    slope,
    favorableSide: slope < 0 ? "below" : "above",
    feasible: low.feasible && high.feasible,
  };
}
export function tradeCredit({ discount, discountDay, netDay, fundingRate }) {
  finite(discount, "discount", 0, 1 - Number.EPSILON);
  finite(discountDay, "discount day");
  finite(netDay, "net day");
  finite(fundingRate, "funding rate", 0, 1);
  if (netDay <= discountDay)
    throw new RangeError("Net date must follow discount date");
  const extraDays = netDay - discountDay;
  const periodBorrowingRate = discount / (1 - discount);
  const simpleAnnualizedRate = (periodBorrowingRate * 365) / extraDays;
  const effectiveAnnualRate = Math.expm1(
    (Math.log1p(periodBorrowingRate) * 365) / extraDays,
  );
  // Per $1 face-value invoice, expressed at the early-payment date.
  const latePaymentPV = (1 + fundingRate) ** (-extraDays / 365);
  const earlyPaymentPV = 1 - discount;
  return {
    extraDays,
    periodBorrowingRate,
    simpleAnnualizedRate,
    effectiveAnnualRate,
    costOfPayingLatePerInvoiceDollar: latePaymentPV - earlyPaymentPV,
    cheaper:
      latePaymentPV > earlyPaymentPV + 1e-12
        ? "take discount"
        : latePaymentPV < earlyPaymentPV - 1e-12
          ? "pay at net date"
          : "indifferent",
  };
}
