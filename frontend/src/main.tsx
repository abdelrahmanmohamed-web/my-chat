import React from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <main>
      <h1>My Chat</h1>
      <p>Frontend is running.</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
