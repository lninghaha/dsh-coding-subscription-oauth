import { rm } from "node:fs/promises";
import { resolve } from "node:path";

await rm(resolve(".next"), { recursive: true, force: true });
