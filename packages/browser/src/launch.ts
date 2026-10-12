import { chromium, type Browser } from "playwright";

export async function launchChromium(headed = false): Promise<Browser> {
  const onRender = process.env.RENDER === "true";
  return chromium.launch({
    headless: onRender ? true : !headed,
    slowMo: !onRender && headed ? 200 : 0,
    args: ["--disable-dev-shm-usage", ...(onRender ? ["--no-sandbox", "--disable-setuid-sandbox"] : [])],
  });
}
