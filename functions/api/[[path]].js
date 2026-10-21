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
    RETURN s.supplier_id AS id, s.supplier_name AS name, s.phone AS phone, count(m) AS medicines,
           collect(m.medicine_name) AS supplies ORDER BY id`,
  employees: `
    MATCH (e:Employee) OPTIONAL MATCH (e)-[:HANDLES]->(s:Sale)
    RETURN e.employee_id AS id, e.employee_name AS name, e.phone AS phone, count(s) AS sales ORDER BY id`,
  history: `
    MATCH (c:Customer)-[:MAKES]->(s:Sale)-[r:CONTAINS]->(m:Medicine)<-[:SUPPLIES]-(sup:Supplier)
    RETURN c.customer_name AS customer, s.sale_id AS sale, m.medicine_name AS medicine,
           r.quantity AS qty, sup.supplier_name AS supplier ORDER BY customer, sale`,
  prescriptions: `
    MATCH (c:Customer)-[:HAS_PRESCRIPTION]->(p:Prescription)
    RETURN c.customer_id AS customer_id, c.customer_name AS customer, p.prescription_id AS id,
           p.doctor_name AS doctor, toString(p.prescription_date) AS date ORDER BY id`,
  supplier_list: `MATCH (s:Supplier) RETURN s.supplier_id AS id, s.supplier_name AS name ORDER BY id`,
  customer_list: `MATCH (c:Customer) RETURN c.customer_id AS id, c.customer_name AS name ORDER BY id`,
  employee_list: `MATCH (e:Employee) RETURN e.employee_id AS id, e.employee_name AS name ORDER BY id`,
  graph: `
    CALL () {
      MATCH (n)
      RETURN collect({id: elementId(n), group: labels(n)[0],
                      label: coalesce(n.medicine_name, n.supplier_name, n.customer_name, n.employee_name,
                                      n.doctor_name, 'Sale ' + n.sale_id)}) AS nodes
    }
    CALL () {
      MATCH (a)-[r]->(b)
      RETURN collect({from: elementId(a), to: elementId(b), label: type(r) + coalesce(' x' + r.quantity, '')}) AS edges
    }
    RETURN nodes, edges`,
};

// Employees and suppliers share the same shape: auto ID, name, phone. Labels and property
// names come from this fixed table (never from user input), since Cypher can't parameterise them.
const PEOPLE = {
  employee: { label: 'Employee', key: 'employee_id', name: 'employee_name', base: 300 },
  supplier: { label: 'Supplier', key: 'supplier_id', name: 'supplier_name', base: 100 },
};
const PHONE = /^\d{10}$/;

function parsePerson(f) {
  const p = { name: String(f.name ?? '').trim(), phone: String(f.phone ?? '').trim() };
  if (!p.name) return 'Name is required';
  if (p.name.length > 100) return 'Name is too long';
  if (!PHONE.test(p.phone)) return 'Phone must be exactly 10 digits';
  return p;
}

async function savePerson(env, kind, id, p) {
  const { label, key, name, base } = PEOPLE[kind];
  if (id === null) {
    const rows = await run(env, `
      CALL () { MATCH (x:${label}) RETURN coalesce(max(x.${key}), ${base}) + 1 AS nid }
      CREATE (n:${label} {${key}: nid, ${name}: $name, phone: $phone})
      RETURN n.${key} AS id`, p);
    return json({ ok: true, id: rows[0].id });
  }
  const rows = await run(env, `
    MATCH (n:${label} {${key}: $id}) SET n.${name} = $name, n.phone = $phone
    RETURN n.${key} AS id`, { ...p, id });
  return rows.length ? json({ ok: true, id }) : json({ error: `${label} ${id} not found` }, 404);
}
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

function parsePrescription(f) {
  const p = { customer: Number(f.customer), doctor: String(f.doctor ?? '').trim(), date: String(f.date ?? '') };
  if (!Number.isInteger(p.customer)) return 'Choose a customer';
  if (!p.doctor) return 'Doctor name is required';
  if (p.doctor.length > 100) return 'Doctor name is too long';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date) || isNaN(Date.parse(p.date))) return 'Prescription date must be a valid date';
  return p;
}

// Create: link the new Prescription to its customer. Update: change details and re-link
// HAS_PRESCRIPTION if the customer changed. Both return no rows if the customer/prescription is missing.
const CREATE_PRESCRIPTION = `
  MATCH (c:Customer {customer_id: $customer})
  CALL () { MATCH (x:Prescription) RETURN coalesce(max(x.prescription_id), 500) + 1 AS pid }
  CREATE (c)-[:HAS_PRESCRIPTION]->(p:Prescription {prescription_id: pid, doctor_name: $doctor,
                                                   prescription_date: date($date)})
  RETURN p.prescription_id AS id`;
const UPDATE_PRESCRIPTION = `
  MATCH (p:Prescription {prescription_id: $id}), (c:Customer {customer_id: $customer})
  SET p.doctor_name = $doctor, p.prescription_date = date($date)
  WITH p, c
  OPTIONAL MATCH (:Customer)-[old:HAS_PRESCRIPTION]->(p)
  DELETE old
  WITH DISTINCT p, c
  MERGE (c)-[:HAS_PRESCRIPTION]->(p)
  RETURN p.prescription_id AS id`;

const MODES = ['Cash', 'UPI', 'Card'], STATUSES = ['Paid', 'Pending'];

function parsePayment(f) {
  if (!MODES.includes(f.mode)) return `Payment mode must be one of ${MODES.join(', ')}`;
  if (!STATUSES.includes(f.status)) return `Payment status must be one of ${STATUSES.join(', ')}`;
  return { mode: f.mode, status: f.status };
}

function parseSale(f) {
  const pay = parsePayment(f);
  if (typeof pay === 'string') return pay;
  // customer is an existing ID, or 'new' with new_name (+ optional new_phone) to create one.
  const isNew = f.customer === 'new';
  const p = {
    ...pay, customer: isNew ? null : Number(f.customer), employee: Number(f.employee), date: String(f.date ?? ''),
    newName: isNew ? String(f.new_name ?? '').trim() : null,
    newPhone: isNew && String(f.new_phone ?? '').trim() ? String(f.new_phone).trim() : null,
    items: (Array.isArray(f.items) ? f.items : []).map(i => ({ medicine: Number(i.medicine), qty: Number(i.qty) })),
  };
  if (isNew && !p.newName) return 'Enter the new customer\'s name';
  if (isNew && p.newName.length > 100) return 'Customer name is too long';
  if (p.newPhone !== null && !PHONE.test(p.newPhone)) return 'Customer phone must be exactly 10 digits';
  if ((!isNew && !Number.isInteger(p.customer)) || !Number.isInteger(p.employee)) return 'Choose a customer and an employee';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date) || isNaN(Date.parse(p.date))) return 'Sale date must be a valid date';
  if (!p.items.length) return 'Add at least one medicine';
  if (p.items.some(i => !Number.isInteger(i.medicine) || !Number.isInteger(i.qty) || i.qty < 1))
    return 'Each item needs a medicine and a whole-number quantity of at least 1';
  if (new Set(p.items.map(i => i.medicine)).size !== p.items.length) return 'Each medicine can appear only once per sale';
  return p;
}

// Creates the Sale (and a new Customer if needed), its MAKES / HANDLES / CONTAINS relationships
// and reduces stock in ONE transaction. The WHERE re-checks stock and the existing customer
// inside the transaction, so nothing is written if any check fails (returns no rows).
// $customer = null means "create a new customer" with the next free ID.
const CREATE_SALE = `
  UNWIND $items AS it
  MATCH (m:Medicine {medicine_id: it.medicine})
  WITH collect({m: m, qty: it.qty}) AS lines
  WHERE size(lines) = size($items) AND all(l IN lines WHERE l.m.stock >= l.qty)
    AND ($customer IS NULL OR EXISTS { MATCH (:Customer {customer_id: $customer}) })
  MATCH (e:Employee {employee_id: $employee})
  CALL () { MATCH (x:Customer) RETURN coalesce(max(x.customer_id), 200) + 1 AS nextCid }
  MERGE (c:Customer {customer_id: coalesce($customer, nextCid)})
    ON CREATE SET c.customer_name = $newName, c.phone = $newPhone
  CALL () { MATCH (x:Sale) RETURN coalesce(max(x.sale_id), 600) + 1 AS sid }
  CREATE (s:Sale {sale_id: sid, sale_date: date($date), payment_mode: $mode, payment_status: $status})
  CREATE (c)-[:MAKES]->(s), (e)-[:HANDLES]->(s)
  WITH s, lines
  UNWIND lines AS l
  WITH s, l.m AS m, l.qty AS qty
  CREATE (s)-[:CONTAINS {quantity: qty}]->(m)
  SET m.stock = m.stock - qty
  WITH DISTINCT s
  MATCH (c:Customer)-[:MAKES]->(s)
  RETURN s.sale_id AS id, c.customer_id AS customer`;

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
  return json({ ok: true, id: rows[0].id, customer: rows[0].customer });
}

export async function onRequest({ request, env, params }) {
  const path = params.path ?? [];
  const [name, id] = path;
  try {
    if (request.method === 'GET' && path.length === 1 && Object.hasOwn(QUERIES, name)) {
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

    const numId = /^\d+$/.test(id ?? '') ? Number(id) : null;

    // Employees / suppliers: POST creates (auto ID), PUT /<id> updates name and phone.
    if (Object.hasOwn(PEOPLE, name) && ((request.method === 'POST' && path.length === 1) ||
                         (request.method === 'PUT' && numId !== null && path.length === 2))) {
      const p = parsePerson(await request.json().catch(() => ({})));
      if (typeof p === 'string') return json({ error: p }, 400);
      return await savePerson(env, name, request.method === 'PUT' ? numId : null, p);
    }

    if (name === 'prescription' && ((request.method === 'POST' && path.length === 1) ||
                                    (request.method === 'PUT' && numId !== null && path.length === 2))) {
      const p = parsePrescription(await request.json().catch(() => ({})));
      if (typeof p === 'string') return json({ error: p }, 400);
      const isNew = request.method === 'POST';
      const rows = await run(env, isNew ? CREATE_PRESCRIPTION : UPDATE_PRESCRIPTION, { ...p, id: numId });
      if (!rows.length) return json({ error: isNew ? 'Customer not found' : 'Prescription or customer not found' }, 404);
      return json({ ok: true, id: rows[0].id });
    }

    if (request.method === 'POST' && name === 'sale' && path.length === 1) {
      const p = parseSale(await request.json().catch(() => ({})));
      if (typeof p === 'string') return json({ error: p }, 400);
      return await createSale(env, p);
    }

    if (request.method === 'PUT' && name === 'sale' && numId !== null && path.length === 2) {
      // Only payment details are editable; items are fixed once stock has been deducted.
      const p = parsePayment(await request.json().catch(() => ({})));
      if (typeof p === 'string') return json({ error: p }, 400);
      const rows = await run(env, `
        MATCH (s:Sale {sale_id: $id}) SET s.payment_mode = $mode, s.payment_status = $status
        RETURN s.sale_id AS id`, { ...p, id: numId });
      return rows.length ? json({ ok: true }) : json({ error: `Sale ${numId} not found` }, 404);
    }

    if (request.method === 'DELETE' && name === 'sale' && numId !== null && path.length === 2) {
      await run(env, DELETE_SALE, { id: numId });
      return json({ ok: true });
    }

    return json({ error: 'Not found' }, 404);
  } catch (e) {
    return json({ error: e.message }, 502);
  }
}
