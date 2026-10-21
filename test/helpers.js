import { readFileSync } from "node:fs";
export const example = (name) => JSON.parse(readFileSync(new URL(`../examples/levels/${name}.json`, import.meta.url), "utf8"));
export const level = (parts, world = {}, extra = {}) => ({ schema: "goldberg-level/1", name: "test", world: { duration: 3, ...world }, parts, ...extra });
export const DEG = 180 / Math.PI;
