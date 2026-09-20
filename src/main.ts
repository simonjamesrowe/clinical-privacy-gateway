import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { aboutBuildLine, localBuildInfo, type BuildInfo } from "./build-info";
import "./styles/app.css";
import { TextReviewPage } from "./privacy/page";
import type { Progress } from "./privacy/types";

const applicationRoot = document.querySelector<HTMLElement>("#app");

if (!applicationRoot) {
  throw new Error("The Clinician’s Veil application root is unavailable.");
}

const app: HTMLElement = applicationRoot;
let buildInfo = localBuildInfo;
let page: TextReviewPage | null = null;

function aboutMarkup(): string {
  return `
    <dialog id="about-dialog" aria-labelledby="about-title">
      <div class="about-dialog__header">
        <p class="eyebrow">About</p>
        <button class="icon-button" type="button" data-close-about aria-label="Close About">×</button>
      </div>
      <div class="about-mark" aria-hidden="true"><span></span><span></span><span></span></div>
      <h2 id="about-title">Clinician’s Veil</h2>
      <p class="about-dialog__summary">A local-first clinical privacy workspace.</p>
      <p class="build-line">${aboutBuildLine(buildInfo)}</p>
      <p class="about-dialog__notice">Clinician’s Veil is not a clinical product, a guarantee of compliance, or a claim that clinical material is anonymous.</p>
      <p class="about-dialog__licence">© 2026 Simon Rowe · Apache License 2.0</p>
    </dialog>`;
}

function render(): void {
  app.innerHTML = `
    <section class="welcome" aria-labelledby="welcome-heading">
      <div class="welcome__ledger" aria-hidden="true">
        <span>LOCAL / 01</span>
        <span>MACOS / ARM64</span>
      </div>
      <div class="veil-mark" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="welcome__copy">
        <p class="eyebrow">A local-first workspace</p>
        <h1 id="welcome-heading">Welcome to<br /><em>Clinician’s Veil.</em></h1>
        <p class="welcome__description">Find possible identifiers, review each replacement, and keep your source text on this Mac.</p>
        <button type="button" class="welcome-start" data-open-review>De-identify text →</button>
      </div>
      <footer class="welcome__footer">
        <span>${aboutBuildLine(buildInfo)}</span>
        <button class="about-link" type="button" data-show-about>About Clinician’s Veil</button>
      </footer>
    </section>
    ${aboutMarkup()}`;

  app
    .querySelector<HTMLButtonElement>("[data-show-about]")
    ?.addEventListener("click", showAbout);
  app
    .querySelector<HTMLButtonElement>("[data-close-about]")
    ?.addEventListener("click", closeAbout);
  app
    .querySelector<HTMLButtonElement>("[data-open-review]")
    ?.addEventListener("click", () => {
      const workspace = document.createElement("div");
      app.querySelector(".welcome")?.replaceWith(workspace);
      page = new TextReviewPage(
        workspace,
        {
          available: isTauri(),
          call: invoke,
          progress: (callback) =>
            listen<Progress>("privacy-progress", (event) =>
              callback(event.payload),
            ),
        },
        () => {
          page = null;
          render();
        },
      );
      void page.mount();
    });
}

function aboutDialog(): HTMLDialogElement | null {
  return document.querySelector<HTMLDialogElement>("#about-dialog");
}

function showAbout(): void {
  aboutDialog()?.showModal();
}

function closeAbout(): void {
  aboutDialog()?.close();
}

async function loadBuildInfo(): Promise<void> {
  try {
    buildInfo = await invoke<BuildInfo>("build_info");
  } catch {
    // The browser development server has no native Tauri bridge. The local
    // label makes that state explicit without exposing host details.
    buildInfo = localBuildInfo;
  }
  if (!page) render();
}

render();
void loadBuildInfo();
if (isTauri()) void listen("show-about", showAbout);
