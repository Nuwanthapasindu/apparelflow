import { authedRequest } from "./auth";
import { prisma } from "./db";

export const BASE = "http://localhost:3000";

// Same recipes as prisma/seed.ts. Component order here is the garment order, not alphabetical.
export const BLOUSE = {
  recipeCode: "REC-BL01",
  name: "Casual Blouse",
  category: "Blouse",
  stdFabricYards: "1.80",
  wastageCap: "5.00",
  components: [
    ["Front Body Panel", 1],
    ["Back Body Panel", 1],
    ["Sleeves (Left & Right)", 2],
    ["Collar & Stand", 1],
    ["Sleeve Cuffs", 2],
  ],
} as const;
export const CROP_TOP = {
  recipeCode: "REC-CT02",
  name: "Crop Top",
  category: "Crop Top",
  stdFabricYards: "1.10",
  wastageCap: "8.00",
  components: [
    ["Front Chest Panel", 1],
    ["Back Support Panel", 1],
    ["Neck Binding Strip", 1],
    ["Hem Elastic Casing", 1],
    ["Side Strap Accents", 2],
  ],
} as const;

export async function seedRecipes() {
  const create = (r: typeof BLOUSE | typeof CROP_TOP) =>
    prisma.recipe.create({
      data: {
        recipeCode: r.recipeCode,
        name: r.name,
        category: r.category,
        stdFabricYards: r.stdFabricYards,
        wastageCap: r.wastageCap,
        components: { create: r.components.map(([componentName, piecesPerGarment]) => ({ componentName, piecesPerGarment })) },
      },
    });
  return { blouse: await create(BLOUSE), crop: await create(CROP_TOP) };
}

type Init = { body?: unknown; headers?: Record<string, string> };

/** A request authenticated as the given user (signed access cookie), or anonymous when null. */
export async function as(userId: string | null, method: string, path: string, init: Init = {}) {
  const raw = init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body);
  const requestInit: RequestInit = {
    method,
    body: raw,
    headers: { ...(raw === undefined ? {} : { "content-type": "application/json" }), ...init.headers },
  };
  return userId ? authedRequest(userId, `${BASE}${path}`, requestInit) : new Request(`${BASE}${path}`, requestInit);
}
