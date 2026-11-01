# Deploying SupplyShield with SAP HANA Cloud

## Existing HANA Cloud HDI container

Use the Hackfest-provided SAP HANA Cloud instance and an existing HDI
container service binding. Do not create another HANA database instance or
HDI container for this project. The Cloud Foundry service name in
`manifest.yml` (`supplyshield-db`) must be changed to the already-existing
HDI service name if it differs.

The CAP model and canonical CSV seed data are in `db/schema.cds` and
`db/data/`. After confirming the bound container is the approved target and
reviewing its existing contents, run `cds deploy --to hana` from the
repository root. CAP compiles the model and deploys the generated database
artifacts and CSV seed rows through the bound HDI container. CAP consumes the
existing binding; this project and command do not create the HANA instance or
container.

No HANA deployment or container operation has been run as part of these
changes. Do not deploy seed data to a non-empty container without first
backing it up and reviewing the migration behavior.

## Deploy the application (separate, not performed)

```bash
npm --prefix ui run build
cf push -f deployment/manifest.yml
```

The server detects the bound HDI service through `VCAP_SERVICES` and uses the
HANA connection. `GET /api/health` reports the active engine — verify it says
`"engine": "hana"` after deployment.

## Optional: SAP Generative AI Hub

Create a user-provided service holding the orchestration service key so the
secret stays out of the manifest:

```bash
cf create-user-provided-service supplyshield-aicore -p '{"AICORE_SERVICE_KEY": "<full service key JSON>"}'
```

Add `supplyshield-aicore` to the `services:` list in `manifest.yml` and
re-push. Without it, explanations use the deterministic template and are
labelled as such.

## Local development

CAP development uses ephemeral SQLite by default. To run locally against the
existing HDI container instead, use the approved local service-binding
workflow; do not commit credentials or add a new instance.
