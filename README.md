# Pharmacy Management System – Neo4j Graph Database

A DBMS mini-project that models a pharmacy (medicines, suppliers, customers, employees, prescriptions and sales) as a **property graph in Neo4j AuraDB**, with a live **web dashboard** on top of it, deployed on **Cloudflare Pages**.

**Live demo:** https://pharmacy-dashboard-8gl.pages.dev

This is **Digital Assignment 3** of a three-part project:

| Phase | Focus |
|-------|-------|
| DA1 | ER/EER modelling and normalisation (up to BCNF) into 7 relational tables |
| DA2 | Implementation in Oracle SQL and PL/SQL (procedures, functions, cursors, triggers) |
| **DA3** | **Extension to Neo4j: graph model, Cypher CRUD, graph traversal, and a dashboard** |

---

## Graph model

Six node labels. The relational `Sale_Item` table becomes a `CONTAINS` relationship that stores `quantity`.

```
(Supplier)-[:SUPPLIES]->(Medicine)
(Customer)-[:HAS_PRESCRIPTION]->(Prescription)
(Customer)-[:MAKES]->(Sale)
(Employee)-[:HANDLES]->(Sale)
(Sale)-[:CONTAINS {quantity}]->(Medicine)
```

| Label | Key | Properties |
|-------|-----|------------|
| `Supplier` | `supplier_id` | `supplier_name`, `phone` |
| `Customer` | `customer_id` | `customer_name`, `phone` |
| `Employee` | `employee_id` | `employee_name`, `phone` |
| `Medicine` | `medicine_id` | `medicine_name`, `category`, `price`, `stock`, `expiry_date` |
| `Prescription` | `prescription_id` | `prescription_date`, `doctor_name` |
| `Sale` | `sale_id` | `sale_date`, `payment_mode`, `payment_status` |

Each key has a uniqueness constraint. The sample dataset has **13 nodes and 12 relationships**.

---

## Dashboard features

Each section is its own page behind a sidebar: **Overview, Inventory, Add / Update, Alerts, Sales, New sale, Employees, Suppliers, Prescriptions, Analytics, Graph**. On phones the sidebar becomes a scrollable top bar. Every panel reads live from Neo4j; nothing is hard-coded.

### Overview and analytics
- **KPI cards:** total revenue, medicines, units in stock, sales, customers, suppliers and employees
- **Charts:** units sold per medicine, revenue per sale, and stock level per medicine
- **Alerts:** low stock (< 80 units) and medicines expiring before 2028
- **Live status** in the sidebar shows whether the database is reachable

### Inventory
- **Searchable inventory table** with *Low stock* and *Expiring* flags
- **Add, update and delete medicines** (Cypher `MERGE` and `DETACH DELETE`), optionally linking a supplier

### Sales
- **Sales list** with customer, handling employee, items, payment and amount (`Σ quantity × price`)
- **Record a sale** with several medicines. In **one transaction** it creates the `Sale` node, its `MAKES`, `HANDLES` and `CONTAINS {quantity}` relationships, and reduces each medicine's stock. If any item is short of stock, nothing is written.
- **New or existing customer:** choosing *+ New customer…* creates the `Customer` node in the same transaction as the sale, so a failed sale never leaves a stray customer behind.
- **Update a sale's payment** (mode and status), or **delete a sale**, which returns its items to stock
- **Purchase trace:** a multi-hop traversal `Customer → Sale → Medicine ← Supplier`

### People
- **Employees and suppliers:** add and edit (name, 10-digit phone), with IDs assigned automatically. Employees show how many sales they've handled, and suppliers show the medicines they supply.
- **Prescriptions:** add and edit (customer, doctor, date). Changing the customer re-links the `HAS_PRESCRIPTION` relationship.

### Graph
- **Interactive graph view** of the whole database
- **Click any node or relationship** to see its labels, properties and every connection as JSON, then use the buttons to hop from node to node

