// Pharmacy Management System API - Cloudflare Pages Function.
// Talks to Neo4j Aura over its HTTPS Query API (Workers can't open Bolt sockets).

// Read-only dashboard queries (Section 11 of the DA3 report). Dates go out as strings.
const QUERIES = {
  kpis: `
    CALL () { MATCH (m:Medicine) RETURN count(m) AS medicines, sum(m.stock) AS units }
    CALL () { MATCH (c:Customer) RETURN count(c) AS customers }
    CALL () { MATCH (s:Supplier) RETURN count(s) AS suppliers }
    CALL () { MATCH (e:Employee) RETURN count(e) AS employees }
    CALL () { MATCH (s:Sale) RETURN count(s) AS sales }
    CALL () { MATCH (:Sale)-[r:CONTAINS]->(m:Medicine) RETURN sum(r.quantity * m.price) AS revenue }
    RETURN medicines, units, customers, suppliers, employees, sales, revenue`,
  medicines: `
    MATCH (m:Medicine) OPTIONAL MATCH (s:Supplier)-[:SUPPLIES]->(m)
    RETURN m.medicine_id AS id, m.medicine_name AS name, m.category AS category, m.price AS price,
           m.stock AS stock, toString(m.expiry_date) AS expiry, s.supplier_name AS supplier
    ORDER BY id`,
  low_stock: `
    MATCH (m:Medicine) WHERE m.stock < 80
    RETURN m.medicine_name AS name, m.stock AS stock ORDER BY stock`,
  expiring: `
    MATCH (m:Medicine) WHERE m.expiry_date < date('2028-01-01')
    RETURN m.medicine_name AS name, toString(m.expiry_date) AS expiry ORDER BY m.expiry_date`,
  top_medicines: `
    MATCH (:Sale)-[r:CONTAINS]->(m:Medicine)
    RETURN m.medicine_name AS name, sum(r.quantity) AS sold ORDER BY sold DESC`,
  sales: `
    MATCH (c:Customer)-[:MAKES]->(s:Sale)<-[:HANDLES]-(e:Employee), (s)-[r:CONTAINS]->(m:Medicine)
    RETURN s.sale_id AS id, toString(s.sale_date) AS date,
           c.customer_id AS customer_id, c.customer_name AS customer,
           e.employee_id AS employee_id, e.employee_name AS employee,
           s.payment_mode AS mode, s.payment_status AS status,
           collect({medicine: m.medicine_id, name: m.medicine_name, qty: r.quantity}) AS items,
           sum(r.quantity * m.price) AS amount
    ORDER BY id`,
  suppliers: `
    MATCH (s:Supplier) OPTIONAL MATCH (s)-[:SUPPLIES]->(m:Medicine)
    RETURN s.supplier_name AS name, s.phone AS phone, count(m) AS medicines,
           collect(m.medicine_name) AS supplies ORDER BY name`,
  history: `
    MATCH (c:Customer)-[:MAKES]->(s:Sale)-[r:CONTAINS]->(m:Medicine)<-[:SUPPLIES]-(sup:Supplier)
    RETURN c.customer_name AS customer, s.sale_id AS sale, m.medicine_name AS medicine,
           r.quantity AS qty, sup.supplier_name AS supplier ORDER BY customer, sale`,
  prescriptions: `
    MATCH (c:Customer)-[:HAS_PRESCRIPTION]->(p:Prescription)
    RETURN c.customer_name AS customer, p.prescription_id AS id, p.doctor_name AS doctor,
           toString(p.prescription_date) AS date ORDER BY id`,
  supplier_list: `MATCH (s:Supplier) RETURN s.supplier_id AS id, s.supplier_name AS name ORDER BY id`,
  customer_list: `MATCH (c:Customer) RETURN c.customer_id AS id, c.customer_name AS name ORDER BY id`,
  employee_list: `MATCH (e:Employee) RETURN e.employee_id AS id, e.employee_name AS name ORDER BY id`,
  graph: `
    MATCH (a)-[r]->(b)
    WITH collect(DISTINCT a) + collect(DISTINCT b) AS ns, collect(r) AS rs
    UNWIND ns AS n WITH DISTINCT n, rs
    WITH collect({id: elementId(n), group: labels(n)[0],
                  label: coalesce(n.medicine_name, n.supplier_name, n.customer_name, n.employee_name,
                                  n.doctor_name, 'Sale ' + n.sale_id)}) AS nodes, rs
    RETURN nodes, [r IN rs | {from: elementId(startNode(r)), to: elementId(endNode(r)),
                              label: type(r) + coalesce(' x' + r.quantity, '')}] AS edges`,
};
const SINGLE_ROW = new Set(['kpis', 'graph']);

