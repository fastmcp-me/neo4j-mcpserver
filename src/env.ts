#!/usr/bin/env node

// Load environment variables from .env file
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { config } from 'dotenv';

// Get the directory where this script is located
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from the project root (two levels up if in build directory)
const envPath = resolve(__dirname, '..', '..', '.env');
config({ path: envPath });

// Verify required environment variables
const requiredEnvVars = ['NEO4J_URI', 'NEO4J_USER', 'NEO4J_PASSWORD'];
for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`Error: ${envVar} environment variable is not set`);
        process.exit(1);
    }
}

// Export environment variables
export const NEO4J_URI = process.env.NEO4J_URI;
export const NEO4J_USER = process.env.NEO4J_USER;
export const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD; 