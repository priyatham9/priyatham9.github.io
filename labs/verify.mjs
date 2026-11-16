export function verification({ container, getPayload, getExpected }) {
  const box = document.createElement("div");
  box.innerHTML =
    '<button class="secondary" type="button">Verify scenario</button><p class="note" role="status">Compare this scenario with a server calculation.</p>';
  container.append(box);
  const button = box.querySelector("button"),
    status = box.querySelector("p");
  let generation = 0;
  return {
    invalidate() {
      generation++;
      status.textContent =
        "Scenario changed. Verify again to compare the current values.";
    },
    init() {
      button.addEventListener("click", async () => {
        const current = ++generation,
          payload = getPayload(),
          expected = getExpected();
        button.disabled = true;
        status.textContent = "Checking scenario…";
        try {
          const response = await fetch("/api/analysis", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!response.ok) throw new Error("unavailable");
          const data = await response.json();
          if (current !== generation) return;
          const matches =
            data.synthetic === true &&
            data.model === payload.model &&
            Object.keys(expected).every((key) =>
              Array.isArray(expected[key])
                ? JSON.stringify(expected[key]) ===
                  JSON.stringify(data.result?.[key])
                : typeof expected[key] === "number" &&
                  Number.isFinite(data.result?.[key]) &&
                  Math.abs(expected[key] - data.result[key]) < 1e-8,
            );
          status.textContent = matches
            ? "Verified: the calculation matches this synthetic scenario."
            : "The verification returned different results. Review the scenario before relying on it.";
        } catch {
          if (current === generation)
            status.textContent =
              "Verification is unavailable here. The local scenario still works; no verification has been completed.";
        } finally {
          button.disabled = false;
        }
      });
    },
  };
}
