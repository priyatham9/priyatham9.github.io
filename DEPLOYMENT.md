# Build and release

The deployable public site is assembled by `python3 scripts/build_site.py` into ignored `dist/`. Python 3.12 and Node 22 are used in CI; no dependency installation is required. Run:

```sh
python3 -m unittest discover -s tests -v
node labs/models.test.mjs
node --test tests/analysis.test.mjs
python3 scripts/build_site.py
python3 -m http.server 8000 --directory dist
```

The static preview serves the interactive models locally. Server verification additionally requires `node scripts/dev-server.mjs` (port 8000 by default). The API is deployed separately as a Vercel Function; its source is never copied into the static artifact.

Only `index.html`, `404.html`, `og.png`, `og.svg`, `assets/`, `labs/`, and `work/peers-ontology-explorer/` are public inputs. The explorer's `data.json` is deliberately public demonstration data. The builder admits web asset extensions, excludes hidden files and test files, rejects symlinks, clears stale output, and checks local HTML, stylesheet, and JavaScript module dependencies. Missing links fail the build. Repository scripts, tests, raw data, configuration, and unrelated work directories are excluded. External original-site links remain external. Runtime API references are accepted only for an implemented API route.

`.github/workflows/site.yml` runs model and Python tests, builds the artifact, and uploads only `dist/`; it does not publish. Existing source-data checks can skip rebuilding the peers dataset when the original source clone is unavailable. No credentials are needed for CI verification.

## Vercel configuration

Use the repository root, Framework Preset **Other**, build command `python3 scripts/build_site.py`, and output directory `dist`. `vercel.json` records these settings, enables clean URLs with trailing slashes, and adds `nosniff` and a strict-origin referrer policy. The install command checks `python3 --version` immediately; Vercel's build image must provide Python 3. Node handles the independent API function and traces its shared model import. Do not publish the repository root as the output directory.

## Release procedure

GitHub write access is verified. Existing GitHub-to-Vercel integrations build pushed branches and deploy production merges. Direct access through the ChatGPT Vercel connector remains restricted; use the existing Git integration and verify its build checks and served output.

1. Review the change, run the commands above and the API tests, then commit it to a review branch. Record the tested commit.
2. Confirm the Vercel team, project, production branch, domain assignments, and current production deployment URL before linking or deploying. Save the existing deployment URL for rollback. The original portfolio at <https://priyatham-personal-site.vercel.app> is a separate live site and should retain its current domain and deployment.
3. Push the review branch and open a pull request. Confirm **Static site verification** passes. Connect the intended Vercel project to this repository if needed; its preview must use the checked-in build settings. Use Vercel Deployment Checks if CI must gate production assignment.
4. Check the preview at `/`, `/labs/foundry/`, `/labs/crm/`, `/labs/finance/`, `/work/peers-ontology-explorer/`, and a nonexistent URL. Exercise lab controls, reset, and server verification. Confirm narrow/mobile layouts, keyboard navigation, asset responses, and the security headers. Confirm `/scripts/build_site.py`, `/tests/test_site_build.py`, and `/data/` do not return source files. Check old-work links resolve to the original site.
5. After merging the reviewed commit, stage a production build without changing domains using `vercel deploy --prod --skip-domain` in the confirmed project. Verify that deployment, then run `vercel promote <tested-production-deployment-url>` to assign production domains. With Git auto-deploy enabled, configure checks before merging so unverified builds cannot be assigned automatically.

Authenticate through the Vercel CLI or dashboard; configure any automation credentials directly in protected provider settings. Do not commit or paste credentials into this repository.

## Rollback

For the new site's project, use Vercel's deployment history or `vercel rollback <previous-production-deployment-url>` to restore the recorded release. Verify `/` and the three labs afterward. Rollback disables automatic production domain assignment; use `vercel promote` on a later tested production deployment to restore it. A source revert alone does not immediately restore the served build.

If a domain was intentionally migrated from the original portfolio, restore that domain's former project assignment and promote its recorded original production deployment. The unchanged original site remains reachable at <https://priyatham-personal-site.vercel.app>. Keep that fallback available while validating the new release.