### Look and feel
- **Dark (default) and light themes** with an orange accent. Switch with the sun/moon button next to the logo; the choice is remembered.
- **Subtle animations:** page fades, staggered cards, KPI count-up and growing chart bars. All motion is turned off when the operating system's *reduce motion* setting is on.
- Text colours are checked against WCAG AA contrast in both themes.

---

## Tech stack

- **Database:** Neo4j AuraDB (Free tier), Cypher
- **Backend:** a Cloudflare Pages Function in JavaScript. It sends Cypher to Aura over the [Neo4j HTTPS Query API](https://neo4j.com/docs/query-api/current/).
- **Frontend:** plain HTML, CSS and JavaScript in a single page, with [Chart.js](https://www.chartjs.org/) and [vis-network](https://visjs.github.io/vis-network/) from CDN and the Inter and Bricolage Grotesque fonts from Google Fonts. No framework, no build step.
- **Hosting:** Cloudflare Pages. Neo4j credentials are stored as encrypted Pages secrets.

### Architecture

```
Browser ──fetch /api/*──▶ Cloudflare Pages Function ──HTTPS + Cypher──▶ Neo4j AuraDB
(public/index.html)       (functions/api/[[path]].js)                   (Query API v2)
```

Neo4j's usual Bolt protocol keeps a long-lived connection open, which suits an always-running server. A Pages Function is serverless and runs only for the length of each request, and the official Neo4j driver isn't built for Cloudflare's runtime. So the function sends each Cypher statement as an HTTPS request to Aura's Query API instead. The database, data and Cypher queries are the same either way. Each request runs as its own transaction.

---

## Project structure

```
├── public/
│   └── index.html          # Dashboard UI (sidebar + pages)
├── functions/api/
│   └── [[path]].js         # API: Cypher queries exposed as JSON endpoints
├── wrangler.toml           # Cloudflare Pages config
├── seed.cypher             # Constraints + sample data (DA3 Queries 1–12)
├── seed.py                 # Loads seed.cypher into the database
├── requirements.txt        # Python deps for seed.py only
└── .env.example            # Template for Neo4j credentials
```

---

## Getting started

### 1. Create a Neo4j instance
Create a free instance at [console.neo4j.io](https://console.neo4j.io) and download the credentials file Aura offers when the instance is created. The password is only shown once.

### 2. Configure credentials
Copy `.env.example` to `.env` and fill in the values from the credentials file:

```
NEO4J_URI=neo4j+s://<instance-id>.databases.neo4j.io
NEO4J_USERNAME=<username>
NEO4J_PASSWORD=<password>
NEO4J_DATABASE=<database>
```

Also copy the same four lines into a file named `.dev.vars`, which `wrangler` reads for local development. Both `.env` and `.dev.vars` are git-ignored. Never commit them.

### 3. Load the sample data
```bash
pip install -r requirements.txt
python seed.py
```
Expected output: `Ran 31 statements -> 13 nodes, 12 relationships`. The script uses `MERGE`, so it is safe to re-run.

You can also paste `seed.cypher` into the Aura **Query** tool.

### 4. Run the dashboard locally
Requires [Node.js](https://nodejs.org/).
```bash
npx wrangler pages dev
```
Open **http://localhost:8788**.

### 5. Deploy to Cloudflare Pages
```bash
npx wrangler login
npx wrangler pages project create pharmacy-dashboard --production-branch main
npx wrangler pages secret bulk .dev.vars --project-name pharmacy-dashboard
npx wrangler pages deploy --project-name pharmacy-dashboard --branch main
```

> **Note:** Aura Free instances pause after a few days without activity. If the live site shows a database error, resume the instance in the [Aura console](https://console.neo4j.io).

---

## API endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/kpis` | Summary counts and total revenue |
| GET | `/api/medicines` | All medicines with their supplier |
| GET | `/api/low_stock` | Medicines with stock < 80 |
| GET | `/api/expiring` | Medicines expiring before 2028-01-01 |
| GET | `/api/top_medicines` | Units sold per medicine |
| GET | `/api/sales` | Sales with customer, employee, items and amount |
| GET | `/api/suppliers` | Suppliers and the medicines they supply |
| GET | `/api/prescriptions` | Customer prescriptions |
| GET | `/api/history` | Customer → Sale → Medicine ← Supplier traversal |
| GET | `/api/graph` | Every node and relationship, with labels and properties, for the graph view |
| GET | `/api/employees` | Employees with the number of sales handled |
| GET | `/api/supplier_list`, `/api/customer_list`, `/api/employee_list` | IDs and names for the form dropdowns |
| POST | `/api/employee`, `/api/supplier` | Add an employee or supplier `{name, phone}` (ID assigned automatically) |
| PUT | `/api/employee/<id>`, `/api/supplier/<id>` | Edit an employee's or supplier's name and phone |
| POST | `/api/prescription` | Add a prescription `{customer, doctor, date}` (ID assigned automatically) |
| PUT | `/api/prescription/<id>` | Edit a prescription; changing `customer` re-links it |
| POST | `/api/medicine` | Create or update a medicine `{id, name, category, price, stock, expiry, supplier?}` (`MERGE` on `id`) |
| DELETE | `/api/medicine/<id>` | Delete a medicine and its relationships |
| POST | `/api/sale` | Record a sale: `{customer, employee, date, mode, status, items: [{medicine, qty}]}`. Reduces stock. Use `customer: "new"` with `new_name` (and optional `new_phone`) to create a customer at the same time. |
| PUT | `/api/sale/<id>` | Update a sale's payment `{mode, status}` |
| DELETE | `/api/sale/<id>` | Delete a sale and return its items to stock |

All queries are parameterised, and user input is validated on the server, never concatenated into Cypher. Cypher can't parameterise labels, so the few queries that need a label take it from a fixed list in the code, never from the request. Invalid input returns `400` with a message, and unknown records return `404`.

---

## Sample Cypher queries

```cypher
// Customer purchase history
MATCH (c:Customer)-[:MAKES]->(s:Sale)-[r:CONTAINS]->(m:Medicine)
RETURN c.customer_name, s.sale_id, m.medicine_name, r.quantity;

// Total amount per sale
MATCH (s:Sale)-[r:CONTAINS]->(m:Medicine)
RETURN s.sale_id, sum(r.quantity * m.price) AS total;

// Which supplier's medicines did each customer buy? (multi-hop traversal)
MATCH (c:Customer)-[:MAKES]->(:Sale)-[:CONTAINS]->(m:Medicine)<-[:SUPPLIES]-(sup:Supplier)
RETURN DISTINCT c.customer_name, m.medicine_name, sup.supplier_name;
```

---

## Oracle SQL vs Neo4j

| Feature | Oracle SQL (DA2) | Neo4j (DA3) |
|---------|------------------|-------------|
| Model | Relational | Property graph |
| Storage | Tables | Nodes and relationships |
| Query language | SQL | Cypher |
| Relationships | Foreign keys + JOINs | Stored directly, traversed |
| Main strength | Structured transactions | Connected-data analysis |
| Visualisation | Tabular results | Graph visualisation |

Neo4j is used here as an **extension** of the relational system, not a replacement.

---

## Known limitations

- **No login:** anyone with the link can view and edit data. Authentication and roles (for example pharmacist and admin) would be the next step.
- **Sale totals use the current price:** a sale stores quantities, not the price at the time of sale, so changing a medicine's price changes old sale totals too. Storing `unit_price` on the `CONTAINS` relationship would fix this.
- **No delete for employees, suppliers or prescriptions:** past sales and supply links refer to them, so they can only be added and edited.
- **IDs are the current maximum plus one:** this is fine for a single user. Under concurrent writes, the uniqueness constraints reject a clash rather than allowing a duplicate.
- **Aura Free pauses** after a few days without activity. Resume it from the Aura console.
