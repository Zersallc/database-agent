-- The eval company: a small wholesale business, for SQL cases graded by their result
-- (evals/cases/sql-known-answer.eval.ts). It extends the media fixtures' Sales company
-- (orders, customers, supplier_contracts) with products, order lines and a sales-rep table
-- whose identifiers need quoting.
--
-- Every row comes from a formula, not random(), so a rebuild gives identical data and a
-- reference query's answer never moves. Apply as the database owner:
--
--   psql "$EVAL_COMPANY_ADMIN_DSN" -v ON_ERROR_STOP=1 -f evals/sql/eval_company.sql
--
-- It drops and recreates its own tables, and nothing else.

BEGIN;

DROP TABLE IF EXISTS order_items, orders, products, customers, supplier_contracts, "Sales Reps" CASCADE;

CREATE TABLE "Sales Reps" (
  "Rep ID"    integer PRIMARY KEY,
  "Full Name" text NOT NULL,
  "Region"    text NOT NULL,
  "Hire Date" date NOT NULL
);
COMMENT ON TABLE "Sales Reps" IS 'One row per sales representative.';

INSERT INTO "Sales Reps" VALUES
  (1, 'Amara Osei',      'North',   '2019-03-04'),
  (2, 'Bilal Haddad',    'South',   '2020-07-13'),
  (3, 'Chen Wei',        'East',    '2018-11-01'),
  (4, 'Dana Kowalski',   'West',    '2021-02-15'),
  (5, 'Esi Mensah',      'Central', '2022-09-05'),
  (6, 'Farid Nasser',    'North',   '2023-01-09'),
  (7, 'Grace Mwangi',    'South',   '2024-04-22'),
  (8, 'Hiro Tanaka',     'East',    '2025-06-30');

CREATE TABLE customers (
  customer_id  integer PRIMARY KEY,
  name         text NOT NULL,
  region       text NOT NULL,
  segment      text NOT NULL,
  rep_id       integer REFERENCES "Sales Reps"("Rep ID"),
  signed_up_on date NOT NULL,
  late_fee_pct numeric
);
COMMENT ON TABLE customers IS 'One row per customer.';
COMMENT ON COLUMN customers.late_fee_pct IS 'Late-delivery penalty rate applied in billing, percent per week. NULL means none agreed.';
COMMENT ON COLUMN customers.rep_id IS 'The sales rep who owns the account.';

INSERT INTO customers
SELECT id,
       (ARRAY['Acme','Birchwood','Cobalt','Dunmore','Everly','Foxglove','Granite','Harbor','Ironside','Juniper','Kestrel','Lumen'])[((id - 1) % 12) + 1]
         || ' ' || (ARRAY['Trading','Supplies','Logistics','Foods','Industries'])[((id - 1) / 12) % 5 + 1],
       (ARRAY['North','South','East','West','Central'])[(id % 5) + 1],
       (ARRAY['Enterprise','SMB','Mid-Market'])[(id % 3) + 1],
       (id % 8) + 1,
       DATE '2023-01-01' + ((id * 53) % 900),
       CASE WHEN id % 7 = 0 THEN NULL ELSE (id % 4) + 0.5 END
FROM generate_series(1, 60) AS id;

CREATE TABLE products (
  product_id integer PRIMARY KEY,
  name       text NOT NULL,
  category   text NOT NULL,
  unit_price numeric(10,2) NOT NULL
);
COMMENT ON TABLE products IS 'The catalogue.';

INSERT INTO products VALUES
  (1,  'Pallet wrap 500m',       'Packaging', 18.50),
  (2,  'Corrugated box, large',  'Packaging',  2.40),
  (3,  'Packing tape, 6 rolls',  'Packaging',  9.90),
  (4,  'Nitrile gloves, 100',    'Safety',    12.00),
  (5,  'Hi-vis vest',            'Safety',     6.75),
  (6,  'Safety boots',           'Safety',    54.00),
  (7,  'Hand truck',             'Equipment', 129.00),
  (8,  'Pallet jack',            'Equipment', 420.00),
  (9,  'Label printer',          'Equipment', 215.00),
  (10, 'Floor cleaner 5L',       'Cleaning',  14.20),
  (11, 'Microfibre cloths, 20',  'Cleaning',   8.30),
  (12, 'Mop and bucket set',     'Cleaning',  32.00);

