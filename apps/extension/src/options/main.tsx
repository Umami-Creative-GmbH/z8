import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Options } from "./Options";
import "./styles.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Options />
    </StrictMode>
  );
}
