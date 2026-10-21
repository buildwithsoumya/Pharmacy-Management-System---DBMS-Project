"""Load seed.cypher into the Aura instance from .env. Safe to re-run (MERGE)."""
import os
import re
from dotenv import load_dotenv
from neo4j import GraphDatabase

load_dotenv()
text = re.sub(r"//.*", "", open("seed.cypher", encoding="utf-8").read())
statements = [s.strip() for s in text.split(";") if s.strip()]

with GraphDatabase.driver(os.environ["NEO4J_URI"],
                          auth=(os.environ["NEO4J_USERNAME"], os.environ["NEO4J_PASSWORD"])) as driver:
    db = os.environ.get("NEO4J_DATABASE")
    for s in statements:
        driver.execute_query(s, database_=db)
    nodes = driver.execute_query("MATCH (n) RETURN count(n) AS c", database_=db).records[0]["c"]
    rels = driver.execute_query("MATCH ()-[r]->() RETURN count(r) AS c", database_=db).records[0]["c"]
    print(f"Ran {len(statements)} statements -> {nodes} nodes, {rels} relationships")
