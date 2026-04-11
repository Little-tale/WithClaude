import os from "node:os";
import path from "node:path";

export function defaultOpenCodeConfigDir(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
  return xdgConfigHome
    ? path.resolve(xdgConfigHome, "opencode")
    : path.join(os.homedir(), ".config", "opencode");
}
