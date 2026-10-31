import { render } from "preact";
import { App } from "./app";
import { setReloader } from "./register";
import "./styles.css";

const root = document.getElementById("app");
if (root) render(<App />, root);

if (import.meta.env.PROD) {
  void import("virtual:pwa-register").then(({ registerSW }) => {
    const update = registerSW({
      onNeedRefresh() {
        setReloader(() => {
          void update(true);
        });
        window.dispatchEvent(new Event("tabata:update"));
      },
    });
  });
}
