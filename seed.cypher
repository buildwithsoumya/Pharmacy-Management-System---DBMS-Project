// Pharmacy Management System - DA3 seed 

// Query 1: Uniqueness constraints
CREATE CONSTRAINT supplier_id_unique IF NOT EXISTS FOR (s:Supplier) REQUIRE s.supplier_id IS UNIQUE;
CREATE CONSTRAINT customer_id_unique IF NOT EXISTS FOR (c:Customer) REQUIRE c.customer_id IS UNIQUE;
CREATE CONSTRAINT employee_id_unique IF NOT EXISTS FOR (e:Employee) REQUIRE e.employee_id IS UNIQUE;
CREATE CONSTRAINT medicine_id_unique IF NOT EXISTS FOR (m:Medicine) REQUIRE m.medicine_id IS UNIQUE;
CREATE CONSTRAINT prescription_id_unique IF NOT EXISTS FOR (p:Prescription) REQUIRE p.prescription_id IS UNIQUE;
CREATE CONSTRAINT sale_id_unique IF NOT EXISTS FOR (s:Sale) REQUIRE s.sale_id IS UNIQUE;

// Query 2: Suppliers
MERGE (s1:Supplier {supplier_id: 101}) SET s1.supplier_name = 'Apollo Suppliers', s1.phone = '9876543210';
MERGE (s2:Supplier {supplier_id: 102}) SET s2.supplier_name = 'MedPlus Distributors', s2.phone = '9876543211';

// Query 3: Customers
MERGE (c1:Customer {customer_id: 201}) SET c1.customer_name = 'Rahul Sharma', c1.phone = '9876500001';
MERGE (c2:Customer {customer_id: 202}) SET c2.customer_name = 'Ananya Rao', c2.phone = '9876500002';

// Query 4: Employees
MERGE (e1:Employee {employee_id: 301}) SET e1.employee_name = 'Arjun Kumar', e1.phone = '9876500011';
MERGE (e2:Employee {employee_id: 302}) SET e2.employee_name = 'Priya Singh', e2.phone = '9876500012';

// Query 5: Medicines
MERGE (m1:Medicine {medicine_id: 401}) SET m1.medicine_name = 'Paracetamol', m1.category = 'Analgesic', m1.price = 25.00, m1.stock = 100, m1.expiry_date = date('2027-12-31');
MERGE (m2:Medicine {medicine_id: 402}) SET m2.medicine_name = 'Amoxicillin', m2.category = 'Antibiotic', m2.price = 120.00, m2.stock = 50, m2.expiry_date = date('2027-08-31');
MERGE (m3:Medicine {medicine_id: 403}) SET m3.medicine_name = 'Cetirizine', m3.category = 'Antihistamine', m3.price = 45.00, m3.stock = 75, m3.expiry_date = date('2028-03-31');

// Query 6: Prescriptions
MERGE (p1:Prescription {prescription_id: 501}) SET p1.prescription_date = date('2026-09-10'), p1.doctor_name = 'Dr. Mehta';
MERGE (p2:Prescription {prescription_id: 502}) SET p2.prescription_date = date('2026-09-11'), p2.doctor_name = 'Dr. Rao';

// Query 7: Sales
MERGE (s1:Sale {sale_id: 601}) SET s1.sale_date = date('2026-09-15'), s1.payment_mode = 'Cash', s1.payment_status = 'Paid';
MERGE (s2:Sale {sale_id: 602}) SET s2.sale_date = date('2026-09-16'), s2.payment_mode = 'UPI', s2.payment_status = 'Paid';

// Query 8: Supplier -> Medicine
MATCH (s:Supplier {supplier_id: 101}), (m:Medicine {medicine_id: 401}) MERGE (s)-[:SUPPLIES]->(m);
MATCH (s:Supplier {supplier_id: 102}), (m:Medicine {medicine_id: 402}) MERGE (s)-[:SUPPLIES]->(m);
MATCH (s:Supplier {supplier_id: 101}), (m:Medicine {medicine_id: 403}) MERGE (s)-[:SUPPLIES]->(m);

// Query 9: Customer -> Prescription
MATCH (c:Customer {customer_id: 201}), (p:Prescription {prescription_id: 501}) MERGE (c)-[:HAS_PRESCRIPTION]->(p);
MATCH (c:Customer {customer_id: 202}), (p:Prescription {prescription_id: 502}) MERGE (c)-[:HAS_PRESCRIPTION]->(p);

// Query 10: Customer -> Sale
MATCH (c:Customer {customer_id: 201}), (s:Sale {sale_id: 601}) MERGE (c)-[:MAKES]->(s);
MATCH (c:Customer {customer_id: 202}), (s:Sale {sale_id: 602}) MERGE (c)-[:MAKES]->(s);

// Query 11: Employee -> Sale
MATCH (e:Employee {employee_id: 301}), (s:Sale {sale_id: 601}) MERGE (e)-[:HANDLES]->(s);
MATCH (e:Employee {employee_id: 302}), (s:Sale {sale_id: 602}) MERGE (e)-[:HANDLES]->(s);

// Query 12: Sale -> Medicine (Sale_Item)
MATCH (s:Sale {sale_id: 601}), (m:Medicine {medicine_id: 401}) MERGE (s)-[r:CONTAINS]->(m) SET r.quantity = 2;
MATCH (s:Sale {sale_id: 601}), (m:Medicine {medicine_id: 403}) MERGE (s)-[r:CONTAINS]->(m) SET r.quantity = 1;
MATCH (s:Sale {sale_id: 602}), (m:Medicine {medicine_id: 402}) MERGE (s)-[r:CONTAINS]->(m) SET r.quantity = 2;
