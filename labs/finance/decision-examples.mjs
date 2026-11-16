export const provenance =
  "Constructed decision cases; financial run rate inherited from an illustrative demo. Commercial response and constraint inputs are assumptions, not empirical estimates.";
export const base = {
  revenue: 12_000_000,
  cogs: 7_200_000,
  dso: 45,
  dio: 60,
  dpo: 30,
};
export const assumptions = {
  rate: 0.1,
  years: 3,
  limits: { dso: [25, 60], dio: [45, 90], dpo: [15, 45] },
};
export const policies = {
  unchanged: { dso: 45, dio: 60, dpo: 30 },
  collectionsProcess: {
    dso: 35,
    dio: 60,
    dpo: 30,
    annualOperatingCost: 15_000,
    setupCost: 10_000,
  },
  customerDiscount: {
    dso: 35,
    dio: 60,
    dpo: 30,
    discount: 0.01,
    discountShare: 1,
  },
  tighterInventory: { dso: 45, dio: 45, dpo: 30, salesLoss: 0.01 },
  loseSupplierDiscount: {
    dso: 45,
    dio: 60,
    dpo: 45,
    supplierPremium: 0.02 / 0.98,
    supplierShare: 1,
  },
  impossibleCashTarget: { dso: 15, dio: 10, dpo: 90 },
};