async function run(env, statement, parameters = {}) {
  const host = env.NEO4J_URI.replace(/^.*:\/\//, '');
  const res = await fetch(`https://${host}/db/${env.NEO4J_DATABASE}/query/v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json',
      Authorization: 'Basic ' + btoa(`${env.NEO4J_USERNAME}:${env.NEO4J_PASSWORD}`),
    },
    body: JSON.stringify({ statement, parameters }),
  });
  const body = await res.json();
  if (!res.ok || body.errors?.length) throw new Error(body.errors?.[0]?.message ?? `Neo4j HTTP ${res.status}`);
  const { fields, values } = body.data;
  return values.map(row => Object.fromEntries(fields.map((f, i) => [f, row[i]])));
}

const json = (data, status = 200) => Response.json(data, { status });

function parseMedicine(f) {
  const p = {
    id: Number(f.id), name: String(f.name ?? '').trim(), category: String(f.category ?? '').trim(),
    price: Number(f.price), stock: Number(f.stock), expiry: String(f.expiry ?? ''),
    supplier: f.supplier ? Number(f.supplier) : null,
  };
  if (!Number.isInteger(p.id) || p.id < 1) return 'Medicine ID must be a positive whole number';
  if (!p.name || !p.category) return 'Name and category are required';
  if (!Number.isFinite(p.price) || p.price < 0) return 'Price must be a number >= 0';
  if (!Number.isInteger(p.stock) || p.stock < 0) return 'Stock must be a whole number >= 0';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.expiry) || isNaN(Date.parse(p.expiry))) return 'Expiry must be a valid date';
  if (p.supplier !== null && !Number.isInteger(p.supplier)) return 'Invalid supplier';
  return p;
}

const MODES = ['Cash', 'UPI', 'Card'], STATUSES = ['Paid', 'Pending'];

function parsePayment(f) {
  if (!MODES.includes(f.mode)) return `Payment mode must be one of ${MODES.join(', ')}`;
  if (!STATUSES.includes(f.status)) return `Payment status must be one of ${STATUSES.join(', ')}`;
  return { mode: f.mode, status: f.status };
}

function parseSale(f) {
  const pay = parsePayment(f);
  if (typeof pay === 'string') return pay;
  const p = {
    ...pay, customer: Number(f.customer), employee: Number(f.employee), date: String(f.date ?? ''),
    items: (Array.isArray(f.items) ? f.items : []).map(i => ({ medicine: Number(i.medicine), qty: Number(i.qty) })),
  };
  if (!Number.isInteger(p.customer) || !Number.isInteger(p.employee)) return 'Choose a customer and an employee';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date) || isNaN(Date.parse(p.date))) return 'Sale date must be a valid date';
  if (!p.items.length) return 'Add at least one medicine';
  if (p.items.some(i => !Number.isInteger(i.medicine) || !Number.isInteger(i.qty) || i.qty < 1))
    return 'Each item needs a medicine and a whole-number quantity of at least 1';
  if (new Set(p.items.map(i => i.medicine)).size !== p.items.length) return 'Each medicine can appear only once per sale';
  return p;
}

// Creates the Sale, its MAKES / HANDLES / CONTAINS relationships and reduces stock in ONE
// transaction. The WHERE re-checks stock inside the transaction, so nothing is written if any
// item is short (returns no rows).
const CREATE_SALE = `
  UNWIND $items AS it
  MATCH (m:Medicine {medicine_id: it.medicine})
  WITH collect({m: m, qty: it.qty}) AS lines
  WHERE size(lines) = size($items) AND all(l IN lines WHERE l.m.stock >= l.qty)
  MATCH (c:Customer {customer_id: $customer}), (e:Employee {employee_id: $employee})
  CALL () { MATCH (x:Sale) RETURN coalesce(max(x.sale_id), 600) + 1 AS sid }
  CREATE (s:Sale {sale_id: sid, sale_date: date($date), payment_mode: $mode, payment_status: $status})
  CREATE (c)-[:MAKES]->(s), (e)-[:HANDLES]->(s)
  WITH s, lines
  UNWIND lines AS l
  WITH s, l.m AS m, l.qty AS qty
  CREATE (s)-[:CONTAINS {quantity: qty}]->(m)
  SET m.stock = m.stock - qty
  RETURN DISTINCT s.sale_id AS id`;

// Puts each item's quantity back into stock, then removes the sale and its relationships.
const DELETE_SALE = `
  MATCH (s:Sale {sale_id: $id})
  OPTIONAL MATCH (s)-[r:CONTAINS]->(m:Medicine)
  SET m.stock = m.stock + r.quantity
  WITH DISTINCT s
  DETACH DELETE s
  RETURN count(*) AS deleted`;

async function createSale(env, p) {
  // Friendly pre-check so the user sees which item is the problem.
  const stock = await run(env, `
    UNWIND $items AS it OPTIONAL MATCH (m:Medicine {medicine_id: it.medicine})
    RETURN it.medicine AS id, m.medicine_name AS name, m.stock AS stock, it.qty AS qty`, { items: p.items });
  for (const s of stock) {
    if (s.name === null) return json({ error: `Medicine ${s.id} does not exist` }, 400);
    if (s.stock < s.qty) return json({ error: `Only ${s.stock} units of ${s.name} in stock` }, 400);
  }
  const rows = await run(env, CREATE_SALE, p);
  if (!rows.length) return json({ error: 'Sale not recorded: stock changed or customer/employee not found' }, 409);
  return json({ ok: true, id: rows[0].id });
}

export async function onRequest({ request, env, params }) {
  const path = params.path ?? [];
  const [name, id] = path;
  try {
    if (request.method === 'GET' && path.length === 1 && QUERIES[name]) {
      const rows = await run(env, QUERIES[name]);
      return json(SINGLE_ROW.has(name) ? rows[0] : rows);
    }

    if (request.method === 'POST' && name === 'medicine' && path.length === 1) {
      // Create or update a medicine (MERGE on medicine_id), optionally relinking its supplier.
      const p = parseMedicine(await request.json().catch(() => ({})));
      if (typeof p === 'string') return json({ error: p }, 400);
      await run(env, `
        MERGE (m:Medicine {medicine_id: $id})
        SET m.medicine_name = $name, m.category = $category, m.price = toFloat($price),
            m.stock = $stock, m.expiry_date = date($expiry)
        WITH m WHERE $supplier IS NOT NULL
        MATCH (s:Supplier {supplier_id: $supplier})
        OPTIONAL MATCH (:Supplier)-[old:SUPPLIES]->(m) DELETE old
        MERGE (s)-[:SUPPLIES]->(m)`, p);
      return json({ ok: true });
    }

    if (request.method === 'DELETE' && name === 'medicine' && /^\d+$/.test(id ?? '') && path.length === 2) {
      await run(env, 'MATCH (m:Medicine {medicine_id: $id}) DETACH DELETE m', { id: Number(id) });
      return json({ ok: true });
    }

    const saleId = /^\d+$/.test(id ?? '') ? Number(id) : null;

    if (request.method === 'POST' && name === 'sale' && path.length === 1) {
      const p = parseSale(await request.json().catch(() => ({})));
      if (typeof p === 'string') return json({ error: p }, 400);
      return await createSale(env, p);
    }

    if (request.method === 'PUT' && name === 'sale' && saleId !== null && path.length === 2) {
      // Only payment details are editable; items are fixed once stock has been deducted.
      const p = parsePayment(await request.json().catch(() => ({})));
      if (typeof p === 'string') return json({ error: p }, 400);
      const rows = await run(env, `
        MATCH (s:Sale {sale_id: $id}) SET s.payment_mode = $mode, s.payment_status = $status
        RETURN s.sale_id AS id`, { ...p, id: saleId });
      return rows.length ? json({ ok: true }) : json({ error: `Sale ${saleId} not found` }, 404);
    }

    if (request.method === 'DELETE' && name === 'sale' && saleId !== null && path.length === 2) {
      await run(env, DELETE_SALE, { id: saleId });
      return json({ ok: true });
    }

    return json({ error: 'Not found' }, 404);
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}
