import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DockerAvailability {
  available: boolean;
  composeAvailable: boolean;
  serverVersion: string | null;
  reason?: string;
}

export async function detectDockerAvailability(
  exec: typeof execFileAsync = execFileAsync,
): Promise<DockerAvailability> {
  let composeAvailable = false;
  try {
    await exec("docker", ["compose", "version"], { timeout: 10_000 });
    composeAvailable = true;
  } catch {
    composeAvailable = false;
  }

  try {
    const { stdout } = await exec("docker", ["info", "--format", "{{.ServerVersion}}"], {
      timeout: 15_000,
    });
    const serverVersion = stdout.trim() || null;
    return {
      available: Boolean(serverVersion),
      composeAvailable,
      serverVersion,
    };
  } catch (err) {
    return {
      available: false,
      composeAvailable,
      serverVersion: null,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function imageExistsLocally(
  image: string,
  exec: typeof execFileAsync = execFileAsync,
): Promise<boolean> {
  try {
    await exec("docker", ["image", "inspect", image], { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}