CREATE TABLE orders (
  order_id     integer PRIMARY KEY,
  customer_id  integer NOT NULL REFERENCES customers,
  total        numeric(12,2) NOT NULL DEFAULT 0,
  status       text NOT NULL,
  ordered_at   timestamp NOT NULL,
  promised_at  timestamp NOT NULL,
  delivered_at timestamp
);
COMMENT ON TABLE orders IS 'One row per customer order.';
COMMENT ON COLUMN orders.total IS 'Order value: the sum of its lines.';
COMMENT ON COLUMN orders.promised_at IS 'The delivery date promised to the customer.';
COMMENT ON COLUMN orders.delivered_at IS 'NULL until delivered.';

INSERT INTO orders (order_id, customer_id, status, ordered_at, promised_at, delivered_at)
SELECT o,
       ((o * 37) % 60) + 1,
       CASE WHEN o % 23 = 0 THEN 'cancelled' WHEN (o * 7919) % 670 > 650 THEN 'pending' ELSE 'delivered' END,
       TIMESTAMP '2025-01-01' + ((o * 7919) % 670) * INTERVAL '1 day' + (o % 24) * INTERVAL '1 hour',
       TIMESTAMP '2025-01-01' + ((o * 7919) % 670 + 7) * INTERVAL '1 day' + (o % 24) * INTERVAL '1 hour',
       CASE WHEN o % 23 = 0 OR (o * 7919) % 670 > 650 THEN NULL
            ELSE TIMESTAMP '2025-01-01' + ((o * 7919) % 670 + (o * 13) % 12) * INTERVAL '1 day' + (o % 24) * INTERVAL '1 hour' END
FROM generate_series(1, 1240) AS o;

CREATE TABLE order_items (
  order_id   integer NOT NULL REFERENCES orders,
  line_no    integer NOT NULL,
  product_id integer NOT NULL REFERENCES products,
  quantity   integer NOT NULL,
  unit_price numeric(10,2) NOT NULL,
  PRIMARY KEY (order_id, line_no)
);
COMMENT ON TABLE order_items IS 'One row per order line. unit_price is the price charged on that order.';

INSERT INTO order_items
SELECT o.order_id, k, p.product_id, ((o.order_id + k) % 5) + 1, p.unit_price
FROM orders o
-- Line count and products vary with order_id / 7 and order_id / 60, so a customer's orders
-- (every 60th id) do not all buy the same things.
CROSS JOIN LATERAL generate_series(1, (o.order_id / 7) % 3 + 1) AS k
JOIN products p ON p.product_id = ((o.order_id * 5 + k * 7 + o.order_id / 60) % 12) + 1;

UPDATE orders o SET total = s.total
FROM (SELECT order_id, sum(quantity * unit_price) AS total FROM order_items GROUP BY order_id) s
WHERE s.order_id = o.order_id;

CREATE TABLE supplier_contracts (
  contract_id integer PRIMARY KEY,
  supplier    text NOT NULL,
  signed_on   date NOT NULL,
  expires_on  date NOT NULL,
  status      text NOT NULL
);
COMMENT ON TABLE supplier_contracts IS 'Register of supplier contracts: which supplier, when signed and when it expires.';

INSERT INTO supplier_contracts VALUES
  (1,  'Northwind Packaging',   '2022-01-10', '2025-01-09', 'expired'),
  (2,  'Tallis Safety Co',      '2023-03-01', '2026-02-28', 'active'),
  (3,  'Brightline Equipment',  '2023-06-15', '2026-06-14', 'active'),
  (4,  'Corvid Cleaning',       '2024-01-01', '2026-12-31', 'active'),
  (5,  'Meridian Freight',      '2022-09-01', '2025-08-31', 'expired'),
  (6,  'Oakhurst Paper',        '2024-05-20', '2027-05-19', 'active'),
  (7,  'Pennant Gloves',        '2024-11-01', '2026-10-31', 'active'),
  (8,  'Quayside Pallets',      '2025-02-01', '2028-01-31', 'active'),
  (9,  'Redfern Tapes',         '2023-08-08', '2026-08-07', 'active'),
  (10, 'Sable Workwear',        '2025-04-14', '2027-04-13', 'active'),
  (11, 'Thistle Chemicals',     '2021-12-01', '2024-11-30', 'expired'),
  (12, 'Umbra Printing',        '2025-07-01', '2026-12-15', 'active'),
  (13, 'Vantage Trucks',        '2024-03-03', '2027-03-02', 'terminated'),
  (14, 'Willow Labels',         '2025-10-01', '2028-09-30', 'active');

COMMIT;
