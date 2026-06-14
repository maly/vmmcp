# MCP devtools server pro dev/stage VM

## Záměr

Při ladění infrastruktury (typicky proxy, SSO, vhosty) se opakovaně provádějí stejné průzkumné a obslužné operace ve shellu na VM: `docker logs`, `docker compose up/down/restart`, `docker exec <c> curl <url>`, čtení a editace `docker-compose.yml`, `nginx-vhost/*` a `.env`. Claude Code (CC) je dnes nemůže dělat sám — chybí mu přístup. Plný SSH přístup je příliš mnoho.

Navrhuje se tenký MCP server běžící per-VM, který CC nabídne **pojmenovanou, ohraničenou sadu nástrojů** místo volného shellu. Hranice nejsou ve tvaru příkazu, ale v explicitních schopnostech: read-only explorace je volná v rámci povolených binárek, mutace jsou jen ty, které server explicitně implementuje. CC se připojí přes „Připoj se k cemedia-test".

## Rozsah

**Nástroje:**

Explorace (read-only):
- `ps` — běžící kontejnery, stav, porty
- `compose_config` — finální rozparsovaný compose
- `logs(container, tail=200)` — snapshot logů (follow se ignoruje, stream nemá konec)
- `inspect(container)` — docker inspect JSON
- `read_file(path)` — jen z `READABLE_GLOBS`, s tvrdým `DENY_GLOBS`
- `read_env(service)` — `.env` / `environment:`, hodnoty senzitivních klíčů maskovány
- `exec_in(container, argv[])` — pole argumentů (žádný shell), jen read-only binárky

Mutace (pevná signatura):
- `compose_up(service?, force_recreate?)`, `compose_pull(service?)`, `compose_down()`, `restart(container)` — `service`/`container` jen z vlastního compose projektu (allowlist se generuje z labelů)
- `write_file(path, content)` — jen `WRITABLE_GLOBS`, verzováno před zápisem
- `set_env_var(file, key, value)` — editace `.env` přes sed (řádka na místě), odmítne senzitivní klíče; celý `write_file` na `.env` zakázán
- `copy_file(src, dst)` — kopie bajtů na disku (ne přečteného obsahu), aby se klon `.env` nezkazil maskováním; cíl musí být v povoleném kořeni
- `delete_file(path)` — jen v povoleném kořeni, verzováno
- `run_script(name)` — jen z `ALLOWED_SCRIPTS` (`start`, `update`)

Verzování:
- `restore_file(path, backup_id?)` — bez `backup_id` poslední verze
- `list_backups(path)`

**Mimo rozsah (vědomě tobě):** generování secretů (`openssl rand`), práva souborů (`chmod`), ruční vkládání tajemství do `.env`, `docker pull` konkrétního image mimo compose service.

**Konfigurace serveru:**
```
COMPOSE_PROJECT_DIR     # ~ ; service si načte z compose labelů
WRITABLE_GLOBS          = ["docker-compose.yml", "nginx-vhost/*", "*.conf", "start", "update"]
READABLE_GLOBS          = WRITABLE_GLOBS + [".env", "strata.env", "*.env"]
DENY_GLOBS              = [".ssh/*", "**/id_rsa*", "**/id_ed25519*"]
ENV_FILES               = [".env", "strata.env"]
ENV_PROTECTED_PATTERNS  = ["*PASSWORD*", "*API_KEY*", "*SECRET*", "*TOKEN*"]
ALLOWED_SCRIPTS         = ["start", "update"]
EXEC_BINARIES           # pevně v kódu: nginx cat grep curl wget getent nslookup env ls head tail test
```

**Klíčové omezení čtení/zápisu:** docker operace běží v kontextu `~`, ale `read_file`/`write_file`/`copy_file`/`delete_file` jsou omezené na explicitní allowlist cest, ne na celý `~`. `read_file("~/.ssh/id_ed25519")` server odmítne, i když k němu proces technicky přístup má.

## Dopad

**Přínos:** CC dotáhne ladící cyklus (přečti config → najdi problém → uprav → nahoď → ověř logem) sám, bez přepínání do shellu. Pokrývá reálný pracovní postup z posledních sessions (ladění oauth2-proxy, keycloak health, vhosty).

**Architektura — MCP přes stdio spuštěné přes ssh.** Server neběží jako trvalý daemon a neposlouchá na žádném portu. CC ho spustí on-demand jako stdio proces na druhém konci SSH spojení:

```json
{
  "mcpServers": {
    "cemedia-test": {
      "command": "ssh",
      "args": ["cemedia-test", "node", "/home/cemedia/mcp-devtools/server.js"]
    }
  }
}
```

CC zavolá `ssh`, ten si vezme host `cemedia-test` z `~/.ssh/config`, spustí server na VM a mluví s ním po SSH rouře (stdin/stdout). „Připoj se k cemedia-test" = jméno SSH hostu. Spojení končí s během CC.

Důsledky tohoto rozhodnutí:
- **Žádný systemd daemon, žádný port, žádný tunel, žádná HTTP vrstva, žádný oauth2-proxy.** Autentizaci řeší SSH klíč.
- **Self-kill problém mizí** — server je efemérní proces spuštěný přes ssh, ne kontejner v compose projektu. `compose down` se ho netýká.
- **Smyčka přes nginx-proxy mizí** — nástroj na ladění proxy není na proxy nijak závislý.
- **Přenositelnost napříč OS** — `ssh` klient je nativně na Windows (OpenSSH od Win10), macOS i Linux. Config CC je na všech identický, mění se jen umístění `~/.ssh/config`, které řeší ssh sám. Žádná platformně specifická závislost (na rozdíl od autossh tunelu).

**Bezpečnostní pojistka:** SSH klíč dedikovaný pro tento účel, v `authorized_keys` omezený přes `command="node /home/cemedia/mcp-devtools/server.js"` — klíč neumí spustit interaktivní shell, jen nahodit MCP server. Omezený klíč + MCP nástroje = hranice „pár vývojářských věcí, ne plný shell". Klíč bez passphrase (kvůli neinteraktivnímu spuštění z CC); riziko nezvyšuje ničím navíc, protože `command=` ho stejně omezuje na jediný příkaz.

**Rizika:**
- Přístup k `docker.sock` ≈ root na hostiteli. Stejná riziková plocha, jakou už mají `restic` a `alloy` — nepřidává nic nového.
- `curl`/`wget` z kontejnerů umožňují teoretickou exfiltraci souboru na cizí endpoint. Na dev/stage akceptováno.
- `write_file` může rozbít fungující config — mitigováno povinným verzováním do `~/.mcp-backups/<relpath>/<ISO-timestamp>` před každým zásahem; rollback je jedno volání `restore_file`.

**Navazující kroky:** implementace (ES6, `@modelcontextprotocol/sdk` stdio transport, funkcionální styl), nasazení klíče s `command=` omezením, ověření na `cemedia-test`, poté rozšíření na stage.
