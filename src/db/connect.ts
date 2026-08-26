import { Pool } from "pg";

export const pool = new Pool({
    user: "postgres",
    host: "localhost",
    database: "lead_query_db",
    password: "Sadhana@30",
    port: 5432,
});