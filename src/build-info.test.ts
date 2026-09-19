import { describe, expect, it } from "vitest";
import { aboutBuildLine, localBuildInfo } from "./build-info";

describe("aboutBuildLine", () => {
  it("labels local builds without presenting them as releases", () => {
    expect(aboutBuildLine(localBuildInfo)).toBe(
      "Version 0.1.0 · local development build",
    );
  });

  it("preserves the traceable release build string", () => {
    expect(
      aboutBuildLine({
        version: "0.1.0",
        buildNumber: "42",
        revision: "a1b2c3d",
        isRelease: true,
        displayVersion: "Version 0.1.0 · build 42 · a1b2c3d",
      }),
    ).toBe("Version 0.1.0 · build 42 · a1b2c3d");
  });
});
