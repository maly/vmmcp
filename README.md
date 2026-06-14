# VM MCP Devtools

Tenký MCP server pro ohraničené devtools operace na dev/stage VM. Server se spouští on-demand přes stdio, typicky přes SSH, a nevystavuje žádný port ani volný shell.

## Co je hotové

Server poskytuje MCP nástroje pro:

- čtení stavu Docker Compose projektu: `ps`, `compose_config`, `logs`, `inspect`
- omezené Docker mutace: `compose_up`, `compose_pull`, `compose_down`, `restart`
- bezpečné souborové operace nad allowlistem: `read_file`, `write_file`, `copy_file`, `delete_file`
- verzování změn a rollback: `list_backups`, `restore_file`
- čtení env hodnot s maskováním tajemství: `read_env`
- řízenou editaci env klíčů: `set_env_var`
- omezené spuštění diagnostiky v kontejneru: `exec_in`
- spuštění povolených projektových skriptů: `run_script`

Ověření:

```sh
npm test
```

## Bezpečnostní model

Server nenabízí obecný shell. Každý MCP tool má pevnou signaturu a vlastní validaci vstupů.

Hlavní pojistky:

- Docker příkazy běží přes `spawn()` bez shellu.
- `exec_in` přijímá pouze argv pole a povoluje jen vybrané binárky.
- Mutace kontejnerů/služeb jsou omezené na vlastní Docker Compose projekt.
- Souborové operace jsou omezené přes `readableGlobs`, `writableGlobs` a `denyGlobs`.
- `.env` lze číst maskovaně, ale nejde přepsat přes `write_file`.
- `set_env_var` odmítá chráněné klíče podle `envProtectedPatterns`.
- Před zápisem, kopírováním přes existující cíl a smazáním se vytváří backup v `.mcp-backups`.

Přístup k Docker socketu je na hostiteli silné oprávnění. Tento server omezuje MCP rozhraní, ale nemění bezpečnostní vlastnosti samotného Dockeru.

## Instalace na server

Příklad cílového umístění:

```sh
sudo mkdir -p /opt/vm-mcp-devtools
sudo chown "$USER":"$USER" /opt/vm-mcp-devtools
cd /opt/vm-mcp-devtools
git clone <repo-url> .
npm install --omit=dev
```

Vytvořte konfigurační soubor:

```sh
cp config.example.json config.json
```

Upravte `config.json` podle cílového Docker Compose projektu.

Ověření, že server jde spustit:

```sh
node /opt/vm-mcp-devtools/src/server.js --config /opt/vm-mcp-devtools/config.json
```

Proces čeká na MCP JSON-RPC zprávy na stdin. Při ručním spuštění obvykle nic nevypisuje.

## Konfigurace

Konfigurace je JSON soubor. Server ho načítá přes `--config <path>`. Pokud argument chybí, hledá `config.json` v aktuálním pracovním adresáři.

Příklad:

```json
{
  "composeProjectDir": "/srv/example-app",
  "writableGlobs": [
    "docker-compose.yml",
    "nginx-vhost/*",
    "*.conf",
    "start",
    "update"
  ],
  "readableGlobs": [
    "docker-compose.yml",
    "nginx-vhost/*",
    "*.conf",
    "start",
    "update",
    ".env",
    "example.env",
    "*.env"
  ],
  "denyGlobs": [
    ".ssh/*",
    "**/id_rsa*",
    "**/id_ed25519*"
  ],
  "envFiles": [
    ".env",
    "example.env"
  ],
  "envProtectedPatterns": [
    "*PASSWORD*",
    "*API_KEY*",
    "*SECRET*",
    "*TOKEN*"
  ],
  "allowedScripts": [
    "start",
    "update"
  ]
}
```

`composeProjectDir` může být absolutní nebo relativní vůči adresáři, ve kterém leží config soubor.

## Doporučené SSH nastavení

