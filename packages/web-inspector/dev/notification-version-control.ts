import { valid, prerelease, lt } from "semver";

/** Guided inputs produce ordinary npm semver; custom expressions stay untouched. */
export function createVersionControl(
  container: HTMLElement,
  input: HTMLInputElement,
) {
  const mode = container.querySelector<HTMLSelectElement>("#version-mode")!;
  const lower = container.querySelector<HTMLInputElement>("#version-from")!;
  const upper = container.querySelector<HTMLInputElement>("#version-to")!;
  const fromLabel = container.querySelector<HTMLElement>(
    "#version-from-label",
  )!;
  const hint = container.querySelector<HTMLElement>("#version-help")!;
  const error = container.querySelector<HTMLElement>("#version-error")!;
  const rawLabel = input.closest<HTMLElement>("label")!;
  function layout() {
    const kind = mode.value;
    lower.closest<HTMLElement>("label")!.hidden =
      kind === "any" || kind === "custom";
    upper.closest<HTMLElement>("label")!.hidden = kind !== "between";
    rawLabel.hidden = kind !== "custom";
    fromLabel.textContent =
      kind === "between" || kind === "from"
        ? "From (included)"
        : kind === "before"
          ? "Before (excluded)"
          : "Version";
    hint.textContent =
      kind === "between"
        ? "Includes the start version; excludes the end version."
        : kind === "custom"
          ? "npm semver: ^1.70.1, ~1.70.1, or >=1.70.1 <1.71.0. Prereleases never match."
          : "Stable releases only.";
  }
  function validationError() {
    if (mode.value === "any" || mode.value === "custom") return "";
    if (!valid(lower.value) || prerelease(lower.value))
      return "Enter a stable version, such as 1.70.1.";
    if (mode.value === "between") {
      if (!valid(upper.value) || prerelease(upper.value))
        return "Enter a stable end version, such as 1.71.0.";
      if (!lt(lower.value, upper.value))
        return "The end version must be later than the start.";
    }
    return "";
  }
  function update() {
    const kind = mode.value;
    layout();
    if (kind !== "custom")
      input.value =
        kind === "any"
          ? ""
          : kind === "exact"
            ? lower.value
            : kind === "before"
              ? `<${lower.value}`
              : kind === "from"
                ? `>=${lower.value}`
                : `>=${lower.value} <${upper.value}`;
    const message = validationError();
    error.textContent = message;
    error.hidden = !message;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function sync() {
    const range = input.value.trim();
    const between = /^>=(\d+\.\d+\.\d+)\s+<(\d+\.\d+\.\d+)$/.exec(range);
    const one = /^(>=|<)(\d+\.\d+\.\d+)$/.exec(range);
    if (!range) mode.value = "any";
    else if (between) {
      mode.value = "between";
      lower.value = between[1]!;
      upper.value = between[2]!;
    } else if (one) {
      mode.value = one[1] === ">=" ? "from" : "before";
      lower.value = one[2]!;
    } else if (valid(range) && !prerelease(range)) {
      mode.value = "exact";
      lower.value = range;
    } else mode.value = "custom";
    error.textContent = validationError();
    error.hidden = !error.textContent;
    layout();
  }
  mode.addEventListener("change", update);
  for (const field of [lower, upper])
    field.addEventListener("input", (event) => {
      event.stopPropagation();
      update();
    });
  sync();
  return { sync, validationError };
}
