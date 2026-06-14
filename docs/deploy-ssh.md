# Deploy MCP Devtools over SSH stdio

This server is designed to be launched on demand by an MCP client through SSH. It is not a daemon, does not listen on a port, and does not require an HTTP, tunnel, or OAuth layer.

## VM install path

Use a dedicated directory on the target VM, for example:

```sh
/home/cemedia/mcp-devtools
```

Install the project files there and install production dependencies:

```sh
cd /home/cemedia/mcp-devtools
npm install --omit=dev
```

The MCP entrypoint is:

```sh
node /home/cemedia/mcp-devtools/src/server.js
```

## Claude Code MCP config

Configure Claude Code to launch the server through the native SSH client:

```json
{
  "mcpServers": {
    "cemedia-test": {
      "command": "ssh",
      "args": ["cemedia-test", "node", "/home/cemedia/mcp-devtools/src/server.js"]
    }
  }
}
```

The `cemedia-test` host name is resolved by the user's normal SSH config.

## Restricted SSH key

Use a dedicated SSH key for this MCP server. The key can be passphrase-less for non-interactive startup, but it should be constrained in `authorized_keys` so it can only start the MCP process:

```text
command="node /home/cemedia/mcp-devtools/src/server.js",no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA... codex-mcp-devtools
```

With this restriction, the key cannot open an interactive shell. The remaining boundary is the MCP server's explicit tool set and its path/container allowlists.

## Runtime configuration

Set environment variables for the SSH forced command if the defaults are not suitable:

```sh
COMPOSE_PROJECT_DIR=/home/cemedia
WRITABLE_GLOBS=docker-compose.yml,nginx-vhost/*,*.conf,start,update
READABLE_GLOBS=docker-compose.yml,nginx-vhost/*,*.conf,start,update,.env,strata.env,*.env
DENY_GLOBS=.ssh/*,**/id_rsa*,**/id_ed25519*
ENV_FILES=.env,strata.env
ENV_PROTECTED_PATTERNS=*PASSWORD*,*API_KEY*,*SECRET*,*TOKEN*
ALLOWED_SCRIPTS=start,update
```

If the forced-command environment cannot set these directly, wrap the node command in a small dedicated script that exports the variables and then execs `node`.
