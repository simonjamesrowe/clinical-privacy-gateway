export interface BuildInfo {
  version: string;
  buildNumber: string;
  revision: string;
  isRelease: boolean;
  displayVersion: string;
}

export const localBuildInfo: BuildInfo = {
  version: "0.1.0",
  buildNumber: "local",
  revision: "local",
  isRelease: false,
  displayVersion: "Version 0.1.0 · local development build",
};

export function aboutBuildLine(build: BuildInfo): string {
  return build.displayVersion;
}
