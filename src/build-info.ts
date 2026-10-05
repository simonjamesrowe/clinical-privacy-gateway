export interface BuildInfo {
  version: string;
  buildNumber: string;
  revision: string;
  isRelease: boolean;
  displayVersion: string;
}

export const localBuildInfo: BuildInfo = {
  version: "0.2.0",
  buildNumber: "local",
  revision: "local",
  isRelease: false,
  displayVersion: "Version 0.2.0 · local development build",
};

export function aboutBuildLine(build: BuildInfo): string {
  return build.displayVersion;
}
