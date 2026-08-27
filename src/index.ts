import express from "express";
import { pool } from "./db/connect";
import { z } from "zod";

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
    res.json({
        message: "Lead query api is running",
    });
});

app.get("/api/leads/:id", async (req, res) => {
    try {
        console.log("Request received for ID:", req.params.id);

        const result = await pool.query(
            "SELECT * FROM leads WHERE id = $1",
            [req.params.id]
        );

        console.log("Database result:", result.rows);

        res.json(result.rows);
    } catch (error) {
        console.error("Database error:", error);

        res.status(500).json({
            message: "Failed to fetch lead"
        });
    }
});

const querySchema = z.object({
    q: z.string().optional(),

    filters: z.array(
        z.object({
            fieldId: z.string(),
            fieldType: z.string(),
            condition: z.string(),
            value: z.string().optional(),
            inputType: z.string().optional()
        })
    ).optional(),

    logic: z.enum(["AND", "OR"]).default("AND"),

});

app.post("/api/v1/leads/query", async (req, res) => {

    const tenantId = req.headers["x-tenant-id"];
    const userId = req.headers["x-user-id"];
    const userRole = req.headers["x-user-role"];

    if (
        typeof tenantId !== "string" ||
        typeof userId !== "string" ||
        typeof userRole !== "string"
    ) {
        return res.status(401).json({
            message: "Missing required headers"
        });
    }

    const allowedRoles = ["owner", "admin", "manager", "agent"];

    if (!allowedRoles.includes(userRole)) {
        return res.status(400).json({
            message: "Invalid user role"
        });
    }

    const validation = querySchema.safeParse(req.body || {});

    if (!validation.success) {
        return res.status(400).json({
            message: "Invalid request",
            errors: validation.error.issues
        });
    }

    const {
        q,
        filters,
        logic
    } = validation.data;

    const page = Math.max(Number(req.query.page) || 1, 1);

    const limit = Math.min(
        Math.max(Number(req.query.limit) || 20, 1),
        100
    );
const rawSortBy = req.query.sortBy;
const rawSortDirection = req.query.sortDirection;

if (
    rawSortBy !== undefined &&
    rawSortBy !== "createdAt" &&
    rawSortBy !== "followUpDate"
) {
    return res.status(400).json({
        message: "Invalid request",
        errors: [
            {
                field: "sortBy",
                message: "Invalid sortBy. Expected createdAt or followUpDate."
            }
        ]
    });
}

if (
    rawSortDirection !== undefined &&
    rawSortDirection !== "asc" &&
    rawSortDirection !== "desc"
) {
    return res.status(400).json({
        message: "Invalid request",
        errors: [
            {
                field: "sortDirection",
                message: "Invalid sortDirection. Expected asc or desc."
            }
        ]
    });
}

const sortBy =
    rawSortBy === "followUpDate"
        ? "followUpDate"
        : "createdAt";

const sortOrder =
    rawSortDirection === "asc"
        ? "asc"
        : "desc";
    const pageSize = limit;

    let query = "";
    let values: string[] = [];

    if (userRole === "agent") {
        query = `
            SELECT * FROM leads
            WHERE tenant_id = $1
            AND assigned_to = $2
        `;

        values = [tenantId, userId];

    } else {
        query = `
            SELECT * FROM leads
            WHERE tenant_id = $1
        `;

        values = [tenantId];
    }

    if (typeof q === "string" && q.trim() !== "") {

        const searchParam = values.length + 1;

        query +=
            " AND (" +
            "name ILIKE $" + searchParam +
            " OR email ILIKE $" + searchParam +
            " OR phone ILIKE $" + searchParam +
            " OR company ILIKE $" + searchParam +
            ")";

        values.push(`%${q}%`);
    }

    if (Array.isArray(filters) && filters.length > 0) {

        const filterClauses: string[] = [];

        for (const filter of filters) {

            const { fieldId, fieldType, condition, value, inputType } = filter;

            if (
                fieldId === "followUpDate" &&
                ["before", "after", "is", "is not"].includes(condition)
            ) {
                if (
                    typeof value !== "string" ||
                    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
                    Number.isNaN(Date.parse(value))
                ) {
                    return res.status(400).json({
                        message: "Invalid request",
                        errors: [
                            {
                                field: "filters",
                                message: "Invalid date. Expected YYYY-MM-DD."
                            }
                        ]
                    })
                }
            }

            if (fieldId === "name") {

                if (condition === "contain") {
                    const param = values.length + 1;

                    filterClauses.push(`name ILIKE $${param}`);
                    values.push(`%${value ?? ""}%`);
                }

                if (condition === "is") {
                    const param = values.length + 1;

                    filterClauses.push(`LOWER(name) = LOWER($${param})`);
                    values.push(value ?? "");
                }

                if (condition === "is not") {
                    const param = values.length + 1;

                    filterClauses.push(`LOWER(name) <> LOWER($${param})`);
                    values.push(value ?? "");
                }

                if (condition === "does not contain") {
                    const param = values.length + 1;

                    filterClauses.push(`name NOT ILIKE $${param}`);
                    values.push(`%${value ?? ""}%`);
                }

                if (condition === "starts with") {
                    const param = values.length+1

                    filterClauses.push(`name ILIKE $${param}`);
                    values.push(`${value ?? ""}%`);
                }

                if (condition === "ends with") {

                    const param = values.length + 1;

                    filterClauses.push(`name ILIKE $${param}`);
                    values.push(`%${value ?? ""}`);
                }
            }

            if (
                fieldId === "email" &&
                condition === "contain"
            ) {

                const param = values.length + 1;

                filterClauses.push(`email ILIKE $${param}`);
                values.push(`%${value ?? ""}%`);
            }

            if (
                fieldId === "email" &&
                condition === "is"
            ) {
                const param = values.length + 1;

                filterClauses.push(
                    `LOWER(email) = LOWER($${param})`
                );

                values.push(value ?? "");
            }

            if (
                fieldId === "email" &&
                condition === "is not"
            ) {
                const param = values.length + 1;
                filterClauses.push(
                    `LOWER(email) <> LOWER($${param})`
                );

                values.push(value ?? "");
            }

            if (
                fieldId === "email" &&
                condition === "does not contain"
            ) {
                const param = values.length + 1;

                filterClauses.push(
                    `email NOT ILIKE $${param}`
                );

                values.push(`%${value ?? ""}%`);
            }

            if (
                fieldId === "email" && 
                condition === "starts with"
            ) {
                const param = values.length + 1;

                filterClauses.push(
                    `email ILIKE $${param}`
                );

                values.push(`${value ?? ""}%`);
            }

            if (
                fieldId === "email" &&
                condition === "ends with"
            ) {
                const param = values.length + 1;

                filterClauses.push(
                    `email ILIKE $${param}`
                );

                values.push(`%${value ?? ""}`);
            }

            if (
                fieldId === "assignedTo" &&
                condition === "is"
            ) {

                const param = values.length + 1;

                if (inputType === "multiselect") {
                    filterClauses.push(
                        `assigned_to = ANY(string_to_array($${param},','))`
                    );
                } else {
                    filterClauses.push(
                        `assigned_to = $${param}`
                    );
                }


                values.push(value ?? "");
            }

            if (
                fieldId === "assignedTo" &&
                condition === "is not"
            ) {
                const param = values.length + 1;

                filterClauses.push(
                    `assigned_to <> $${param}`
                );

                values.push(value ?? "");
            }
            
            if (
                fieldId === "assignedTo" &&
                condition === "is empty"
            ) {
                filterClauses.push(
                    `assigned_to IS NULL`
                );
            }

            if (
                fieldId === "assignedTo" &&
                condition === "is not empty"
            ) {
                filterClauses.push(
                    `assigned_to IS NOT NULL`
                );
            }

            if (
                fieldId === "followUpDate" &&
                condition === "before"
            ) {

                const param = values.length + 1;

                filterClauses.push(
                    `follow_up_date < $${param}`
                );

                values.push(value ?? "");
            }

            if (
                fieldId === "followUpDate" &&
                condition === "after"
            ) {
                const param = values.length + 1;

                filterClauses.push(
                    `follow_up_date > $${param}`
                );

                values.push(value ?? "");
            }

            if (
                fieldId === "followUpDate" &&
                condition === "is"
            ) {
                const param = values.length + 1;

                filterClauses.push(
                    `follow_up_date >= $${param}::date
                     AND follow_up_date <($${param}::date + INTERVAL '1 day')`
                );

                values.push(value ?? "");
            }

            if (
                fieldId === "followUpDate" &&
                condition === "is not"
            ) {
                const param = values.length + 1;

                filterClauses.push(
                    `NOT (
                        follow_up_date >= $${param}::date
                        AND follow_up_date < ($${param}::date + INTERVAL '1 day')
                    )`
                );

                values.push(value ?? "");
            }

            if (
                fieldId === "followUpDate" &&
                condition === "is empty"
            ) {
                filterClauses.push(
                    `follow_up_date IS NULL` 
                );
            }

            if (
                fieldId === "followUpDate" &&
                condition === "is not empty"
            ) {
                filterClauses.push(
                    `follow_up_date IS NOT NULL`
                );
            }

            if (
                fieldId !== "name" &&
                fieldId !== "email" &&
                fieldId !== "assignedTo" &&
                fieldId !== "followUpDate"
            ) {

                const param = values.length + 1;
               
                if (fieldType === "number") {

                    if (condition === "is") {
                        filterClauses.push(`
                            EXISTS (
                                SELECT 1
                                FROM lead_custom_fields_values lcfv
                                WHERE lcfv.lead_id = leads.id
                                AND lcfv.field_id = $${param}
                                AND lcfv.value ~ '^-?[0-9]+(\\.[0-9]+)?$'
                                AND lcfv.value::numeric = $${param + 1}
                            )
                        `);

                        values.push(
                            String(fieldId),
                            String(value ?? "")
                        );
                    }

                    if (condition === "greater than") {
                        filterClauses.push(`
                            EXISTS (
                                SELECT 1
                                FROM lead_custom_fields_values lcfv
                                WHERE lcfv.lead_id = leads.id
                                AND lcfv.field_id = $${param}
                                AND lcfv.value ~ '^-?[0-9]+(\\.[0-9]+)?$'
                                AND lcfv.value::numeric > $${param + 1}
                            )
                        `);

                        values.push(
                            String(fieldId),
                            String(value ?? "")
                        );
                    }

                    if (condition === "less than") {
                        filterClauses.push(`
                            EXISTS (
                                SELECT 1
                                FROM lead_custom_fields_values lcfv
                                WHERE lcfv.lead_id = leads.id
                                AND lcfv.field_id = $${param}
                                AND lcfv.value ~ '^-?[0-9]+(\\.[0-9]+)?$'
                                AND lcfv.value::numeric < $${param + 1}
                            )
                        `);

                        values.push(
                            String(fieldId),
                            String(value ?? "")
                        );
                    }
                }

                if (fieldType === "boolean") {

                    if (condition === "is") {
                        filterClauses.push(`
                            EXISTS (
                                SELECT 1
                                FROM lead_custom_fields_values lcfv
                                WHERE lcfv.lead_id = leads.id
                                AND lcfv.field_id = $${param}
                                AND LOWER(lcfv.value) = LOWER($${param + 1})
                            )
                        `);

                        values.push(
                            String(fieldId),
                            String(value ?? "")
                        );
                    }
                }

                if (fieldType === "string" && condition === "contain") {

                    filterClauses.push(`
                        EXISTS (
                            SELECT 1
                            FROM lead_custom_fields_values lcfv
                            WHERE lcfv.lead_id = leads.id
                            AND lcfv.field_id = $${param}
                            AND lcfv.value ILIKE $${param + 1}
                        )
                    `);

                    values.push(
                        String(fieldId),
                        `%${value ?? ""}%`
                    );
                }

                if (fieldType ==="string" && condition === "is") {

                    filterClauses.push(`
                        EXISTS (
                            SELECT 1
                            FROM lead_custom_fields_values lcfv
                            WHERE lcfv.lead_id = leads.id
                            AND lcfv.field_id = $${param}
                            AND LOWER(lcfv.value) = LOWER($${param + 1})
                        )
                    `);

                    values.push(
                        String(fieldId),
                        String(value ?? "")
                    );
                }

                if (fieldType ==="string" && condition === "is not") {
                    filterClauses.push(`
                        NOT EXISTS(
                            SELECT 1
                            FROM lead_custom_fields_values lcfv
                            WHERE lcfv.lead_id = leads.id
                            AND lcfv.field_id = $${param}
                            AND LOWER(lcfv.value) = LOWER($${param + 1})
                        )
                    `);

                    values.push(
                        String(fieldId),
                        String(value ?? "")
                    );
                }

                if (fieldType === "string" && condition === "does not contain") {
                    filterClauses.push(`
                        EXISTS (
                            SELECT 1
                            FROM lead_custom_fields_values lcfv
                            WHERE lcfv.lead_id = leads.id
                            AND lcfv.field_id = $${param}
                            AND lcfv.value NOT ILIKE $${param + 1}
                        )
                    `);

                    values.push(
                        String(fieldId),
                        `%${value ?? ""}%`
                    );
                }
                if (fieldType ==="string" && condition === "is empty"){

                    const param = values.length + 1;

                    filterClauses.push(`
                        NOT EXISTS(
                            SELECT 1
                            FROM lead_custom_fields_values lcfv
                            WHERE lcfv.lead_id = leads.id
                            AND lcfv.field_id = $${param}
                            AND lcfv.value IS NOT NULL
                            AND lcfv.value <> ''
                        )
                    `);

                    values.push(String(fieldId));
                }

                if (fieldType === "string" && condition === "is not empty") {
                    const param = values.length + 1;

                    filterClauses.push(`
                        EXISTS (
                            SELECT 1
                            FROM lead_custom_fields_values lcfv
                            WHERE lcfv.lead_id = leads.id
                            AND lcfv.field_id = $${param}
                            AND lcfv.value IS NOT NULL
                            AND lcfv.value <> ''
                        )
                    `);

                    values.push(String(fieldId));
                }

            }
        }

        if (filterClauses.length > 0) {
            query += ` AND (${filterClauses.join(` ${logic} `)})`;
        }
    }

    if (
    sortBy !== undefined &&
    sortBy !== "createdAt" &&
    sortBy !== "followUpDate"
) {
    return res.status(400).json({
        message: "Invalid request",
        errors: [
            {
                field: "sortBy",
                message: "Invalid sortBy. Expected createdAt or followUpDate."
            }
        ]
    });
}

if (
    sortOrder !== undefined &&
    sortOrder !== "asc" &&
    sortOrder !== "desc"
) {
    return res.status(400).json({
        message: "Invalid request",
        errors: [
            {
                field: "sortDirection",
                message: "Invalid sortDirection. Expected asc or desc."
            }
        ]
    });
}

    const sortColumn =
        sortBy === "followUpDate"
            ? "follow_up_date"
            : "created_at";

    const order =
        sortOrder === "asc"
            ? "ASC"
            : "DESC";

    query += ` ORDER BY ${sortColumn} ${order}`;

    const offset = (page - 1) * pageSize;

    const limitParam = values.length + 1;
    const offsetParam = values.length + 2;

    query += ` LIMIT $${limitParam} OFFSET $${offsetParam}`;

    values.push(
        String(pageSize),
        String(offset)
    );

    const countQuery = query.replace(
        ` LIMIT $${limitParam} OFFSET $${offsetParam}`,
        ""
    );

    const countResult = await pool.query(
        `SELECT COUNT(*) FROM (${countQuery}) AS total`,
        values.slice(0, -2)
    );

    const totalRecords = Number(
        countResult.rows[0].count
    );

    const totalPages = Math.ceil(
        totalRecords / pageSize
    );

    const result = await pool.query(
        query,
        values
    );

    const leadIds = result.rows.map(
        (lead: { id: number }) => lead.id
    );

    let customFields: any[] = [];

    if (leadIds.length > 0) {

        const customFieldResult = await pool.query(
            `
            SELECT
                lcfv.lead_id,
                cf.id AS field_id,
                cf.label,
                lcfv.value
            FROM lead_custom_fields_values lcfv
            JOIN custom_fields cf
                ON cf.id = lcfv.field_id
            WHERE lcfv.lead_id = ANY($1)
            `,
            [leadIds]
        );

        customFields = customFieldResult.rows;
    }

    const items = result.rows.map((lead) => {

        const leadCustomFields = customFields
            .filter((field) => field.lead_id === lead.id)
            .map((field) => ({
                fieldId: field.field_id,
                label: field.label,
                value: field.value
            }));

        return {
            ...lead,
            customFields: leadCustomFields
        };
    });

    res.json({
        status: "success",
        message: "Leads fetched successfully",
        data: items,
        meta: {
            page,
            limit: pageSize,
            totalRecords,
            totalPages
        }
    });
});

pool.query("SELECT * FROM leads")
    .then((result) => {
        console.log("PostgreSQL connected successfully");
        console.log(result.rows);
    })
    .catch((error) => {
        console.error("PostgreSQL connection failed:", error);
    });

app.listen(3001, () => {
    console.log("Server running on http://localhost:3001");
});