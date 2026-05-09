/* eslint-disable @typescript-eslint/explicit-function-return-type */

function parseElectronCliArgs(value) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((arg) => typeof arg === "string")
      : [];
  } catch {
    return [];
  }
}

function hasOzonePlatform(args) {
  return args.some(
    (arg) => arg === "--ozone-platform" || arg.startsWith("--ozone-platform="),
  );
}

export function createElectronViteArgs(
  args = [],
  baseEnv = process.env,
  platform = process.platform,
) {
  const nextArgs = [...args];
  const envArgs = parseElectronCliArgs(baseEnv.ELECTRON_CLI_ARGS);

  const isWayland =
    baseEnv.WAYLAND_DISPLAY != null ||
    baseEnv.XDG_SESSION_TYPE === "wayland";

  if (
    platform !== "linux" ||
    !isWayland ||
    hasOzonePlatform(nextArgs) ||
    hasOzonePlatform(envArgs)
  ) {
    return nextArgs;
  }

  const separatorIndex = nextArgs.indexOf("--");
  if (separatorIndex === -1) {
    return [...nextArgs, "--", "--ozone-platform=x11"];
  }

  return [
    ...nextArgs.slice(0, separatorIndex + 1),
    "--ozone-platform=x11",
    ...nextArgs.slice(separatorIndex + 1),
  ];
}

export function createElectronViteEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  delete env.ELECTRON_RUN_AS_NODE;

  return env;
}
