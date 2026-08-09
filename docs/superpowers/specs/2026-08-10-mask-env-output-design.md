# Mask Environment Values in Tool Responses

## Goal

Prevent `inspect` and `compose_config` from exposing container or service environment values while preserving environment names and every unrelated part of the response. Keep the externally visible behavior of `read_env` unchanged.

## Scope

- `inspect` masks every value in Docker inspect `Config.Env` and `ContainerConfig.Env` arrays, including keys whose names do not look sensitive.
- `compose_config` masks every value in each `services.*.environment` block, for both object and `KEY=value` array representations.
- `read_env` continues to use `envProtectedPatterns` and the existing `****` mask.
- Other structured fields, including image, labels, network configuration, status, ports, and mounts, remain unchanged.
- Raw arbitrary text, including files returned by `read_file` and application output from `logs` or `exec_in`, is outside this change. Reliably interpreting arbitrary Compose YAML would require a YAML parser or a fragile custom parser, while the requested change forbids a new dependency and requires unrelated information to remain intact.

## Design

All successful MCP tool results pass through the existing response construction path in `src/tools.js`. That path will call one central output filter before serializing the result. The filter receives the tool name so it can apply semantic rules only where the response contract identifies environment data.

The filter reuses the existing environment masking primitive from `src/envFiles.js` rather than duplicating mask parsing or formatting. It handles the two Docker representations:

- arrays such as `['KEY=value', 'EMPTY=']`, preserving the key and replacing the value with `****`;
- objects such as `{ KEY: 'value' }`, preserving keys and replacing values with `****`.

For `read_env`, the existing pattern-based masking remains in place. The central response path does not apply blanket masking to that tool, so its current public behavior remains stable.

The filter is deliberately shape-aware instead of replacing matching strings globally. Therefore a value repeated in an image name, label, mount path, network name, port, or status is not altered merely because it also appears as an environment value.

## Data Flow

1. A tool handler returns its native value.
2. The common call handler passes the tool name and value to the output filter.
3. For `inspect`, the filter clones only the relevant inspect objects and masks `Config.Env` and `ContainerConfig.Env`.
4. For `compose_config`, the filter clones only services and their `environment` fields.
5. For all other tools, including `read_env`, the filter returns the existing value unchanged.
6. The common response builder serializes the filtered value into MCP text content.

## Error Handling

Missing or differently shaped environment fields are left untouched rather than causing a tool failure. Existing Docker parsing and tool error handling do not change. The filter must not mutate handler-owned response objects.

## Testing

Regression tests will exercise the registered MCP call handler, matching the production path. They will verify:

- `inspect` retains environment names but exposes none of their original values;
- a non-sensitive-looking key such as `VIRTUAL_HOST` is also masked in `inspect`;
- `Config.Env` and `ContainerConfig.Env` are covered;
- image, labels, network settings, status, ports, and mounts are unchanged;
- `compose_config` masks object and array environment forms without changing other service fields;
- `read_env` still masks only names matching `envProtectedPatterns` and keeps its current result structure.

The focused tests will be run red before production changes and green afterward. The complete test suite and the repository's lint command, if one exists, will be run before completion.

## Non-goals

- Introducing an allowlist of supposedly safe environment names.
- Adding a dependency.
- Redacting arbitrary application logs, command output, or free-form file contents.
- Changing environment editing protections or Docker command authorization.
