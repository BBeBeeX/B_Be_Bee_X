const meta = document.getElementById("meta");
const result = document.getElementById("result");
const button = document.getElementById("btn");

let clicks = 0;
meta.textContent = `${window.templateMeta.name} (${window.templateMeta.platform})`;

button.addEventListener("click", () => {
  clicks += 1;
  result.textContent = `Clicks: ${clicks}`;
});
