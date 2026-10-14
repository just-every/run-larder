// Every word on the landing (SPEC.md §1, exact). The drawings' strings are real Larder labels and values.
export const copy = {
  meta: {
    title: 'Larder — take the order, make it, ship it',
    description: 'Larder reserves the stock, drafts what to make or buy, and readies the handoff for your accountant. 100% free and open source.',
  },
  headline: ['Take the order.', 'Make it. Ship it.'],
  sub: 'Larder reserves the stock, drafts what to make or buy, and readies your accountant’s handoff.',
  alternatives: ['Katana', 'Unleashed', 'MRPeasy'],
  run: 'Run Larder',
  docs: 'Read the docs',
  licence: 'Free and open source, MIT licensed.',
  drawingLabel: 'An order taken, made and shipped in Larder',
  sections: [
    { id: 'free', heading: '100% free.', line: 'Free as in cost and free as in code: run it, read it, change it.' },
    { id: 'promised', heading: 'Every board promised once.', line: 'Reserving takes only free stock, so two orders can never claim the same boards.' },
    { id: 'made', heading: 'Made to the BOM you released.', line: 'A work order keeps its bill of materials, even after you change the recipe.' },
    { id: 'short', heading: 'What’s short, already drafted.', line: 'Larder works out what’s short, why, and by when, and drafts the purchase order.' },
    { id: 'handoff', heading: 'Ready for your accountant.', line: 'A valued batch of receipts, shipments and production, matched line by line to your ledger.' },
    { id: 'move-in', heading: 'Move in from Odoo.', line: 'Preview your Odoo export, see every rejected row, and undo before you go live.' },
  ],
  included: {
    heading: 'Also included',
    tiles: [
      { name: 'Lots and quarantine', line: 'Hold a delivery until someone decides.', picture: 'tile-lots' },
      { name: 'Partial receipts', line: 'Receive what arrived; the rest stays expected.', picture: 'tile-partial' },
      { name: 'Stock counts', line: 'Count any shelf; the difference is recorded.', picture: 'tile-counts' },
      { name: 'Returns and corrections', line: 'Fix the record; the original stays.', picture: 'tile-returns' },
      { name: 'People and roles', line: 'Nine roles, from owner to viewer.', picture: 'tile-people' },
      { name: 'Business archive', line: 'Export everything in one checksummed file.', picture: 'tile-archive' },
    ],
  },
  beside: { heading: 'Try it beside what you have.', line: 'Move in a copy of your Odoo export and run this week’s orders through both.' },
} as const