Na klientském stroji vytvořte dedikovaný SSH klíč:

```sh
ssh-keygen -t ed25519 -f ~/.ssh/example-dev-mcp -C example-mcp-devtools
```

Do `~/.ssh/config` přidejte host:

```sshconfig
Host example-dev
  HostName example.dev.internal
  User example
  IdentityFile ~/.ssh/example-dev-mcp
  IdentitiesOnly yes
```

Na VM vložte public key do `~/.ssh/authorized_keys` s omezením `command=`:

```text
command="node /opt/vm-mcp-devtools/src/server.js --config /opt/vm-mcp-devtools/config.json",no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA... example-mcp-devtools
```

Tento klíč neumí otevřít interaktivní shell. Umí jen spustit MCP server.

## Nastavení v Claude Code / Codex

Do MCP konfigurace přidejte server:

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

Pokud používáte `authorized_keys command=...`, SSH server vynutí správný command i v případě, že klient pošle jiný. V takovém setupu může být MCP konfigurace na klientovi stejná nebo jednodušší; forced command na serveru rozhoduje.

## Ukázka docker-compose service

Doporučená architektura je SSH stdio bez daemonu. Pokud ale chcete server spouštět přes Docker Compose jako jednorázový stdio proces, použijte samostatný compose projekt mimo cílový projekt, který bude server ovládat.

Příklad wrapper compose souboru:

```yaml
services:
  mcp-devtools:
    image: node:24-alpine
    working_dir: /app
    command:
      - node
      - /app/src/server.js
      - --config
      - /config/config.json
    stdin_open: true
    tty: false
    volumes:
      - /opt/vm-mcp-devtools:/app:ro
      - /opt/vm-mcp-devtools/config.json:/config/config.json:ro
      - /srv/example-app:/project
      - /var/run/docker.sock:/var/run/docker.sock
```

V tomto režimu nastavte v configu:

```json
{
  "composeProjectDir": "/project"
}
```

Spuštění přes SSH stdio může vypadat takto:

```json
{
  "mcpServers": {
    "example-dev": {
      "command": "ssh",
      "args": [
        "example-dev",
        "docker",
        "compose",
        "-f",
        "/opt/vm-mcp-devtools/docker-compose.yml",
        "run",
        "--rm",
        "mcp-devtools"
      ]
    }
  }
}
```

Nepoužívejte `docker compose up -d` pro MCP transport. MCP server komunikuje přes stdin/stdout, takže pro klienta musí běžet jako připojený proces.

## Příklad použití

Po připojení MCP serveru může agent volat nástroje přibližně takto:

```text
ps
```

Vrátí kontejnery z cílového compose projektu.

```text
read_file(path="docker-compose.yml")
```

Přečte povolený soubor.

```text
read_env(service="web")
```

Vrátí env hodnoty, ale chráněné klíče budou maskované jako `****`.

Typický debug cyklus:

```text
read_file(path="nginx-vhost/app.conf")
write_file(path="nginx-vhost/app.conf", content="...")
restart(container="example-web-1")
logs(container="example-web-1", tail=100)
```

Rollback poslední změny:

```text
list_backups(path="nginx-vhost/app.conf")
restore_file(path="nginx-vhost/app.conf")
```

Diagnostika uvnitř kontejneru:

```text
exec_in(container="example-web-1", argv=["curl", "http://localhost"])
exec_in(container="example-web-1", argv=["nginx", "-t"])
```

Shell není povolen:

```text
exec_in(container="example-web-1", argv=["sh", "-c", "cat /etc/passwd"])
```

Tento požadavek server odmítne.

## Lokální vývoj

Instalace:

```sh
npm install
```

Testy:

```sh
npm test
```

Lokální spuštění serveru:

```sh
node src/server.js --config ./config.json
```

Server očekává MCP zprávy na stdin/stdout. Pro běžné ruční ověření používejte MCP klienta nebo test suite.
