import { maskEnv } from "./envFiles.js";

const MASK_ALL = ["*"];

function filterInspect(value) {
  if (!Array.isArray(value)) return value;

  return value.map((container) => {
    if (container === null || typeof container !== "object") return container;

    let filtered = container;
    for (const key of ["Config", "ContainerConfig"]) {
      const section = filtered[key];
      if (section === null || typeof section !== "object" || !("Env" in section)) continue;
      filtered = {
        ...filtered,
        [key]: {
          ...section,
          Env: maskEnv(section.Env, MASK_ALL)
        }
      };
    }
    return filtered;
  });
}

function filterComposeConfig(value) {
  if (
    value === null
    || typeof value !== "object"
    || value.services === null
    || typeof value.services !== "object"
    || Array.isArray(value.services)
  ) {
    return value;
  }

  return {
    ...value,
    services: Object.fromEntries(
      Object.entries(value.services).map(([name, service]) => {
        if (
          service === null
          || typeof service !== "object"
          || !("environment" in service)
        ) {
          return [name, service];
        }
        return [name, {
          ...service,
          environment: maskEnv(service.environment, MASK_ALL)
        }];
      })
    )
  };
}

export function filterToolOutput(toolName, value) {
  if (toolName === "inspect") return filterInspect(value);
  if (toolName === "compose_config") return filterComposeConfig(value);
  return value;
}
