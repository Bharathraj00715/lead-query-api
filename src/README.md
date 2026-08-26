# Lead Query API

A simplified multi-tenant CRM Lead Query API built with Express, TypeScript, PostgreSQL and Zod.

The API supports:

- Multi-tenant data isolation
- Role-based lead visibility
- Free-text search
- AND / OR filters
- System field filters
- Custom field filters using EAV
- Pagination
- Sorting
- Request validation
- Custom-field hydration

---

## Tech Stack

- Node.js
- Express
- TypeScript
- PostgreSQL
- Zod
- node-postgres (`pg`)
- Raw parameterized SQL

---

## Project Structure

```text
lead-query-api/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts
    └── db/
        └── connect.ts