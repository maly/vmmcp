# Deploy MCP Devtools over SSH stdio

This server is designed to be launched on demand by an MCP client through SSH. It is not a daemon, does not listen on a port, and does not require an HTTP, tunnel, or OAuth layer.

## VM install path

Use a dedicated directory on the target VM, for example:

```sh
/opt/vm-mcp-devtools
```

Install the project files there and install production dependencies:

```sh
cd /opt/vm-mcp-devtools
npm install --omit=dev
cp config.example.json config.json
```

The MCP entrypoint is:

```sh
node /opt/vm-mcp-devtools/src/server.js --config /opt/vm-mcp-devtools/config.json
```

## Claude Code MCP config

Configure Claude Code to launch the server through the native SSH client:

```json
{
  "mcpServers": {
    "example-dev": {
      "command": "ssh",
      "args": [
        "example-dev",
        "node",
        "/opt/vm-mcp-devtools/src/server.js",
        "--config",
        "/opt/vm-mcp-devtools/config.json"
      ]
    }
  }
}
```

The `example-dev` host name is resolved by the user's normal SSH config.

## Restricted SSH key

Use a dedicated SSH key for this MCP server. The key can be passphrase-less for non-interactive startup, but it should be constrained in `authorized_keys` so it can only start the MCP process:

```text
command="node /opt/vm-mcp-devtools/src/server.js --config /opt/vm-mcp-devtools/config.json",no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA... example-mcp-devtools
```

With this restriction, the key cannot open an interactive shell. The remaining boundary is the MCP server's explicit tool set and its path/container allowlists.

## Runtime configuration

Runtime configuration lives in `config.json`. Use `config.example.json` as the starting point:

```json
{
  "composeProjectDir": "/srv/example-app",
  "writableGlobs": ["docker-compose.yml", "nginx-vhost/*", "*.conf", "start", "update"],
  "readableGlobs": ["docker-compose.yml", "nginx-vhost/*", "*.conf", "start", "update", ".env", "example.env", "*.env"],
  "denyGlobs": [".ssh/*", "**/id_rsa*", "**/id_ed25519*"],
  "envFiles": [".env", "example.env"],
  "envProtectedPatterns": ["*PASSWORD*", "*API_KEY*", "*SECRET*", "*TOKEN*"],
  "allowedScripts": ["start", "update"]
}
```
