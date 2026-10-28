# Manufacturing source formats

The named move-in clauses retain each incumbent’s source formats, relationships, history and access constraints. No unsupported schema is inferred.

The importer clauses promise working move-in, not that an untested provider format is already supported. Verified source-format fixtures and access diagnostics remain acceptance; current live-source export provenance is field proof:

- Katana: [recipe/BOM CSV/XLSX export](https://support.katanamrp.com/en/articles/5967056-exporting-product-recipes-boms) and [products API](https://developer.katanamrp.com/reference/list-all-products); item-card units, export eligibility, pagination and archived records require explicit capture.
- MRPeasy: [CSV exports](https://www.mrpeasy.com/usage-tips/) and [API v2](https://mrpeasy.readme.io/v2.0/reference/mrpeasy-api); filtered exports and plan-dependent/v1-v2 API coverage must be reconciled.
- Fishbowl: [data query/export API](https://help.fishbowlinventory.com/advanced/s/apidocs/importsandexports.html) and [report exports](https://help.fishbowlinventory.com/resource/advancedreports); use installed-version templates and distinguish current-cost reports from historical valuations.
- Odoo: [relational CSV/XLS exports](https://www.odoo.com/documentation/19.0/es_419/applications/essentials/export_import_data.html) and [JSON-2 API](https://www.odoo.com/documentation/19.0/developer/misc/api/external_api.html); preserve External IDs and discover installed modules/custom fields and company context.
- Fulcrum: [grid/report CSV](https://fulcrumpro.com/manufacturing-software/manufacturing-dashboard-live-reports), [API authentication](https://developers.fulcrumpro.com/docs/authentication) and [API schema](https://api.fulcrumpro.com/swagger/v1/swagger.json); preserve job-specific routing and time snapshots.
- DOSS: [table-export announcement](https://www.doss.com/company/news/2026-h1-product-recap); obtain actual owner exports and schema because no public outbound file-format/API specification was established. Missing documentation is implementation work, not an omitted move-in.

## Retained scope inventory

| Approved input | Named clauses |
| --- | --- |
| Full US manufacturing product and switcher workflows | US-001–US-003, LARDER-001–LARDER-013, LARDER-015–LARDER-020, GOV-001, ENG-001–ENG-008, DEMAND-001–DEMAND-008, MRP-001–MRP-007, MOVE-001–MOVE-008 |
| Dated MRP, finite work-center/labor scheduling, Gantt and promise dates | MRP-001–MRP-007, CAP-001–CAP-009, DEMAND-001, DEMAND-005, DEMAND-006, OPS-001 |
| Tablet/barcode, start/stop, labor, consumption, WIP and rework | LARDER-009, FLOOR-001–FLOOR-010 |
| Actual USD material/labor/overhead, WIP, variances and order margin | US-001, COST-001–COST-008, BUY-005 |
| Live QuickBooks Online and Xero inventory/COGS/WIP | CONN-001, CONN-002, DEMAND-007, BUY-003, COST-002, COST-005, AGENT-004 |
| Shopify, WooCommerce, Amazon and ShipStation | CONN-003–CONN-007 |
| Lot/batch, recall, QC, expiry and Katana/MRPeasy migration | TRACE-001–TRACE-008, MOVE-001, MOVE-002 |
| Inventory integrations, automation and buyer friction | CONN-001–CONN-015, AUTO-001–AUTO-003, ENG-004, ENG-007, US-003, COST-007, MOVE-007 |
| Continuous approved replanning and actual-cost reconciliation | AGENT-001–AGENT-009, CAP-007 |
