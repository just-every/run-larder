// The Odoo export shapes this kit reads: Odoo 17/18 "import-compatible export"
// CSV files (technical field names, an External ID column `id`, relations as
// `field/id`, one2many lines on continuation rows whose parent cells are blank).
export type Model = 'res.partner' | 'uom.uom' | 'product.product' | 'stock.location' | 'mrp.bom' | 'stock.quant' | 'sale.order' | 'purchase.order'

export const shapes: Record<Model, { label: string; required: string[]; optional: string[]; lines?: string }> = {
  'res.partner': { label: 'Contacts', required: ['id', 'name'], optional: ['is_company', 'email', 'vat', 'customer_rank', 'supplier_rank'] },
  'uom.uom': { label: 'Units of measure', required: ['id', 'name', 'category_id/id', 'uom_type'], optional: ['factor', 'factor_inv', 'active'] },
  'product.product': { label: 'Products', required: ['id', 'default_code', 'name', 'uom_id/id'], optional: ['type', 'is_storable', 'product_tmpl_id/id', 'product_template_attribute_value_ids', 'route_ids/id', 'standard_price', 'list_price', 'uom_po_id/id', 'active'] },
  'stock.location': { label: 'Locations', required: ['id', 'complete_name', 'usage'], optional: ['active'] },
  'mrp.bom': { label: 'Bills of materials', required: ['id', 'product_tmpl_id/id', 'product_qty', 'product_uom_id/id', 'bom_line_ids/product_id/id', 'bom_line_ids/product_qty', 'bom_line_ids/product_uom_id/id'], optional: ['product_id/id', 'code', 'type', 'operation_ids/name', 'operation_ids/workcenter_id/id', 'operation_ids/time_cycle_manual'], lines: 'bom_line_ids/' },
  'stock.quant': { label: 'On-hand quantities (opening count)', required: ['product_id/id', 'location_id/id', 'quantity'], optional: ['id', 'lot_id/name', 'inventory_date', 'product_uom_id/id'] },
  'sale.order': { label: 'Sales orders', required: ['id', 'name', 'partner_id/id', 'state', 'order_line/product_id/id', 'order_line/product_uom_qty', 'order_line/price_unit'], optional: ['commitment_date', 'client_order_ref', 'order_line/qty_delivered', 'order_line/product_uom/id', 'validity_date', 'date_order'], lines: 'order_line/' },
  'purchase.order': { label: 'Purchase orders', required: ['id', 'name', 'partner_id/id', 'state', 'order_line/product_id/id', 'order_line/product_qty', 'order_line/price_unit'], optional: ['date_planned', 'partner_ref', 'order_line/qty_received', 'order_line/product_uom/id', 'date_order'], lines: 'order_line/' },
}
export const models = Object.keys(shapes) as Model[]

// A file is recognised by its model name, as Odoo names exports `<model> (...)`.
export function modelOf(name: string, declared?: unknown): Model | null {
  if (typeof declared === 'string' && models.includes(declared as Model)) return declared as Model
  const base = name.toLowerCase().replace(/\.csv$/, '')
  return models.find(m => base === m || base.startsWith(m + ' ') || base.startsWith(m + '_') || base.startsWith(m + '(')) ?? null
}
