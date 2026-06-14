import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import {
  composeConfig,
  composeDown,
  composePull,
  composeUp,
  inspect as inspectContainer,
  logs,
  ps,
  restart
} from "./docker.js";
import { readEnv, setEnvVar } from "./envFiles.js";
import { execIn, runScript } from "./execIn.js";
import {
  copyFileTool,
  deleteFileTool,
  listBackupsTool,
  readFileTool,
  restoreFileTool,
  writeFileTool
} from "./fileOps.js";

const emptySchema = {
  type: "object",
  properties: {},
  additionalProperties: false
};

function objectSchema(properties, required = []) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}

function stringProperty(description) {
  return { type: "string", description };
}

function booleanProperty(description) {
  return { type: "boolean", description };
}

function integerProperty(description, minimum = 0) {
  return { type: "integer", minimum, description };
}

function jsonText(value) {
  return JSON.stringify(value, null, 2);
}

function toolResult(value) {
  if (typeof value === "string") {
    return { content: [{ type: "text", text: value }] };
  }

  return { content: [{ type: "text", text: jsonText(value) }] };
}

function toolError(error) {
  return {
    isError: true,
    content: [{
      type: "text",
      text: error instanceof Error ? error.message : String(error)
    }]
  };
}

export function createToolDefinitions({ config, runner }) {
  const cwd = config.composeProjectDir;

  return [
    {
      name: "ps",
      description: "List running containers for the configured compose project.",
      inputSchema: emptySchema,
      annotations: { readOnlyHint: true },
      handler: () => ps({ runner, cwd })
    },
    {
      name: "compose_config",
      description: "Return docker compose config rendered as JSON.",
      inputSchema: emptySchema,
      annotations: { readOnlyHint: true },
      handler: () => composeConfig({ runner, cwd })
    },
    {
      name: "logs",
      description: "Return a non-following docker logs snapshot for a known container.",
      inputSchema: objectSchema({
        container: stringProperty("Compose project container name."),
        tail: integerProperty("Number of log lines to return.", 1)
      }, ["container"]),
      annotations: { readOnlyHint: true },
      handler: (args) => logs({ runner, cwd, container: args.container, tail: args.tail ?? 200 })
    },
    {
      name: "inspect",
      description: "Return docker inspect JSON for a container.",
      inputSchema: objectSchema({
        container: stringProperty("Container name.")
      }, ["container"]),
      annotations: { readOnlyHint: true },
      handler: (args) => inspectContainer({ runner, cwd, container: args.container })
    },
    {
      name: "read_file",
      description: "Read a file allowed by READABLE_GLOBS and DENY_GLOBS.",
      inputSchema: objectSchema({
        path: stringProperty("Project-relative path.")
      }, ["path"]),
      annotations: { readOnlyHint: true },
      handler: (args) => readFileTool(config, args.path)
    },
    {
      name: "read_env",
      description: "Read configured env files with protected values masked.",
      inputSchema: objectSchema({
        service: stringProperty("Optional compose service whose environment should be included.")
      }),
      annotations: { readOnlyHint: true },
      handler: async (args) => readEnv({
        config,
        service: args.service,
        composeConfig: args.service ? await composeConfig({ runner, cwd }) : undefined
      })
    },
    {
      name: "exec_in",
      description: "Run an allowed read-only binary inside a known compose container.",
      inputSchema: objectSchema({
        container: stringProperty("Compose project container name."),
        argv: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "Argument vector. The first item must be an allowed binary."
        }
      }, ["container", "argv"]),
      annotations: { readOnlyHint: true, openWorldHint: false },
      handler: (args) => execIn({ runner, cwd, container: args.container, argv: args.argv })
    },
    {
      name: "compose_up",
      description: "Run docker compose up -d for the project or one known service.",
      inputSchema: objectSchema({
        service: stringProperty("Optional compose service."),
        force_recreate: booleanProperty("Whether to pass --force-recreate.")
      }),
      annotations: { destructiveHint: true },
      handler: (args) => composeUp({
        runner,
        cwd,
        service: args.service,
        forceRecreate: Boolean(args.force_recreate)
      })
    },
    {
      name: "compose_pull",
      description: "Run docker compose pull for the project or one known service.",
      inputSchema: objectSchema({
        service: stringProperty("Optional compose service.")
      }),
      annotations: { destructiveHint: true },
      handler: (args) => composePull({ runner, cwd, service: args.service })
    },
    {
      name: "compose_down",
      description: "Run docker compose down for the configured project.",
      inputSchema: emptySchema,
      annotations: { destructiveHint: true },
      handler: () => composeDown({ runner, cwd })
    },
    {
      name: "restart",
      description: "Restart a known compose project container.",
      inputSchema: objectSchema({
        container: stringProperty("Compose project container name.")
      }, ["container"]),
      annotations: { destructiveHint: true },
      handler: (args) => restart({ runner, cwd, container: args.container })
    },
    {
      name: "write_file",
      description: "Write an allowed file after creating a backup.",
      inputSchema: objectSchema({
        path: stringProperty("Project-relative writable path."),
        content: stringProperty("New file content.")
      }, ["path", "content"]),
      annotations: { destructiveHint: true },
      handler: (args) => writeFileTool(config, args.path, args.content)
    },
    {
      name: "set_env_var",
      description: "Set one non-protected key in a configured env file after backup.",
      inputSchema: objectSchema({
        file: stringProperty("Configured env file name."),
        key: stringProperty("Non-protected env key."),
        value: stringProperty("New value.")
      }, ["file", "key", "value"]),
      annotations: { destructiveHint: true },
      handler: (args) => setEnvVar({
        config,
        file: args.file,
        key: args.key,
        value: args.value
      })
    },
    {
      name: "copy_file",
      description: "Copy bytes between allowed project files after backing up destination.",
      inputSchema: objectSchema({
        src: stringProperty("Readable source path."),
        dst: stringProperty("Writable destination path.")
      }, ["src", "dst"]),
      annotations: { destructiveHint: true },
      handler: (args) => copyFileTool(config, args.src, args.dst)
    },
    {
      name: "delete_file",
      description: "Delete an allowed writable file after creating a backup.",
      inputSchema: objectSchema({
        path: stringProperty("Project-relative writable path.")
      }, ["path"]),
      annotations: { destructiveHint: true },
      handler: (args) => deleteFileTool(config, args.path)
    },
    {
      name: "restore_file",
      description: "Restore a file from a named backup or the latest backup.",
      inputSchema: objectSchema({
        path: stringProperty("Project-relative readable path."),
        backup_id: stringProperty("Optional backup id.")
      }, ["path"]),
      annotations: { destructiveHint: true },
      handler: (args) => restoreFileTool(config, args.path, args.backup_id)
    },
    {
      name: "list_backups",
      description: "List backup ids for a project file.",
      inputSchema: objectSchema({
        path: stringProperty("Project-relative readable path.")
      }, ["path"]),
      annotations: { readOnlyHint: true },
      handler: (args) => listBackupsTool(config, args.path)
    },
    {
      name: "run_script",
      description: "Run an explicitly allowed project script without shell expansion.",
      inputSchema: objectSchema({
        name: stringProperty("Allowed script name.")
      }, ["name"]),
      annotations: { destructiveHint: true, openWorldHint: false },
      handler: (args) => runScript({ config, runner, name: args.name })
    }
  ];
}

export function registerTools(server, context) {
  const tools = createToolDefinitions(context);
  const handlers = new Map(tools.map((tool) => [tool.name, tool.handler]));
  const definitions = tools.map(({ handler: _handler, ...definition }) => definition);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: definitions }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const handler = handlers.get(request.params.name);
    if (!handler) {
      return toolError(new Error(`Unknown tool: ${request.params.name}`));
    }

    try {
      return toolResult(await handler(request.params.arguments ?? {}));
    } catch (error) {
      return toolError(error);
    }
  });
}
