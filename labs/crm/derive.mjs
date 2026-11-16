export const stageNames = [
  "Entered",
  "Qualified",
  "Discovery",
  "Proposal",
  "Won",
];
export function deriveCohort(stages) {
  if (
    !Array.isArray(stages) ||
    stages.length !== 5 ||
    stages.some(
      (n, i) => !Number.isInteger(n) || n < 0 || (i > 0 && n > stages[i - 1]),
    )
  )
    throw new RangeError(
      "Expected five nonnegative, cumulative milestone counts",
    );
  const transitions = stages.slice(1).map((reached, i) => ({
    index: i + 1,
    from: stageNames[i],
    to: stageNames[i + 1],
    previous: stages[i],
    reached,
    loss: stages[i] - reached,
    conversion: stages[i] ? reached / stages[i] : null,
    retained: stages[0] ? reached / stages[0] : null,
  }));
  const maxLoss = Math.max(...transitions.map((t) => t.loss));
  const rates = transitions.map((t) => t.conversion).filter((n) => n !== null);
  const minRate = rates.length ? Math.min(...rates) : null;
  return {
    stages,
    transitions,
    largestLoss: transitions.filter((t) => t.loss === maxLoss),
    lowestConversion: transitions.filter(
      (t) => t.conversion !== null && t.conversion === minRate,
    ),
    empty: stages[0] === 0,
  };
}

export function compareTransition(inboundStages, outboundStages, index) {
  if (!Number.isInteger(index) || index < 1 || index > 4)
    throw new RangeError("Transition must be between one and four");
  const inbound = deriveCohort(inboundStages).transitions[index - 1];
  const outbound = deriveCohort(outboundStages).transitions[index - 1];
  return {
    inbound,
    outbound,
    gapPoints:
      inbound.conversion === null || outbound.conversion === null
        ? null
        : (inbound.conversion - outbound.conversion) * 100,
  };
}
