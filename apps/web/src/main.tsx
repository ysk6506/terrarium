/** Entry point of the web app: the API client and the shell. Fonts and styles load from index.html. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createApi, Identity, type KeyValueStore } from "./logic";
import { App, applySavedTheme } from "./ui";

function browserStorage(): KeyValueStore | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

applySavedTheme();
const identity = new Identity(browserStorage());
const api = createApi({ user: () => identity.name });
const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <App api={api} identity={identity} />
    </StrictMode>,
  );
