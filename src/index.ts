#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import neo4j from 'neo4j-driver';
import dotenv from "dotenv";
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '..', '..', '.env');
dotenv.config({ path: envPath });

// Parse connection string if provided
const connectionString = process.env.NEO4J_CONNECTION;
if (connectionString) {
    const [uri, user, password] = connectionString.split(',');
    process.env.NEO4J_URI = uri;
    process.env.NEO4J_USER = user;
    process.env.NEO4J_PASSWORD = password;
}

// Verify required environment variables
const requiredEnvVars = ['NEO4J_URI', 'NEO4J_USER', 'NEO4J_PASSWORD'];
const missingVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingVars.length > 0) {
    console.error(`
Error: Missing required environment variables: ${missingVars.join(', ')}

You can provide these variables in two ways:

1. Using separate environment variables:
   NEO4J_URI=<your-uri> NEO4J_USER=<your-user> NEO4J_PASSWORD=<your-password> npx neo4j-mcpserver

2. Using a single connection string:
   NEO4J_CONNECTION=<uri>,<user>,<password> npx neo4j-mcpserver

Example:
   NEO4J_CONNECTION=neo4j+s://example.databases.neo4j.io,neo4j,your-password npx neo4j-mcpserver
`);
    process.exit(1);
}

class Neo4jClient {
    server: Server;
    driver: neo4j.Driver;

    constructor() {
        this.server = new Server({
            name: "neo4j-mcp",
            version: "1.0.2",
        }, {
            capabilities: {
                resources: {},
                tools: {},
                prompts: {},
            },
        });

        // Initialize Neo4j driver
        this.driver = neo4j.driver(
            process.env.NEO4J_URI!,
            neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!)
        );

        this.setupHandlers();
        this.setupErrorHandling();
    }

    setupErrorHandling() {
        this.server.onerror = (error) => {
            console.error("[MCP Error]", error);
        };

        process.on('SIGINT', async () => {
            await this.cleanup();
            process.exit(0);
        });
    }

    async cleanup() {
        await this.driver.close();
        await this.server.close();
    }

    setupHandlers() {
        this.setupToolHandlers();
    }

    setupToolHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            const tools = [
                {
                    name: "neo4j-query",
                    description: "Execute a Cypher query against the Neo4j database",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: {
                                type: "string",
                                description: "The Cypher query to execute"
                            },
                            parameters: {
                                type: "object",
                                description: "Query parameters (optional)",
                                additionalProperties: true
                            }
                        },
                        required: ["query"]
                    }
                }
            ];
            return { tools };
        });

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            try {
                let response;
                const args = request.params.arguments ?? {};

                switch (request.params.name) {
                    case "neo4j-query":
                        response = await this.executeQuery(
                            args.query as string,
                            args.parameters as Record<string, any>
                        );
                        break;
                    default:
                        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
                }

                return {
                    content: [{
                        type: "text",
                        text: formatResults(response)
                    }]
                };
            } catch (error) {
                if (error instanceof Error) {
                    return {
                        content: [{
                            type: "text",
                            text: `Neo4j error: ${error.message}`
                        }],
                        isError: true,
                    };
                }
                throw error;
            }
        });
    }

    async executeQuery(query: string, parameters: Record<string, any> = {}) {
        const session = this.driver.session();
        try {
            const result = await session.run(query, parameters);
            return result.records;
        } finally {
            await session.close();
        }
    }

    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error("Neo4j MCP server running on stdio");
    }
}

function formatResults(records: neo4j.Record[]) {
    if (!records || records.length === 0) {
        return "No results found.";
    }

    const output: string[] = ["Results:"];
    
    records.forEach((record, index) => {
        output.push(`\nRecord ${index + 1}:`);
        record.keys.forEach(key => {
            const value = record.get(key);
            output.push(`${String(key)}: ${formatValue(value)}`);
        });
    });

    return output.join('\n');
}

function formatValue(value: any): string {
    if (value === null || value === undefined) {
        return 'null';
    }

    if (neo4j.isNode(value)) {
        return `Node(id=${value.identity}, labels=[${value.labels.join(', ')}], properties=${JSON.stringify(value.properties)})`;
    }

    if (neo4j.isRelationship(value)) {
        return `Relationship(id=${value.identity}, type=${value.type}, properties=${JSON.stringify(value.properties)})`;
    }

    if (neo4j.isPath(value)) {
        return `Path(length=${value.segments.length}, nodes=${value.segments.length + 1})`;
    }

    if (Array.isArray(value)) {
        return `[${value.map(formatValue).join(', ')}]`;
    }

    if (typeof value === 'object') {
        return JSON.stringify(value);
    }

    return String(value);
}

const server = new Neo4jClient();
server.run().catch(console.error);
