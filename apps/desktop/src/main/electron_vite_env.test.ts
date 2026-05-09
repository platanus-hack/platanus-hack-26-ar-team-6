import { describe, expect, it } from "vitest";

import {
  createElectronViteArgs,
  createElectronViteEnv,
} from "../../scripts/electron-vite-env.mjs";

describe("electron-vite launch environment", () => {
  it("removes Electron-as-Node mode before launching the app", () => {
    const env = createElectronViteEnv({
      ELECTRON_RUN_AS_NODE: "1",
      VITE_API_BASE_URL: "https://example.test",
    });

    expect(env).not.toHaveProperty("ELECTRON_RUN_AS_NODE");
    expect(env.VITE_API_BASE_URL).toBe("https://example.test");
  });

  it("passes the Linux X11 flag through to Electron Vite", () => {
    expect(createElectronViteArgs(["dev"], {}, "linux")).toEqual([
      "dev",
      "--",
      "--ozone-platform=x11",
    ]);
  });

  it("keeps existing Electron passthrough args when adding the Linux X11 flag", () => {
    expect(
      createElectronViteArgs(["dev", "--", "--disable-gpu"], {}, "linux"),
    ).toEqual(["dev", "--", "--ozone-platform=x11", "--disable-gpu"]);
  });

  it("preserves an explicit ozone platform override", () => {
    expect(
      createElectronViteArgs(
        ["dev", "--", "--ozone-platform=wayland", "--disable-gpu"],
        {},
        "linux",
      ),
    ).toEqual(["dev", "--", "--ozone-platform=wayland", "--disable-gpu"]);
  });

  it("preserves an explicit ozone platform override from env args", () => {
    expect(
      createElectronViteArgs(
        ["dev"],
        {
          ELECTRON_CLI_ARGS: JSON.stringify(["--ozone-platform=wayland"]),
        },
        "linux",
      ),
    ).toEqual(["dev"]);
  });

  it("does not add Linux-only Electron args on non-Linux platforms", () => {
    expect(createElectronViteArgs(["dev"], {}, "darwin")).toEqual(["dev"]);
  });

  it("keeps existing Electron CLI env values for Electron Vite itself", () => {
    const env = createElectronViteEnv({
      ELECTRON_CLI_ARGS: JSON.stringify([
        "--ozone-platform=wayland",
        "--remote-debugging-port=9222",
      ]),
    });

    expect(JSON.parse(env.ELECTRON_CLI_ARGS ?? "[]")).toEqual([
      "--ozone-platform=wayland",
      "--remote-debugging-port=9222",
    ]);
  });
});
