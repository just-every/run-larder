import './styles/costing.css'
import { VarianceExplanations } from './variance-explanations'
// Uses Larder's existing cards, forms and responsive table; monetary reports
// stay behind their own live API permission check, never computed in a browser.
import { useEffect, useRef, useState } from 'react'
import { can, rows, type Rec } from './api'
import type { Larder } from './app'
import { Card, Choose, Details, Empty, Field, Form, fileBase64, options, text, Table } from './controls'
import { money } from './format'
const shown = (v: any) => (v === null || v === undefined ? 'Unknown' : v === 'restricted' ? v : money(String(v)))
const reportNames: Record<string, string> = {
  margins: 'Order margins',
  variances: 'Job cost variances',
  performance: 'Production performance',
}
const metricNames: Record<string, string> = {
  onTimeDelivery: 'On-time job delivery',
  scheduleAdherence: 'Schedule adherence',
  utilization: 'Machine utilization',
  availability: 'OEE availability',
  performance: 'OEE performance',
  quality: 'OEE quality',
  oee: 'Overall equipment effectiveness',
  downtime: 'Downtime',
  yield: 'Yield',
  supplierOtif: 'Supplier OTIF',
  forecastError: 'Forecast error',
}
const percentShown = (v: any) =>
  v === null || v === undefined ? 'Unknown' : String(v).startsWith('restricted') ? String(v) : `${v}%`
function MarginStage({ r, stage }: { r: any; stage: 'quoted' | 'committed' | 'actual' }) {
  return (
    <>
      <span>{shown(r[stage === 'actual' ? 'recognizedRevenue' : stage + 'Revenue'])} revenue</span>
      <small>{shown(r[stage + 'Cost'])} cost</small>
      <small>
        {shown(r[stage + 'Margin'])} · {percentShown(r[stage + 'MarginPercent'])} margin
      </small>
    </>
  )
}
const attachment = async (d: FormData) => {
  const f = d.get('evidence') as File
  return f?.size
    ? { name: f.name, contentType: f.type || 'application/octet-stream', base64: await fileBase64(f) }
    : undefined
}

