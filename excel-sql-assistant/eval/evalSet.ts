/**
 * evalSet.ts — Phase 9: Evaluation Benchmark Dataset
 *
 * 40 text-to-SQL test cases spanning 3 tables: sales, employees, inventory.
 * Covers:
 *   - Aggregations (SUM, AVG, MIN, MAX, COUNT)
 *   - Filtering & WHERE conditions (dates, numbers, strings)
 *   - Grouping & HAVING
 *   - Sorting & LIMIT / TOP N
 *   - Window functions (ROW_NUMBER, RANK)
 *   - Case-insensitive string matching
 *   - Mathematical expressions
 */

export interface TestCase {
  id: number;
  dataset: "sales" | "employees" | "inventory" | "multi";
  question: string;
  expectedSql: string;
  category: "aggregation" | "filter" | "grouping" | "sorting" | "window" | "math";
  description: string;
}

export const EVALUATION_SET: TestCase[] = [
  // ── Sales dataset ──────────────────────────────────────────────────────────
  {
    id: 1,
    dataset: "sales",
    question: "What is the total revenue?",
    expectedSql: `SELECT SUM(revenue) AS total_revenue FROM sales`,
    category: "aggregation",
    description: "Basic sum of numeric column",
  },
  {
    id: 2,
    dataset: "sales",
    question: "How many total orders were placed?",
    expectedSql: `SELECT COUNT(*) AS total_orders FROM sales`,
    category: "aggregation",
    description: "Row count aggregation",
  },
  {
    id: 3,
    dataset: "sales",
    question: "Show top 3 customers by total spend",
    expectedSql: `SELECT customer_name, SUM(revenue) AS total_spend FROM sales GROUP BY customer_name ORDER BY total_spend DESC LIMIT 3`,
    category: "grouping",
    description: "Group by customer, order desc, limit",
  },
  {
    id: 4,
    dataset: "sales",
    question: "List all orders from the North region",
    expectedSql: `SELECT * FROM sales WHERE region = 'North'`,
    category: "filter",
    description: "Exact string equality filter",
  },
  {
    id: 5,
    dataset: "sales",
    question: "What is the average revenue per order?",
    expectedSql: `SELECT AVG(revenue) AS avg_revenue FROM sales`,
    category: "aggregation",
    description: "Average numeric aggregation",
  },
  {
    id: 6,
    dataset: "sales",
    question: "Total revenue grouped by region",
    expectedSql: `SELECT region, SUM(revenue) AS regional_revenue FROM sales GROUP BY region ORDER BY regional_revenue DESC`,
    category: "grouping",
    description: "Group by with aggregate sum",
  },
  {
    id: 7,
    dataset: "sales",
    question: "Show orders with discount greater than 5%",
    expectedSql: `SELECT * FROM sales WHERE discount > 0.05`,
    category: "filter",
    description: "Numeric comparison filter",
  },
  {
    id: 8,
    dataset: "sales",
    question: "Total quantity sold in March 2024",
    expectedSql: `SELECT SUM(quantity) AS total_quantity FROM sales WHERE order_date >= '2024-03-01' AND order_date <= '2024-03-31'`,
    category: "filter",
    description: "Date range filtering",
  },
  {
    id: 9,
    dataset: "sales",
    question: "Show customer name and net revenue after discount",
    expectedSql: `SELECT customer_name, revenue * (1 - discount) AS net_revenue FROM sales`,
    category: "math",
    description: "Arithmetic expression in projection",
  },
  {
    id: 10,
    dataset: "sales",
    question: "Which region had the single highest order revenue?",
    expectedSql: `SELECT region, revenue FROM sales ORDER BY revenue DESC LIMIT 1`,
    category: "sorting",
    description: "Order by desc limit 1",
  },
  {
    id: 11,
    dataset: "sales",
    question: "Find all orders where customer name starts with 'Acme'",
    expectedSql: `SELECT * FROM sales WHERE customer_name ILIKE 'Acme%'`,
    category: "filter",
    description: "Case-insensitive prefix match",
  },
  {
    id: 12,
    dataset: "sales",
    question: "Count of distinct customers who placed orders",
    expectedSql: `SELECT COUNT(DISTINCT customer_name) AS unique_customers FROM sales`,
    category: "aggregation",
    description: "Distinct count aggregate",
  },
  {
    id: 13,
    dataset: "sales",
    question: "Rank orders by revenue within each region",
    expectedSql: `SELECT *, ROW_NUMBER() OVER (PARTITION BY region ORDER BY revenue DESC) AS rank FROM sales`,
    category: "window",
    description: "Window ranking partition by region",
  },
  {
    id: 14,
    dataset: "sales",
    question: "Regions with more than 2 orders",
    expectedSql: `SELECT region, COUNT(*) AS order_count FROM sales GROUP BY region HAVING COUNT(*) > 2`,
    category: "grouping",
    description: "Group by with HAVING clause",
  },

  // ── Employees dataset ──────────────────────────────────────────────────────
  {
    id: 15,
    dataset: "employees",
    question: "What is the average salary in the Engineering department?",
    expectedSql: `SELECT AVG(salary) AS avg_eng_salary FROM employees WHERE department = 'Engineering'`,
    category: "aggregation",
    description: "Filtered average aggregate",
  },
  {
    id: 16,
    dataset: "employees",
    question: "List employees earning more than $100,000",
    expectedSql: `SELECT * FROM employees WHERE salary > 100000 ORDER BY salary DESC`,
    category: "filter",
    description: "Numeric filter with ordering",
  },
  {
    id: 17,
    dataset: "employees",
    question: "Count of employees by department",
    expectedSql: `SELECT department, COUNT(*) AS headcount FROM employees GROUP BY department ORDER BY headcount DESC`,
    category: "grouping",
    description: "Group by department with count",
  },
  {
    id: 18,
    dataset: "employees",
    question: "Who is the highest paid employee?",
    expectedSql: `SELECT first_name, last_name, salary FROM employees ORDER BY salary DESC LIMIT 1`,
    category: "sorting",
    description: "Max salary employee via sort limit",
  },
  {
    id: 19,
    dataset: "employees",
    question: "Find employees with performance rating of 4.5 or higher",
    expectedSql: `SELECT * FROM employees WHERE performance_rating >= 4.5 ORDER BY performance_rating DESC`,
    category: "filter",
    description: "Floating point filter",
  },
  {
    id: 20,
    dataset: "employees",
    question: "Show full name and tenure of each employee",
    expectedSql: `SELECT first_name || ' ' || last_name AS full_name, hire_date FROM employees`,
    category: "math",
    description: "String concatenation",
  },
  {
    id: 21,
    dataset: "employees",
    question: "Show the min, max, and avg salary across all departments",
    expectedSql: `SELECT department, MIN(salary) AS min_sal, MAX(salary) AS max_sal, AVG(salary) AS avg_sal FROM employees GROUP BY department`,
    category: "grouping",
    description: "Multi-aggregate group by",
  },
  {
    id: 22,
    dataset: "employees",
    question: "Employees hired after 2021",
    expectedSql: `SELECT * FROM employees WHERE hire_date > '2021-12-31'`,
    category: "filter",
    description: "Date greater than comparison",
  },
  {
    id: 23,
    dataset: "employees",
    question: "Top 2 earners in each department",
    expectedSql: `WITH ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) as rn FROM employees) SELECT * FROM ranked WHERE rn <= 2`,
    category: "window",
    description: "CTE with window rank filter",
  },
  {
    id: 24,
    dataset: "employees",
    question: "Total payroll budget by department",
    expectedSql: `SELECT department, SUM(salary) AS total_payroll FROM employees GROUP BY department`,
    category: "grouping",
    description: "Department payroll sum",
  },

  // ── Inventory dataset ──────────────────────────────────────────────────────
  {
    id: 25,
    dataset: "inventory",
    question: "Show products that need to be reordered (stock level below reorder point)",
    expectedSql: `SELECT * FROM inventory WHERE stock_level <= reorder_point`,
    category: "filter",
    description: "Column to column comparison filter",
  },
  {
    id: 26,
    dataset: "inventory",
    question: "What is the total value of inventory on hand?",
    expectedSql: `SELECT SUM(unit_cost * stock_level) AS total_inventory_value FROM inventory`,
    category: "math",
    description: "Aggregate sum of product expression",
  },
  {
    id: 27,
    dataset: "inventory",
    question: "Count of items in each product category",
    expectedSql: `SELECT category, COUNT(*) AS item_count FROM inventory GROUP BY category`,
    category: "grouping",
    description: "Category breakdown count",
  },
  {
    id: 28,
    dataset: "inventory",
    question: "Most expensive products in stock",
    expectedSql: `SELECT product_name, unit_cost FROM inventory ORDER BY unit_cost DESC LIMIT 5`,
    category: "sorting",
    description: "Sort by unit cost desc limit 5",
  },
  {
    id: 29,
    dataset: "inventory",
    question: "Categories with average unit cost over $50",
    expectedSql: `SELECT category, AVG(unit_cost) AS avg_cost FROM inventory GROUP BY category HAVING AVG(unit_cost) > 50`,
    category: "grouping",
    description: "Group by category with HAVING condition",
  },
  {
    id: 30,
    dataset: "inventory",
    question: "List all items in the Electronics category with stock greater than 50",
    expectedSql: `SELECT * FROM inventory WHERE category = 'Electronics' AND stock_level > 50`,
    category: "filter",
    description: "Compound AND condition filter",
  },
  {
    id: 31,
    dataset: "inventory",
    question: "Total stock count across all products",
    expectedSql: `SELECT SUM(stock_level) AS total_stock FROM inventory`,
    category: "aggregation",
    description: "Sum of stock count",
  },
  {
    id: 32,
    dataset: "inventory",
    question: "Products with unit cost between 10 and 50 dollars",
    expectedSql: `SELECT * FROM inventory WHERE unit_cost BETWEEN 10 AND 50`,
    category: "filter",
    description: "BETWEEN range filter",
  },
  {
    id: 33,
    dataset: "inventory",
    question: "Inventory valuation broken down by category",
    expectedSql: `SELECT category, SUM(unit_cost * stock_level) AS category_value FROM inventory GROUP BY category ORDER BY category_value DESC`,
    category: "grouping",
    description: "Group by category with valuation sum",
  },
  {
    id: 34,
    dataset: "inventory",
    question: "Find products containing the word 'Desk' or 'Chair'",
    expectedSql: `SELECT * FROM inventory WHERE product_name ILIKE '%Desk%' OR product_name ILIKE '%Chair%'`,
    category: "filter",
    description: "Compound ILIKE with OR",
  },
  {
    id: 35,
    dataset: "sales",
    question: "Average order quantity by region",
    expectedSql: `SELECT region, AVG(quantity) AS avg_quantity FROM sales GROUP BY region`,
    category: "grouping",
    description: "Average quantity grouped by region",
  },
  {
    id: 36,
    dataset: "sales",
    question: "Show the earliest and latest order date",
    expectedSql: `SELECT MIN(order_date) AS earliest, MAX(order_date) AS latest FROM sales`,
    category: "aggregation",
    description: "Min and Max date aggregates",
  },
  {
    id: 37,
    dataset: "employees",
    question: "Employees whose last name starts with 'W'",
    expectedSql: `SELECT * FROM employees WHERE last_name ILIKE 'W%'`,
    category: "filter",
    description: "ILIKE pattern filter",
  },
  {
    id: 38,
    dataset: "employees",
    question: "Count of employees hired in each year",
    expectedSql: `SELECT STRFTIME(hire_date, '%Y') AS hire_year, COUNT(*) AS count FROM employees GROUP BY hire_year ORDER BY hire_year`,
    category: "grouping",
    description: "DuckDB STRFTIME date grouping",
  },
  {
    id: 39,
    dataset: "inventory",
    question: "Top 3 highest stock level items",
    expectedSql: `SELECT product_name, stock_level FROM inventory ORDER BY stock_level DESC LIMIT 3`,
    category: "sorting",
    description: "Sort stock level desc limit 3",
  },
  {
    id: 40,
    dataset: "sales",
    question: "Total revenue and count for Acme Corp",
    expectedSql: `SELECT COUNT(*) AS order_count, SUM(revenue) AS total_revenue FROM sales WHERE customer_name = 'Acme Corp'`,
    category: "aggregation",
    description: "Multiple aggregates on filtered subset",
  },
];
