# Priyatham Chimmani — Personal portfolio

The original rich portfolio, evolved with independent working labs and server verification. Original Archivo typography, light/dark themes, evidence-led name hero, architecture map, work filters, research, reports, experience, awards, education, certifications, and command palette are preserved. Optional GSAP animation loads from a CDN; all content remains visible when it is unavailable. Run `node scripts/dev-server.mjs` and open http://127.0.0.1:8000 for the portfolio and verification API. Set `PORT` to change the port. No packages or build step are required for local development. A static-only server also serves the pages, but server verification requires the API.

- `index.html`: rich original portfolio with five independent focus areas and dedicated interactive labs.
- `assets/kit.css` and `assets/kit.js`: restored original shared navigation, mobile menu, and progressive enhancements.
- `assets/portfolio.css`: focused layout refinements, lab section, visible animation fallback, keyboard focus states, and reduced-motion support.
- `labs/`: standalone interactive demonstrations with synthetic defaults. Finance also accepts optional user-entered revenue and COGS assumptions, validates them locally, and compares day changes against a baseline using the same annual amounts. Share links include entered amounts; explicit verification submits the scenario to the stateless calculation endpoint.

The original portfolio remains available at https://priyatham-personal-site.vercel.app and is linked from both the header area and footer. Case studies link back to the original site. Research links point to the public research projects. Demonstrations are not employer production systems.

## Scenario verification API

`POST /api/analysis` with `Content-Type: application/json` accepts `{"model":"finance","inputs":{"dso":30,"dio":60,"dpo":30}}` or `{"model":"crm","inputs":{"cohort":"inbound","rate":0.5}}`. Finance additionally accepts revenue and cogs; omitted fields use lab defaults. CRM cohorts are all, inbound, and outbound. Responses include version, synthetic, model, normalized inputs, and result.

The stateless Node function shares the labs' pure formulas. It rejects unknown fields, nonnumeric values, negative values, rates above 1, days above 3650, dollar inputs above 1 trillion, and bodies above 4096 bytes. It requires no secrets, accounts, database, or external services. This verifies reproducibility of illustrative calculations, rather than real-world forecasting accuracy.

Run backend and HTTP checks with `node --test tests/analysis.test.mjs`.