export function CostReports({ larder, report }: { larder: Larder; report: string }) {
  const s = larder.state!,
    [query, setQuery] = useState(''),
    [data, setData] = useState<any>(null),
    [error, setError] = useState(''),
    selectionRef = useRef('')
  const permitted = can(s, ['manager', 'accounts']),
    restricted = (s.actor as any).scope?.costs === true
  useEffect(() => {
    let active = true
    const selection = JSON.stringify([report, query, (s.actor as any).scope, permitted])
    if (selectionRef.current !== selection) { setData(null); selectionRef.current = selection }
    setError('')
    if (permitted)
      fetch(`/api/larder/costing/${report}${query}`, { cache: 'no-store' })
        .then(async (r) => {
          const b: any = await r.json()
          if (!r.ok) throw Error(b.error?.message || 'Report unavailable')
          if (active) setData(b)
        })
        .catch((e) => {
          if (active) setError(e.message)
        })
    return () => {
      active = false
    }
  }, [report, query, s.version, permitted])
  return (
    <div className="page cost-reports">
      <header className="page-head">
        <p className="eyebrow">Handoff</p>
        <h1>{reportNames[report]}</h1>
        <p className="meta">
          USD operational evidence. Unknown values require source records. No payroll, journals or customer messages are
          posted.
        </p>
      </header>
      <nav aria-label="Cost reports">
        <a href="#handoff">Handoff batches</a>
        {Object.entries(reportNames).map(([id, name]) => (
          <span key={id}>
            {' '}
            ·{' '}
            <a href={`#handoff/${id}`} aria-current={report === id ? 'page' : undefined}>
              {name}
            </a>
          </span>
        ))}
      </nav>
      {!permitted ? (
        <Empty>Only accounts and authorized managers can open these reports.</Empty>
      ) : (
        <>
          {restricted && <p role="status">Costs and wages restricted</p>}
          <Card title="Report filters">
            <Form
              submit="Apply report filters"
              onSubmit={(d) => {
                const q = new URLSearchParams()
                for (const [k, v] of d.entries()) if (String(v).trim()) q.set(k, String(v))
                setQuery(q.size ? '?' + q : '')
                return false
              }}
            >
              {report === 'performance' ? (
                <>
                  <Field label="From date" name="from" type="date" required={false} />
                  <Field label="To date" name="to" type="date" required={false} />
                  <Choose
                    label="Site location"
                    name="site"
                    required={false}
                    options={options(rows(s, 'locations'), (x) => x.name)}
                  />
                  <Field label="Work center" name="center" required={false} />
                  <Choose
                    label="Report owner"
                    name="ownerId"
                    required={false}
                    options={options(rows(s, 'people'), (x) => x.name)}
                  />
                </>
              ) : (
                <>
                  <Choose
                    label="Sales order"
                    name="orderId"
                    required={false}
                    options={options(rows(s, 'salesOrders'), (x) => x.reference)}
                  />
                  <Choose
                    label="Customer"
                    name="customerId"
                    required={false}
                    options={options(
                      rows(s, 'parties').filter((p) => p.kind !== 'supplier'),
                      (x) => x.name,
                    )}
                  />
                  <Field label="Channel" name="channel" required={false} />
                </>
              )}
              <Choose
                label="Product"
                name="itemId"
                required={false}
                options={options(rows(s, 'items'), (x) => x.sku)}
              />
            </Form>
          </Card>
          {error ? (
            <p role="alert">{error}</p>
          ) : !data ? (
            <p role="status">Loading report…</p>
          ) : (
            <>
              <p>
                <a className="button" download href={`/api/larder/costing/${report}.csv${query}`}>
                  Download this report CSV
                </a>
              </p>
              {data.basis && <p className="meta">{data.basis}</p>}
              {report === 'margins' && (
                <>
                  <Card title="Sales lines">
                    <Table
                      head={[
                        'Order / product',
                        'Customer / channel',
                        'Quoted cost / margin',
                        'Recognized revenue',
                        'Actual cost / margin',
                        'Open commitments',
                        'Source records',
                      ]}
                    >
                      {data.rows.map((r: any) =>
                        r.restricted ? (
                          <tr key={r.orderId}>
                            <td colSpan={7}>{r.restricted}</td>
                          </tr>
                        ) : (
                          <tr key={r.lineId}>
                            <td>
                              <a href={`#orders/${r.orderId}`}>{r.reference}</a>
                              <small>{r.sku}</small>
                            </td>
                            <td>
                              {r.customer}
                              <small>{r.channel}</small>
                            </td>
                            <td>
                              {shown(r.quotedCost)}
                              <small>{percentShown(r.quotedMarginPercent)}</small>
                            </td>
                            <td>{shown(r.recognizedRevenue)}</td>
                            <td>
                              {shown(r.actualCost)}
                              <small>
                                {shown(r.actualMargin)} · {percentShown(r.actualMarginPercent)}
                              </small>
                            </td>
                            <td>
                              {r.remainingQuantity} units
                              <small>
                                {shown(r.committedRevenue)} revenue · {shown(r.committedCost)} cost
                              </small>
                            </td>
                            <td>
                              {r.missing.map((x: string) => (
                                <p key={x}>{x}</p>
                              ))}
                              <Details
                                label={`Sources ${r.reference}`}
                                value={{ shipments: r.sources, charges: r.charges, jobs: r.jobs }}
                                s={s}
                              />
                            </td>
                          </tr>
                        ),
                      )}
                    </Table>
                  </Card>
                  {['orders', 'products', 'customers', 'channels'].map((key) => (
                    <Card key={key} title={`Margins by ${key}`}>
                      <Table head={['Group', 'Estimated', 'Committed', 'Recognized']}>
                        {data[key].map((r: any, i: number) =>
                          r.restricted ? (
                            <tr key={i}>
                              <td colSpan={4}>{r.restricted}</td>
                            </tr>
                          ) : (
                            <tr key={i}>
                              <td>
                                {r.orderId
                                  ? s.salesOrders.find((x: Rec) => x.id === r.orderId)?.reference
                                  : r.customerId
                                    ? s.parties.find((x: Rec) => x.id === r.customerId)?.name
                                    : r.itemId
                                      ? s.items.find((x: Rec) => x.id === r.itemId)?.sku
                                      : r.channel}
                              </td>
                              <td>
                                <MarginStage r={r} stage="quoted" />
                              </td>
                              <td>
                                <MarginStage r={r} stage="committed" />
                              </td>
                              <td>
                                <MarginStage r={r} stage="actual" />
                              </td>
                            </tr>
                          ),
                        )}
                      </Table>
                    </Card>
                  ))}
                </>
              )}
              {report === 'variances' && (
                <>
                  <Card title="Job costs and variances">
                    <Table
                      head={[
                        'Job / revision',
                        'Standard',
                        'Actual',
                        'Variance',
                        'Good / scrap / WIP',
                        'Source records',
                      ]}
                    >
                      {data.jobs.map((r: any) =>
                        r.restricted ? (
                          <tr key={r.workOrderId}>
                            <td colSpan={6}>{r.restricted}</td>
                          </tr>
                        ) : (
                          <tr key={r.workOrderId}>
                            <td>
                              <a href={`#make/wo/${r.workOrderId}`}>{r.reference}</a>
                              <small>
                                {r.sku} revision {r.bomRevision}
                              </small>
                            </td>
                            <td>{shown(r.standardCost)}</td>
                            <td>{shown(r.actualCost)}</td>
                            <td>{shown(r.costVariance)}</td>
                            <td>
                              {shown(r.goodCost)} / {shown(r.scrapCost)} / {shown(r.wipCost)}
                            </td>
                            <td>
                              {r.missing.map((m: string) => (
                                <p key={m}>{m}</p>
                              ))}
                              <Details label={`Cost sources ${r.reference}`} value={r} s={s} />
                            </td>
                          </tr>
                        ),
                      )}
                    </Table>
                  </Card>
                  <VarianceExplanations larder={larder} />
                  <Card title="Sales order cost reconciliation">
                    <Table head={['Order', 'Quoted cost / margin', 'Actual cost', 'Cost variance', 'Actual margin']}>
                      {data.orders.map((r: any) =>
                        r.restricted ? (
                          <tr key={r.orderId}>
                            <td colSpan={5}>{r.restricted}</td>
                          </tr>
                        ) : (
                          <tr key={r.orderId}>
                            <td>
                              <a href={`#orders/${r.orderId}`}>
                                {s.salesOrders.find((o: Rec) => o.id === r.orderId)?.reference}
                              </a>
                            </td>
                            <td>
                              {shown(r.quotedCost)}
                              <small>{percentShown(r.quotedMarginPercent)}</small>
                            </td>
                            <td>{shown(r.actualCost)}</td>
                            <td>{shown(r.costVariance)}</td>
                            <td>{percentShown(r.actualMarginPercent)}</td>
                          </tr>
                        ),
                      )}
                    </Table>
                  </Card>
                </>
              )}
              {report === 'performance' && (
                <>
                  <Card title="Performance metrics">
                    <Table head={['Metric', 'Numerator', 'Denominator', 'Result', 'Missing data / sources']}>
                      {Object.entries(data.metrics).map(([key, value]) => {
                        const r = value as any
                        return (
                          <tr key={key}>
                            <td>{metricNames[key] ?? key}</td>
                            <td>
                              {r.numerator ?? r.milliseconds ?? '—'}
                              <small>{r.unit}</small>
                            </td>
                            <td>
                              {r.denominator ?? '—'}
                              <small>{r.unit}</small>
                            </td>
                            <td>
                              {r.percent === null || r.percent === undefined
                                ? 'Unknown'
                                : String(r.percent).startsWith('restricted')
                                  ? r.percent
                                  : r.percent + '%'}
                            </td>
                            <td>
                              {r.missing.join('; ') || 'Recorded'}
                              <Details label={`Metric sources ${metricNames[key] ?? key}`} value={r.sources} s={s} />
                            </td>
                          </tr>
                        )
                      })}
                    </Table>
                  </Card>
                  {!restricted && s.actor.role === 'owner' && (
                    <Card title="Save a daily in-app report">
                      <Form
                        submit="Schedule this report"
                        busy={larder.busy}
                        note="The report is due daily in this app. Its owner opens each due snapshot explicitly. Nothing is sent externally."
                        onSubmit={(d) =>
                          larder.run('reports.schedule', {
                            filters: data.filters,
                            consent: d.get('consent') === 'on',
                            reason: text(d, 'reason'),
                          })
                        }
                      >
                        <label className="field">
                          <span>
                            <input type="checkbox" name="consent" required /> I consent to saving this filtered report
                            in the app
                          </span>
                        </label>
                        <Field label="Schedule reason" name="reason" />
                      </Form>
                    </Card>
                  )}
                  <Card title="Scheduled in-app reports">
                    {rows(s, 'reportSchedules').map((r) => (
                      <div key={r.id}>
                        <p>
                          Due {r.nextDate} · {r.status}
                        </p>
                        <Details
                          label="Saved filters and snapshots"
                          value={{ filters: r.filters, snapshots: r.snapshots }}
                          s={s}
                        />
                        {r.status === 'active' && !restricted && s.actor.role === 'owner' && (
                          <>
                            <button
                              className="button"
                              disabled={larder.busy}
                              onClick={() => void larder.run('reports.run', { scheduleId: r.id, version: r.version })}
                            >
                              Open due report
                            </button>
                            <button
                              className="button"
                              disabled={larder.busy}
                              onClick={() =>
                                void larder.run('reports.cancel', {
                                  scheduleId: r.id,
                                  version: r.version,
                                  reason: 'Cancelled in report screen',
                                })
                              }
                            >
                              Cancel schedule
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </Card>
                </>
              )}
            </>
          )}
          {!restricted && report === 'variances' && <CostControls larder={larder} />}
          {!restricted && s.actor.role === 'owner' && report === 'margins' && (
            <Card title="Record a line discount, fee or freight">
              <Form
                submit="Record commercial charge"
                busy={larder.busy}
                onSubmit={async (d) =>
                  larder.run('costing.orderCharge', {
                    orderId: text(d, 'orderId'),
                    lineId: text(d, 'lineId'),
                    kind: text(d, 'kind'),
                    amount: text(d, 'amount'),
                    refundable: d.get('refundable') === 'on',
                    reason: text(d, 'reason'),
                    evidence: await attachment(d),
                  })
                }
              >
                <Choose
                  label="Charge order"
                  name="orderId"
                  options={options(rows(s, 'salesOrders'), (x) => x.reference)}
                />
                <Choose
                  label="Charge sales line"
                  name="lineId"
                  options={rows(s, 'salesOrders').flatMap((o) =>
                    o.lines.map((l: any) => ({
                      value: l.id,
                      label: `${o.reference} · ${s.items.find((i: Rec) => i.id === l.itemId)?.sku}`,
                    })),
                  )}
                />
                <Choose
                  label="Charge kind"
                  name="kind"
                  options={['discount', 'freight-revenue', 'freight-cost', 'fee'].map((value) => ({
                    value,
                    label: value,
                  }))}
                />
                <Field label="Charge USD" name="amount" inputMode="decimal" />
                <label className="field">
                  <span>
                    <input type="checkbox" name="refundable" /> Refund proportionally on a return
                  </span>
                </label>
                <Field label="Charge evidence" name="evidence" type="file" />
                <Field label="Charge reason" name="reason" />
              </Form>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
function CostControls({ larder }: { larder: Larder }) {
  const s = larder.state!,
    jobs = rows(s, 'workOrders').filter((w) => w.status !== 'draft')
  return (
    <>
      <Card title="Versioned allocation policy">
        <Form
          submit="Prepare costing policy"
          busy={larder.busy}
          note="Applies only to jobs released after approval. Machine and overhead costs use active labor hours. Overtime is a costing premium per entry, never payroll."
          onSubmit={(d) => larder.run('costing.policy.prepare', Object.fromEntries(d))}
        >
          {['standardLaborRate', 'machineRate', 'overheadRate', 'overtimeAfterHours', 'overtimeMultiplier'].map(
            (name) => (
              <Field key={name} label={name.replace(/([A-Z])/g, ' $1')} name={name} inputMode="decimal" />
            ),
          )}
          <Field label="Policy reason" name="reason" />
        </Form>
        {rows(s, 'costPolicies').map((r) => (
          <div key={r.id}>
            <p>
              {r.status} · {r.createdAt}
            </p>
            <Details label="Policy terms" value={r} s={s} />
            {r.status === 'draft' && s.actor.role === 'owner' && (
              <Form
                submit="Approve costing policy"
                busy={larder.busy}
                onSubmit={(d) =>
                  larder.run('costing.policy.approve', {
                    policyId: r.id,
                    version: r.version,
                    reason: text(d, 'reason'),
                  })
                }
              >
                <Field label="Policy approval reason" name="reason" />
              </Form>
            )}
          </div>
        ))}
      </Card>
      <Card title="Allocate a job to a sales line">
        {s.actor.role !== 'owner' ? (
          <Empty>The owner records job-to-order allocations.</Empty>
        ) : (
          <>
            <Form
              submit="Link job cost"
              busy={larder.busy}
              onSubmit={(d) => larder.run('costing.link', Object.fromEntries(d))}
            >
              <Choose label="Allocated job" name="workOrderId" options={options(jobs, (w) => w.reference)} />
              <Choose
                label="Allocated order"
                name="orderId"
                options={options(rows(s, 'salesOrders'), (w) => w.reference)}
              />
              <Choose
                label="Allocated sales line"
                name="lineId"
                options={rows(s, 'salesOrders').flatMap((o) =>
                  o.lines.map((l: any) => ({
                    value: l.id,
                    label: `${o.reference} · ${s.items.find((i: Rec) => i.id === l.itemId)?.sku}`,
                  })),
                )}
              />
              <Field label="Allocated units" name="quantity" inputMode="decimal" />
              <Field label="Allocation reason" name="reason" />
            </Form>
          </>
        )}
      </Card>
      <Card title="Additional job service charge">
        <Form
          submit="Prepare service charge"
          busy={larder.busy}
          onSubmit={async (d) =>
            larder.run('costing.charge.prepare', { ...Object.fromEntries(d), evidence: await attachment(d) })
          }
        >
          <Choose label="Charged job" name="workOrderId" options={options(jobs, (w) => w.reference)} />
          <Field label="Service USD" name="amount" inputMode="decimal" />
          <Field label="Service reference" name="reference" />
          <Field label="Service evidence" name="evidence" type="file" />
          <Field label="Service reason" name="reason" />
        </Form>
        {rows(s, 'jobCharges')
          .filter((r) => r.status === 'draft' && s.actor.role === 'owner')
          .map((r) => (
            <Form
              key={r.id}
              title={`${r.reference}: ${shown(r.amount)}`}
              submit="Approve service charge"
              busy={larder.busy}
              onSubmit={(d) =>
                larder.run('costing.charge.approve', { chargeId: r.id, version: r.version, reason: text(d, 'reason') })
              }
            >
              <Field label={`Service approval reason ${r.reference}`} name="reason" />
            </Form>
          ))}
      </Card>
      {s.actor.role === 'owner' && (
        <Card title="Close and value a job">
          <Form
            submit="Close and approve actual valuation"
            busy={larder.busy}
            note="Review the job's source costs above. Closing and its correcting actual valuation are one explicit owner decision; physical movements stay unchanged."
            onSubmit={(d) => {
              const work = jobs.find((w) => w.id === text(d, 'workOrderId'))
              return (
                work &&
                larder.run('costing.close', { workOrderId: work.id, version: work.version, reason: text(d, 'reason') })
              )
            }}
          >
            <Choose
              label="Job to close and value"
              name="workOrderId"
              options={options(
                jobs.filter((w) => w.status === 'released'),
                (w) => w.reference,
              )}
            />
            <Field label="Close and valuation reason" name="reason" />
          </Form>
        </Card>
      )}
      <Card title="Review correcting output valuations">
        <Form
          submit="Prepare valuation review"
          busy={larder.busy}
          note="Closed jobs with complete cost evidence and exact output lots only. Review and approve explicitly; original movements stay unchanged."
          onSubmit={(d) => larder.run('costing.valuation.prepare', Object.fromEntries(d))}
        >
          <Choose
            label="Valuation job"
            name="workOrderId"
            options={options(
              jobs.filter((w) => w.status === 'closed'),
              (w) => w.reference,
            )}
          />
          <Field label="Valuation reason" name="reason" />
        </Form>
        {rows(s, 'costValuations').map((r) => (
          <div key={r.id}>
            <p>
              {r.status} · {s.workOrders.find((w: Rec) => w.id === r.workOrderId)?.reference}
            </p>
            <Details label="Valuation sources and changes" value={r} s={s} />
            {r.status === 'draft' && s.actor.role === 'owner' && (
              <Form
                submit="Approve valuation review"
                busy={larder.busy}
                onSubmit={(d) =>
                  larder.run('costing.valuation.approve', {
                    valuationId: r.id,
                    version: r.version,
                    reason: text(d, 'reason'),
                  })
                }
              >
                <Field label="Valuation approval reason" name="reason" />
              </Form>
            )}
          </div>
        ))}
      </Card>
    </>
  )
}
