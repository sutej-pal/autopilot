import type { Frame, Locator, Page } from "playwright";
import type { Locator as LocatorSpec } from "@autopilot/shared";

export function scopeFor(page: Page, framePath: string[]): Page | Frame {
  let current: Page | Frame = page;
  for (const token of framePath) {
    const next = current.frame({ name: token }) ?? current.frame({ url: token });
    if (!next) throw new Error(`Frame not found: ${token}`);
    current = next;
  }
  return current;
}

export function toLocator(scope: Page | Frame, spec: LocatorSpec): Locator {
  switch (spec.strategy) {
    case "role":
      return scope.getByRole(spec.role as "button", { name: spec.name, exact: true });
    case "label":
      return scope.getByLabel(spec.text, { exact: true });
    case "placeholder":
      return scope.getByPlaceholder(spec.text, { exact: true });
    case "text":
      return scope.getByText(spec.text, { exact: true });
    case "testid":
      return scope.getByTestId(spec.value);
    case "id":
      return scope.locator(`[id="${cssAttr(spec.value)}"]`);
    case "name":
      return scope.locator(`[name="${cssAttr(spec.value)}"]`);
    case "css":
      return scope.locator(spec.value);
    case "xpath":
      return scope.locator(`xpath=${spec.value}`);
    default:
      throw new Error("Unknown locator strategy");
  }
}

function cssAttr(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
