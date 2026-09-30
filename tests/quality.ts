// Development-only: exercise the actual app's rAF controller and render resizing.
import '../src/main';
const button = document.querySelector<HTMLButtonElement>('#stress')!;
let stressing = false;
let request = 0;
function load() {
  if (!stressing) return;
  const start = performance.now();
  while (performance.now() - start < 40) { /* Intentional test-only CPU pressure. */ }
  request = requestAnimationFrame(load);
}
button.addEventListener('click', () => {
  stressing = !stressing;
  button.textContent = stressing ? 'Stop artificial frame load' : 'Add 40 ms frame load';
  if (stressing) request = requestAnimationFrame(load);
  else cancelAnimationFrame(request);
});
if (import.meta.hot) import.meta.hot.dispose(() => cancelAnimationFrame(request));
