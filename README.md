# VM MCP Devtools

Tenký MCP server pro bezpečně ohraničené devtools operace na dev/stage VM. Server se spouští on-demand přes stdio, typicky přes SSH, a nevystavuje žádný port ani volný shell.

## Výsledek implementace

Projekt obsahuje Node.js ESM MCP server s nástroji pro:

- čtení stavu Docker Compose projektu: `ps`, `compose_config`, `logs`, `inspect`
- omezené Docker mutace: `compose_up`, `compose_pull`, `compose_down`, `restart`
- bezpečné souborové operace nad allowlistem: `read_file`, `write_file`, `copy_file`, `delete_file`
- verzování změn a rollback: `list_backups`, `restore_file`
- čtení env hodnot s maskováním tajemství: `read_env`
- řízenou editaci env klíčů: `set_env_var`
- omezené spuštění diagnostiky v kontejneru: `exec_in`
- spuštění povolených projektových skriptů: `run_script`

Automatické testy:

```sh
npm test
```

Aktuální stav po implementaci: `35/35` testů prochází.

## Bezpečnostní model

Server nenabízí obecný shell. Každý MCP tool má pevnou signaturu a vlastní validaci vstupů.

Hlavní pojistky:

- Docker příkazy běží přes `spawn()` bez shellu.
- `exec_in` přijímá pouze argv pole a povoluje jen vybrané binárky.
- Mutace kontejnerů/služeb jsou omezené na vlastní Docker Compose projekt.
- Souborové operace jsou omezené přes `READABLE_GLOBS`, `WRITABLE_GLOBS` a `DENY_GLOBS`.
- `.env` lze číst maskovaně, ale nejde přepsat přes `write_file`.
- `set_env_var` odmítá chráněné klíče jako `PASSWORD`, `API_KEY`, `SECRET`, `TOKEN`.
- Před zápisem, kopírováním přes existující cíl a smazáním se vytváří backup v `.mcp-backups`.

Pozor: přístup k Docker socketu je na hostiteli silné oprávnění. Tento server omezuje MCP rozhraní, ale nemění bezpečnostní vlastnosti samotného Dockeru.

## Instalace na server přes SSH stdio

Doporučený způsob je instalovat server jako obyčejný adresář na VM a spouštět ho přes SSH:

```sh
mkdir -p /home/cemedia/mcp-devtools
cd /home/cemedia/mcp-devtools
git clone <repo-url> .
npm install --omit=dev
```

Ověření na VM:

```sh
node /home/cemedia/mcp-devtools/src/server.js
```

Proces čeká na MCP JSON-RPC zprávy na stdin. Ručně v terminálu obvykle nic nevypisuje.

## Runtime konfigurace

Nastavte prostředí podle konkrétní VM a cílového compose projektu:

```sh
export COMPOSE_PROJECT_DIR=/home/cemedia
export WRITABLE_GLOBS='docker-compose.yml,nginx-vhost/*,*.conf,start,update'
export READABLE_GLOBS='docker-compose.yml,nginx-vhost/*,*.conf,start,update,.env,strata.env,*.env'
export DENY_GLOBS='.ssh/*,**/id_rsa*,**/id_ed25519*'
export ENV_FILES='.env,strata.env'
export ENV_PROTECTED_PATTERNS='*PASSWORD*,*API_KEY*,*SECRET*,*TOKEN*'
export ALLOWED_SCRIPTS='start,update'
```

Výchozí hodnoty odpovídají návrhu v `docs/proposal-mcp-devtools.md`, takže pro běžný případ stačí nastavit jen `COMPOSE_PROJECT_DIR`.

## Doporučené SSH nastavení

Na klientském stroji vytvořte dedikovaný SSH klíč:

```sh
ssh-keygen -t ed25519 -f ~/.ssh/cemedia-test-mcp -C codex-mcp-devtools
```

Do `~/.ssh/config` přidejte host:

```sshconfig
Host cemedia-test
  HostName cemedia-test.example.com
  User cemedia
  IdentityFile ~/.ssh/cemedia-test-mcp
  IdentitiesOnly yes
```

Na VM vložte public key do `~/.ssh/authorized_keys` s omezením `command=`:

```text
command="COMPOSE_PROJECT_DIR=/home/cemedia node /home/cemedia/mcp-devtools/src/server.js",no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA... codex-mcp-devtools
```

Tento klíč neumí otevřít interaktivní shell. Umí jen spustit MCP server.

## Nastavení v Claude Code / Codex

Do MCP konfigurace přidejte server:

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

Pokud používáte `authorized_keys command=...`, SSH server vynutí správný command i v případě, že klient pošle jiný. V takovém setupu může být MCP konfigurace stále stejná; forced command na serveru ji přepíše.

## Ukázka docker-compose service

Doporučená architektura je SSH stdio bez daemonu. Pokud ale chcete server spouštět přes Docker Compose jako jednorázový stdio proces, můžete použít samostatný compose projekt mimo cílový projekt, který bude server ovládat.

Příklad `docker-compose.yml` pro wrapper projekt `/opt/mcp-devtools`:

```yaml
services:
  mcp-devtools:
    image: node:24-alpine
    working_dir: /app
    command: ["node", "/app/src/server.js"]
    stdin_open: true
    tty: false
    environment:
      COMPOSE_PROJECT_DIR: /project
      WRITABLE_GLOBS: "docker-compose.yml,nginx-vhost/*,*.conf,start,update"
      READABLE_GLOBS: "docker-compose.yml,nginx-vhost/*,*.conf,start,update,.env,strata.env,*.env"
      DENY_GLOBS: ".ssh/*,**/id_rsa*,**/id_ed25519*"
      ENV_FILES: ".env,strata.env"
      ENV_PROTECTED_PATTERNS: "*PASSWORD*,*API_KEY*,*SECRET*,*TOKEN*"
      ALLOWED_SCRIPTS: "start,update"
    volumes:
      - /home/cemedia/mcp-devtools:/app:ro
      - /home/cemedia:/project
      - /var/run/docker.sock:/var/run/docker.sock
```

Spuštění přes SSH stdio pak může vypadat takto:

```json
{
  "mcpServers": {
    "cemedia-test": {
      "command": "ssh",
      "args": [
        "cemedia-test",
        "docker",
        "compose",
        "-f",
        "/opt/mcp-devtools/docker-compose.yml",
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

```text
write_file(path="nginx-vhost/app.conf", content="...")
restart(container="project-web-1")
logs(container="project-web-1", tail=100)
```

Typický debug cyklus: přečíst konfiguraci, upravit vhost, restartovat kontejner a ověřit log.

Rollback poslední změny:

```text
list_backups(path="nginx-vhost/app.conf")
restore_file(path="nginx-vhost/app.conf")
```

Diagnostika uvnitř kontejneru:

```text
exec_in(container="project-web-1", argv=["curl", "http://localhost"])
exec_in(container="project-web-1", argv=["nginx", "-t"])
```

Shell není povolen:

```text
exec_in(container="project-web-1", argv=["sh", "-c", "cat /etc/passwd"])
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
COMPOSE_PROJECT_DIR=/path/to/compose-project node src/server.js
```

Server očekává MCP zprávy na stdin/stdout. Pro běžné ruční ověření používejte MCP klienta nebo test suite.
