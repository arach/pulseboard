import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "hudsonkit/theme";
import "hudsonkit/styles";
import "./pulse.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="system" defaultTemplate="pulse" storageKey="pulse.theme">
      <App />
    </ThemeProvider>
  </StrictMode>,
);
