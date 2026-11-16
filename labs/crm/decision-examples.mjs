export const provenance =
  "Constructed counterexamples, not empirical CRM records or fitted forecasts.";
// A trails within each stratum, but serves mostly the easy stratum.
export const mixReversal = {
  weights: { easy: 0.5, hard: 0.5 },
  a: [
    { stratum: "easy", wins: 81, nonwins: 9, unresolved: 0 },
    { stratum: "hard", wins: 1, nonwins: 9, unresolved: 0 },
  ],
  b: [
    { stratum: "easy", wins: 10, nonwins: 0, unresolved: 0 },
    { stratum: "hard", wins: 18, nonwins: 72, unresolved: 0 },
  ],
};
// Same observed 10-point advantage for A; unresolved B outcomes can reverse it.
export const censoringReversal = {
  weights: { sameSegment: 1 },
  a: [{ stratum: "sameSegment", wins: 30, nonwins: 60, unresolved: 10 }],
  b: [{ stratum: "sameSegment", wins: 20, nonwins: 30, unresolved: 50 }],
};
