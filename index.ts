#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import JiraClient from 'jira-client';

// Parse command line arguments
const args = process.argv.slice(2);
let jiraUrl, jiraUsername, jiraApiToken;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--jira-url':
      jiraUrl = args[++i];
      break;
    case '--jira-username':
      jiraUsername = args[++i];
      break;
    case '--jira-api-token':
      jiraApiToken = args[++i];
      break;
  }
}

// Validate required command line arguments
if (!jiraUrl || !jiraUsername || !jiraApiToken) {
  console.error('Error: Missing required arguments');
  console.error('Usage: mcp-server-jira --jira-url <url> --jira-username <username> --jira-api-token <token>');
  process.exit(1);
}

// Validate URL format
try {
  new URL(jiraUrl);
} catch (e) {
  console.error('Error: Invalid Jira URL format');
  process.exit(1);
}

// Validate username format (basic email format check)
if (!jiraUsername.includes('@')) {
  console.error('Error: Username should be an email address');
  process.exit(1);
}

// Validate API token is not empty and has minimum length
if (jiraApiToken.length < 32) {
  console.error('Error: Invalid API token format');
  process.exit(1);
}


// Schema definitions
const JiraGetIssueArgsSchema = z.object({
  issue_key: z.string().describe('Jira issue key (e.g., \'PROJ-123\')'),
  expand: z.string().describe('Optional fields to expand').optional(),
});

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = z.infer<typeof ToolInputSchema>;

// Add Jira client configuration schema
const JiraConfigSchema = z.object({
  protocol: z.string().default('https'),
  host: z.string().describe('Jira host (e.g., your-domain.atlassian.net)'),
  username: z.string().describe('Jira username/email'),
  password: z.string().describe('Jira API token'),
  apiVersion: z.string().default('2'),
  strictSSL: z.boolean().default(true)
});

// Initialize Jira client from command line arguments
const jiraConfig = JiraConfigSchema.parse({
  protocol: 'https',
  host: jiraUrl.replace(/^https?:\/\//, ''), // Remove protocol
  username: jiraUsername,
  password: jiraApiToken,
  apiVersion: '3',
  strictSSL: true
});

const jira = new JiraClient(jiraConfig);

// Server setup
const server = new Server(
  {
    name: "secure-jira-server",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Tool implementations

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "jira_get_issue",
        description: "Get details of a specific Jira issue.",
        inputSchema: zodToJsonSchema(JiraGetIssueArgsSchema) as ToolInput,
      }
    ]
  };
});


server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "jira_get_issue": {
        const parsed = JiraGetIssueArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for jira_get_issue: ${parsed.error}`);
        }
        
        const { issue_key, expand } = parsed.data;
        const issue = await jira.findIssue(issue_key, expand);
        
        return {
          content: [{ type: "text", text: JSON.stringify(issue, null, 2) }],
          isError: false,
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

// Start server
async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Secure MCP Jira Server running on stdio");
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});