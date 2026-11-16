# Priyatham Chimmani — Personal portfolio

A responsive, dependency-free portfolio built with semantic HTML, CSS, and a small progressive enhancement. Run `node scripts/dev-server.mjs` and open http://127.0.0.1:8000 for the portfolio and verification API. Set `PORT` to change the port. No packages or build step are required for local development. A static-only server also serves the pages, but server verification requires the API.

- `index.html`: editorial landing page with five independent focus areas, research, experience, and contact.
- `assets/portfolio.css`: responsive styling, keyboard focus states, and reduced-motion support.
- `assets/portfolio.js`: current-year enhancement; navigation works without JavaScript.
- `labs/`: standalone interactive demonstrations using synthetic data.

The original portfolio remains available at https://priyatham-personal-site.vercel.app and is linked from both the header area and footer. Case studies link back to the original site. Research links point to the public research projects. Demonstrations are not employer production systems.

## Scenario verification API

`POST /api/analysis` with `Content-Type: application/json` accepts `{"model":"finance","inputs":{"dso":30,"dio":60,"dpo":30}}` or `{"model":"crm","inputs":{"cohort":"inbound","rate":0.5}}`. Finance additionally accepts revenue and cogs; omitted fields use lab defaults. CRM cohorts are all, inbound, and outbound. Responses include version, synthetic, model, normalized inputs, and result.

The stateless Node function shares the labs' pure formulas. It rejects unknown fields, nonnumeric values, negative values, rates above 1, days above 3650, dollar inputs above 1 trillion, and bodies above 4096 bytes. It requires no secrets, accounts, database, or external services. This verifies reproducibility of synthetic calculations, rather than real-world forecasting accuracy.

Run backend and HTTP checks with `node --test tests/analysis.test.mjs`.
