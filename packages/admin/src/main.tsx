import "@mantine/core/styles.css";
import "./app/app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { AppProviders } from "./app/providers";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container is missing");
}

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
