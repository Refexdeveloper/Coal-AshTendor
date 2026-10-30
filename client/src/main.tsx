import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@client/styles/globals.css";
import App from "./App";
import { installCardTilt } from "@client/components/feature/card-tilt";

installCardTilt();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
