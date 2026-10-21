"""Pharmacy Management System dashboard - Flask + Neo4j Aura."""
import os
from datetime import date

from dotenv import load_dotenv
from flask import Flask, abort, jsonify, render_template, request
from neo4j import GraphDatabase

load_dotenv()
DB = os.environ.get("NEO4J_DATABASE")
driver = GraphDatabase.driver(os.environ["NEO4J_URI"],
                              auth=(os.environ["NEO4J_USERNAME"], os.environ["NEO4J_PASSWORD"]))
app = Flask(__name__)


def run(cypher, **params):
    return [r.data() for r in driver.execute_query(cypher, params, database_=DB).records]


# Read-only dashboard queries (Section 11 of the DA3 report). Dates go out as strings.
QUERIES = {
    "kpis": """
        CALL () { MATCH (m:Medicine) RETURN count(m) AS medicines, sum(m.stock) AS units }
        CALL () { MATCH (c:Customer) RETURN count(c) AS customers }
        CALL () { MATCH (s:Supplier) RETURN count(s) AS suppliers }
        CALL () { MATCH (e:Employee) RETURN count(e) AS employees }
        CALL () { MATCH (s:Sale) RETURN count(s) AS sales }
        CALL () { MATCH (:Sale)-[r:CONTAINS]->(m:Medicine) RETURN sum(r.quantity * m.price) AS revenue }
        RETURN medicines, units, customers, suppliers, employees, sales, revenue""",
    "medicines": """
        MATCH (m:Medicine) OPTIONAL MATCH (s:Supplier)-[:SUPPLIES]->(m)
        RETURN m.medicine_id AS id, m.medicine_name AS name, m.category AS category, m.price AS price,
               m.stock AS stock, toString(m.expiry_date) AS expiry, s.supplier_name AS supplier
        ORDER BY id""",
    "low_stock": """
        MATCH (m:Medicine) WHERE m.stock < 80
        RETURN m.medicine_name AS name, m.stock AS stock ORDER BY stock""",
    "expiring": """
        MATCH (m:Medicine) WHERE m.expiry_date < date('2028-01-01')
        RETURN m.medicine_name AS name, toString(m.expiry_date) AS expiry ORDER BY m.expiry_date""",
    "top_medicines": """
        MATCH (:Sale)-[r:CONTAINS]->(m:Medicine)
        RETURN m.medicine_name AS name, sum(r.quantity) AS sold ORDER BY sold DESC""",
    "sales": """
        MATCH (c:Customer)-[:MAKES]->(s:Sale)<-[:HANDLES]-(e:Employee), (s)-[r:CONTAINS]->(m:Medicine)
        RETURN s.sale_id AS id, toString(s.sale_date) AS date, c.customer_name AS customer,
               e.employee_name AS employee, s.payment_mode AS mode, s.payment_status AS status,
               sum(r.quantity * m.price) AS amount
        ORDER BY id""",
    "suppliers": """
        MATCH (s:Supplier) OPTIONAL MATCH (s)-[:SUPPLIES]->(m:Medicine)
        RETURN s.supplier_name AS name, s.phone AS phone, count(m) AS medicines,
               collect(m.medicine_name) AS supplies ORDER BY name""",
    "history": """
        MATCH (c:Customer)-[:MAKES]->(s:Sale)-[r:CONTAINS]->(m:Medicine)<-[:SUPPLIES]-(sup:Supplier)
        RETURN c.customer_name AS customer, s.sale_id AS sale, m.medicine_name AS medicine,
               r.quantity AS qty, sup.supplier_name AS supplier ORDER BY customer, sale""",
    "prescriptions": """
        MATCH (c:Customer)-[:HAS_PRESCRIPTION]->(p:Prescription)
        RETURN c.customer_name AS customer, p.prescription_id AS id, p.doctor_name AS doctor,
               toString(p.prescription_date) AS date ORDER BY id""",
    "graph": """
        MATCH (a)-[r]->(b)
        WITH collect(DISTINCT a) + collect(DISTINCT b) AS ns, collect(r) AS rs
        UNWIND ns AS n WITH DISTINCT n, rs
        WITH collect({id: elementId(n), group: labels(n)[0],
                      label: coalesce(n.medicine_name, n.supplier_name, n.customer_name, n.employee_name,
                                      n.doctor_name, 'Sale ' + n.sale_id)}) AS nodes, rs
        RETURN nodes, [r IN rs | {from: elementId(startNode(r)), to: elementId(endNode(r)),
                                  label: type(r) + coalesce(' x' + r.quantity, '')}] AS edges""",
}


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/<name>")
def api(name):
    if name not in QUERIES:
        abort(404)
    rows = run(QUERIES[name])
    return jsonify(rows[0] if name in ("kpis", "graph") else rows)


@app.post("/api/medicine")
def save_medicine():
    """Create or update a medicine (MERGE on medicine_id), optionally linking its supplier."""
    f = request.get_json(force=True)
    try:
        p = {"id": int(f["id"]), "name": str(f["name"]).strip(), "category": str(f["category"]).strip(),
             "price": float(f["price"]), "stock": int(f["stock"]),
             "expiry": date.fromisoformat(f["expiry"]).isoformat(),
             "supplier": int(f["supplier"]) if f.get("supplier") else None}
    except (KeyError, ValueError, TypeError) as e:
        return jsonify(error=f"Invalid input: {e}"), 400
    if not p["name"] or p["price"] < 0 or p["stock"] < 0:
        return jsonify(error="Name required; price and stock must be >= 0"), 400
    run("""MERGE (m:Medicine {medicine_id: $id})
           SET m.medicine_name = $name, m.category = $category, m.price = $price,
               m.stock = $stock, m.expiry_date = date($expiry)
           WITH m WHERE $supplier IS NOT NULL
           MATCH (s:Supplier {supplier_id: $supplier})
           OPTIONAL MATCH (:Supplier)-[old:SUPPLIES]->(m) DELETE old
           MERGE (s)-[:SUPPLIES]->(m)""", **p)
    return jsonify(ok=True)


@app.delete("/api/medicine/<int:mid>")
def delete_medicine(mid):
    run("MATCH (m:Medicine {medicine_id: $id}) DETACH DELETE m", id=mid)
    return jsonify(ok=True)


@app.get("/api/supplier_list")
def supplier_list():
    return jsonify(run("MATCH (s:Supplier) RETURN s.supplier_id AS id, s.supplier_name AS name ORDER BY id"))


if __name__ == "__main__":
    app.run(debug=True)
