type Reloader = () => void;

let reload: Reloader = () => {
  window.location.reload();
};

export function setReloader(fn: Reloader): void {
  reload = fn;
}

export function reloadApp(): void {
  reload();
}
