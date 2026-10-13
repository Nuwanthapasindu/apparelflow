import bcrypt from "bcryptjs";
import { PrismaClient, Role } from "../src/generated/prisma/client";

const prisma = new PrismaClient();

const BCRYPT_COST = 10;

const recipes = [
  {
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
  },
  {
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
  },
] as const;

// Public demo credentials (also documented in the README). Clearly fake.
const users = [
  {
    role: Role.cutting_supervisor,
    email: "cutting.supervisor@apparelflow.test",
    password: "Demo-Supervisor-1",
    fullName: "Cutting Supervisor",
  },
  {
    role: Role.cutting_verifier,
    email: "cutting.verifier@apparelflow.test",
    password: "Demo-Verifier-1",
    fullName: "Cutting Verifier",
  },
  {
    role: Role.sewing_supervisor,
    email: "sewing.supervisor@apparelflow.test",
    password: "Demo-Sewing-1",
    fullName: "Sewing Supervisor",
  },
];

async function main() {
  for (const { components, ...recipe } of recipes) {
    const saved = await prisma.recipe.upsert({
      where: { recipeCode: recipe.recipeCode },
      update: recipe,
      create: recipe,
    });

    for (const [componentName, piecesPerGarment] of components) {
      await prisma.recipeComponent.upsert({
        where: {
          recipeId_componentName: { recipeId: saved.id, componentName },
        },
        update: { piecesPerGarment },
        create: { recipeId: saved.id, componentName, piecesPerGarment },
      });
    }
  }

  for (const { password, ...user } of users) {
    // The hash is only written on create, so re-running the seed keeps existing logins stable.
    await prisma.user.upsert({
      where: { email: user.email },
      update: { role: user.role, fullName: user.fullName, isActive: true },
      create: { ...user, passwordHash: await bcrypt.hash(password, BCRYPT_COST) },
    });
  }

  const [recipeCount, componentCount, userCount] = await Promise.all([
    prisma.recipe.count(),
    prisma.recipeComponent.count(),
    prisma.user.count(),
  ]);
  console.log(
    `Seeded: ${recipeCount} recipes, ${componentCount} recipe components, ${userCount} users`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
