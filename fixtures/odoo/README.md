# Odoo move-in fixtures

Synthetic files in the shape of Odoo 17/18 "I want to update data (import-compatible
export)" CSV exports: technical field names, the External ID in `id`, relations as
`field/id`, and one2many lines on continuation rows with blank parent cells. The
business is invented. They were written from Odoo's published import/export guide,
not exported from a live Odoo database.

They deliberately include rows Larder must refuse: a unit name used twice in one
category with different sizes (`Box`), a product whose unit is that ambiguous box,
a repeated External ID, products with no internal reference, stock at a customer
location, a malformed quantity, and an order that depends on a refused product.
