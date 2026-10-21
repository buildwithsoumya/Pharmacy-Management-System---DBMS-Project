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

A clean light UI with a sidebar. Each section is its own page: **Overview, Inventory, Add / Update, Alerts, Sales, Suppliers & Rx, Analytics, Graph**. On phones the sidebar becomes a scrollable top bar.

- **KPI cards:** medicines, units in stock, customers, suppliers, employees, sales and total revenue
- **Charts:** units sold per medicine, revenue per sale
- **Inventory table** with *Low stock* and *Expiring* flags
- **Add / update / delete medicines** from the browser (Cypher `MERGE` and `DETACH DELETE`), optionally linking a supplier
- **Alerts:** low stock (< 80 units), medicines expiring before 2028
- **Sales:** customer, handling employee, payment, and amount (`Σ quantity × price`)
- **Suppliers** and the medicines they supply, plus **prescriptions** per customer
- **Purchase trace:** a multi-hop traversal `Customer → Sale → Medicine ← Supplier`
- **Interactive graph view** of the whole database

Every panel reads live from Neo4j. Nothing is hard-coded.

---

## Tech stack

- **Database:** Neo4j AuraDB (Free tier), Cypher
- **Backend:** a Cloudflare Pages Function in JavaScript. It sends Cypher to Aura over the [Neo4j HTTPS Query API](https://neo4j.com/docs/query-api/current/).
- **Frontend:** HTML, CSS and JavaScript, with [Chart.js](https://www.chartjs.org/) and [vis-network](https://visjs.github.io/vis-network/) from CDN. No build step.
- **Hosting:** Cloudflare Pages. Neo4j credentials are stored as encrypted Pages secrets.

### Architecture

```
Browser ──fetch /api/*──▶ Cloudflare Pages Function ──HTTPS + Cypher──▶ Neo4j AuraDB
(public/index.html)       (functions/api/[[path]].js)                   (Query API v2)
```

Cloudflare Workers cannot open Neo4j's Bolt TCP connection, so the function uses Aura's HTTPS Query API. The database, data and Cypher queries are the same either way.

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
| GET | `/api/sales` | Sales with customer, employee and amount |
| GET | `/api/suppliers` | Suppliers and the medicines they supply |
| GET | `/api/prescriptions` | Customer prescriptions |
| GET | `/api/history` | Customer → Sale → Medicine ← Supplier traversal |
| GET | `/api/graph` | Nodes and edges for the graph view |
| GET | `/api/supplier_list` | Supplier IDs and names (for the form) |
| POST | `/api/medicine` | Create or update a medicine (JSON body) |
| DELETE | `/api/medicine/<id>` | Delete a medicine and its relationships |

All queries are parameterised. User input is validated and never concatenated into Cypher.

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
