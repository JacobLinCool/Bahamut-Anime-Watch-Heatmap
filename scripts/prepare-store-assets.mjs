import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const source = "assets/screenshot.png";

const outputs = [
  {
    target: "assets/store-listing/chrome/small-promo-440x280.png",
    size: "440x280",
    crop: "2329x1482+548+0"
  },
  {
    target: "assets/store-listing/chrome/marquee-1400x560.png",
    size: "1400x560",
    crop: "3252x1301+0+120"
  },
  {
    target: "assets/store-listing/chrome/screenshot-1280x800.png",
    size: "1280x800",
    crop: "2371x1482+540+0"
  }
];

mkdirSync("assets/store-listing/chrome", { recursive: true });

for (const output of outputs) {
  execFileSync("magick", [
    source,
    "-crop",
    output.crop,
    "+repage",
    "-resize",
    output.size,
    "-strip",
    output.target
  ], {
    cwd: resolve("."),
    stdio: "inherit"
  });

  console.log(`created ${output.target}`);
}
