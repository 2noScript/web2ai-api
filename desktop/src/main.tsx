import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow"

import "./index.css"
import App from "./App.tsx"
import { PetOverlay } from "./components/pet-overlay.tsx"

let isPetWindow = new URLSearchParams(window.location.search).get("window") === "pet"
if (!isPetWindow) {
  try {
    isPetWindow = getCurrentWebviewWindow().label === "pet"
  } catch {
    isPetWindow = false
  }
}

if (isPetWindow) {
  document.documentElement.classList.add("pet-window")
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isPetWindow ? <PetOverlay /> : <App />}
  </StrictMode>
)
