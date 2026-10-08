# Documentation

## Guides (English)

| | |
|---|---|
| [`how-it-works.md`](how-it-works.md) | The pipeline from RSS feed to published brief, and the stack |
| [`development.md`](development.md) | Local setup, tests, each service's HTTP surface, configuration |
| [`deployment.md`](deployment.md) | Deploy order, the staging environment, how to tell a deploy worked |
| [`monitoring.md`](monitoring.md) | Where logs and run records land, the ops console, troubleshooting |

Each service also has its own README: [`apps/backend`](../apps/backend), [`apps/frontend`](../apps/frontend), [`services/meridian-ai-worker`](../services/meridian-ai-worker), [`services/meridian-ml-service`](../services/meridian-ml-service).

## Working documents (Chinese)

These are written in Chinese, the project's working language.

| | |
|---|---|
| [`adr/`](adr) | Architecture decision records. Each says what was decided, the measurements behind it, and what was tried and dropped |
| [`../GLOSSARY.md`](../GLOSSARY.md) | The vocabulary used in code, documents and commit messages |
| [`debt.md`](debt.md) | Known technical debt, each item with a decision and what would reopen it |
| [`ROADMAP.md`](ROADMAP.md) | A dated log of what shipped and what was learned; older entries describe code that has since been removed |
| [`agents/`](agents) | How coding agents work in this repository: workflow, where files go, unattended runs |

## Where to start reading the decisions

| If you want to know | Read |
|---|---|
| Why one cluster becomes one block of the brief | [`adr/0003-cluster-as-brief-block.md`](adr/0003-cluster-as-brief-block.md) |
| How sentences are written and then checked against sources | [`adr/0010-brief-block-writer-checker-loop.md`](adr/0010-brief-block-writer-checker-loop.md), [`adr/0012-one-call-sentence-check.md`](adr/0012-one-call-sentence-check.md) |
| How evaluation is done, and why most early harnesses were deleted | [`adr/0006-eval-bootstrap-and-ruler-recalibration.md`](adr/0006-eval-bootstrap-and-ruler-recalibration.md) |
| How the map home page places a story on a country | [`adr/0009-map-homepage.md`](adr/0009-map-homepage.md) |
| How the staging environment is isolated from production | [`adr/0013-staging-environment.md`](adr/0013-staging-environment.md) |
| How the reader's country, name, search and following pages are stored and queried | [`adr/0014-brief-blocks-table.md`](adr/0014-brief-blocks-table.md) to [`adr/0018-entity-pages.md`](adr/0018-entity-pages.md) |
