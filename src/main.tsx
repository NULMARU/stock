import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router";
import "./index.css";
import App from "./App.tsx";
import AppUpdateNotice from "./components/AppUpdateNotice";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <AppUpdateNotice />
      <App />
    </HashRouter>
  </StrictMode>,
);
